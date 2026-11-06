/** Optional scheduled whale alerts. Requires D1 migration 0002 and Worker secrets.
 * Never reads secrets from the browser. Only exchange-confirmed SPOT prints qualify.
 * At-least-once notification semantics: retries may rarely duplicate after a crash.
 */
type Statement={
 bind(...values:unknown[]):Statement
 all<T>():Promise<{results:T[]}>
 run():Promise<{meta?:{changes?:number}}>
}
type Database={prepare(sql:string):Statement}
export type WhaleAlertEnv={
 DB:Database
 BARK_DEVICE_KEY?:string
 BARK_AUTO_ENABLED?:string
 BARK_WHALE_THRESHOLD_USDT?:string
}
type Trade={id:string;symbol:string;source:string;time:number;side:'buy'|'sell';price:number;notional:number}
type Pending={event_key:string;symbol:string;source:string;trade_time:number;side:'buy'|'sell';price:number;notional_usdt:number;attempts:number}
const symbols=['BTCUSDT','ETHUSDT','SOLUSDT'] as const
const safeThreshold=(raw?:string)=>{
 const n=Number(raw??100000)
 return Number.isFinite(n)&&n>=10000&&n<=10000000?n:100000
}
async function recentTrades(symbol:string):Promise<Trade[]>{
 const controller=new AbortController()
 const timeout=setTimeout(()=>controller.abort(),6000)
 try {
  const response=await fetch(`https://www.okx.com/api/v5/market/trades?instId=${symbol.replace('USDT','-USDT')}&limit=100`,{signal:controller.signal})
  if(!response.ok)throw new Error(`OKX HTTP ${response.status}`)
  const payload=await response.json() as {code?:string;data?:Array<Record<string,unknown>>}
  if(payload.code!=='0'||!Array.isArray(payload.data))throw new Error('OKX trade payload invalid')
  return payload.data.flatMap(x=>{
   const id=typeof x.tradeId==='string'?x.tradeId:''
   const price=Number(x.px),qty=Number(x.sz),time=Number(x.ts)
   const side=x.side
   if(!id||!Number.isFinite(price)||price<=0||!Number.isFinite(qty)||qty<=0||
      !Number.isFinite(time)||!['buy','sell'].includes(String(side)))return []
   return [{id,symbol,source:'OKX',time,side:side as 'buy'|'sell',price,notional:price*qty}]
  })
 }finally{clearTimeout(timeout)}
}
async function sendBark(env:WhaleAlertEnv,item:Pending):Promise<void>{
 const controller=new AbortController()
 const timeout=setTimeout(()=>controller.abort(),7000)
 try{
  const response=await fetch('https://api.day.app/push',{
   method:'POST',signal:controller.signal,
   headers:{'content-type':'application/json'},
   body:JSON.stringify({
    device_key:env.BARK_DEVICE_KEY,
    title:`一鸣 AI Quant · ${item.symbol.replace('USDT','/USDT')} 大额成交`,
    body:`${item.side==='buy'?'主动买入':'主动卖出'} ${item.notional_usdt.toFixed(0)} USDT · 现货 ${item.source} · 成交价 ${item.price}`,
    group:'Yiming AI Quant · Whale',
    level:'active'
   })
  })
  if(!response.ok)throw new Error(`Bark HTTP ${response.status}`)
  const reply=await response.json() as {code?:number}
  if(reply.code!==200)throw new Error('Bark gateway did not acknowledge')
 }finally{clearTimeout(timeout)}
}
/** Never called from /api route. Only Cloudflare cron with explicit opt-in secrets. */
export async function pollWhaleAlerts(env:WhaleAlertEnv):Promise<void>{
 if(env.BARK_AUTO_ENABLED!=='1'||!env.BARK_DEVICE_KEY)return
 const threshold=safeThreshold(env.BARK_WHALE_THRESHOLD_USDT)
 const now=Date.now()
 for(const symbol of symbols){
  try{
   const trades=await recentTrades(symbol)
   const fresh=trades.filter(t=>t.notional>=threshold&&t.time>=now-60_000&&t.time<=now+5000)
     .sort((a,b)=>b.notional-a.notional)
   if(!fresh.length)continue
   // Single SQL statement prevents concurrent scans from claiming a cooldown slot.
   const t=fresh[0]
   await env.DB.prepare(`INSERT OR IGNORE INTO whale_alert_events
    (event_key,symbol,source,trade_id,trade_time,side,price,notional_usdt)
    SELECT ?,?,?,?,?,?,?,?
    WHERE NOT EXISTS (
      SELECT 1 FROM whale_alert_events
      WHERE symbol=? AND created_at > datetime('now','-15 minutes')
    )`).bind(`${t.source}:${symbol}:${t.id}`,symbol,t.source,t.id,t.time,t.side,t.price,t.notional,symbol).run()
  }catch(error){console.error('Whale alert market scan unavailable',symbol,error)}
 }
 // Recover abandoned 'sending' states after 15 minutes. Dedup is best effort.
 try{
  await env.DB.prepare(`UPDATE whale_alert_events SET state='pending',updated_at=datetime('now')
    WHERE state='sending' AND updated_at < datetime('now','-15 minutes') AND attempts < 3`).run()
  const pending=await env.DB.prepare(`SELECT event_key,symbol,source,trade_time,side,price,notional_usdt,attempts
    FROM whale_alert_events WHERE state='pending' AND attempts < 3
    ORDER BY created_at ASC LIMIT 3`).all<Pending>()
  for(const item of pending.results){
   const claim=await env.DB.prepare(`UPDATE whale_alert_events
     SET state='sending',attempts=attempts+1,updated_at=datetime('now')
     WHERE event_key=? AND state='pending'`).bind(item.event_key).run()
   if(claim.meta?.changes!==1)continue
   try{
    await sendBark(env,item)
    await env.DB.prepare(`UPDATE whale_alert_events SET state='sent',updated_at=datetime('now'),last_error=NULL
      WHERE event_key=? AND state='sending'`).bind(item.event_key).run()
   }catch(error){
    await env.DB.prepare(`UPDATE whale_alert_events SET state=CASE WHEN attempts>=3 THEN 'failed' ELSE 'pending' END,
      updated_at=datetime('now'),last_error=? WHERE event_key=? AND state='sending'`)
      .bind(error instanceof Error?error.message.slice(0,150):'Unknown gateway error',item.event_key).run()
   }
  }
 }catch(error){console.error('Whale alerts ledger not ready or D1 unavailable',error)}
}
