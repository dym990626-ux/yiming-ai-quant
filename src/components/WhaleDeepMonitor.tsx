import { useEffect, useMemo, useState } from 'react'
import type { SymbolId } from '../types'
import type { DepthSnapshot } from '../lib/depth'
type Trade={id:string;timestamp:number;price:number;qty:number;notional:number;aggressor:'buy'|'sell';source:string}
type Scan={symbol:SymbolId;source:string;count:number;max:number;buy:number;sell:number;error?:string}
const coins:SymbolId[]=['BTCUSDT','ETHUSDT','SOLUSDT']
const compact=(n:number)=>new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:2}).format(n)
export function WhaleDeepMonitor({symbol}:{symbol:SymbolId}){
 const [depth,setDepth]=useState<DepthSnapshot|null>(null)
 const [depthError,setDepthError]=useState('正在连接…')
 const [scan,setScan]=useState<Scan[]>([])
 const [min,setMin]=useState(100000)
 const [scanning,setScanning]=useState(true)
 const [record,setRecord]=useState(false)
 const [archive,setArchive]=useState<Array<{key:string;symbol:string;time:number;amount:number;side:string}>>(()=>{
  try{const x=JSON.parse(localStorage.getItem('whale-local-events-v1')||'[]') as unknown;return Array.isArray(x)?x.slice(0,100):[]}catch{return []}
 })
 useEffect(()=>{
  let alive=true
  const controller=new AbortController()
  const pull=async()=>{
   try{const r=await fetch(`/api/whale/depth?symbol=${symbol}`,{cache:'no-store',signal:controller.signal})
    const d=await r.json() as DepthSnapshot&{error?:string}
    if(!r.ok||!Array.isArray(d.bids))throw new Error(d.error||'无效盘口')
    if(alive){setDepth(d);setDepthError('')}
   }catch(e){if(alive){setDepth(null);setDepthError(e instanceof Error?e.message:'无法读取盘口')}}
  }
  void pull();const timer=setInterval(()=>void pull(),15000)
  return()=>{alive=false;controller.abort();clearInterval(timer)}
 },[symbol])
 useEffect(()=>{
  let alive=true;const controller=new AbortController()
  const pull=async()=>{
   setScanning(true)
   const values=await Promise.allSettled(coins.map(async coin=>{
    const response=await fetch(`/api/whale/trades?symbol=${coin}&source=auto`,{cache:'no-store',signal:controller.signal})
    const data=await response.json() as {source?:string;trades?:Trade[];error?:string}
    if(!response.ok||!Array.isArray(data.trades))throw new Error(data.error||'接口失败')
    const trades=data.trades.filter(x=>Number.isFinite(x.notional)&&x.notional>=min)
    const row:Scan={symbol:coin,source:data.source||'',count:trades.length,max:Math.max(0,...trades.map(x=>x.notional)),buy:trades.filter(x=>x.aggressor==='buy').reduce((s,x)=>s+x.notional,0),sell:trades.filter(x=>x.aggressor==='sell').reduce((s,x)=>s+x.notional,0)}
    return {row,trades}
   }))
   if(!alive)return
   setScan(values.map((v,i)=>v.status==='fulfilled'?v.value.row:{symbol:coins[i],source:'不可用',count:0,max:0,buy:0,sell:0,error:v.reason instanceof Error?v.reason.message:'不可用'}))
   if(record) setArchive(old=>{
    const keys=new Set(old.map(x=>x.key))
    const fresh=values.flatMap((v,i)=>v.status==='fulfilled'?v.value.trades.slice(0,15).map(t=>({key:`${v.value.row.source}:${coins[i]}:${t.id}`,symbol:coins[i],time:t.timestamp,amount:t.notional,side:t.aggressor})).filter(x=>!keys.has(x.key)):[])
    if(!fresh.length)return old
    const next=[...fresh,...old].sort((a,b)=>b.time-a.time).slice(0,100)
    try{localStorage.setItem('whale-local-events-v1',JSON.stringify(next))}catch{}
    return next
   })
   setScanning(false)
  }
  void pull();const timer=setInterval(()=>void pull(),30000)
  return()=>{alive=false;controller.abort();clearInterval(timer)}
 },[min,record])
 const levels=useMemo(()=>depth?[...depth.bids.map(x=>({...x,side:'买盘'})),...depth.asks.map(x=>({...x,side:'卖盘'}))].sort((a,b)=>b.notional-a.notional).slice(0,6):[],[depth])
 return <section className="wd-root"><div className="wa-caption"><div><span className="eyebrow">MARKET STRUCTURE</span><h2>真实盘口 · 三币同步雷达 · 异动证据</h2></div><small>每15/30秒分别刷新</small></div>
 <div className="wd-grid">
  <div className="wa-panel"><div className="wa-panel-head"><strong>{symbol.replace('USDT','/USDT')} 现货盘口</strong><small>{depth?`${depth.source} · ${new Date(depth.fetchedAt).toLocaleTimeString('zh-CN')}`:depthError}</small></div>
   {depth?<><div className="wd-metrics">
    <div><span>买盘档位金额</span><b className="positive">{compact(depth.bidNotional)} U</b></div>
    <div><span>卖盘档位金额</span><b className="negative">{compact(depth.askNotional)} U</b></div>
    <div><span>盘口不平衡</span><b>{(depth.imbalance*100).toFixed(1)}%</b></div>
    <div><span>最优买卖价差</span><b>{depth.spreadPct.toFixed(4)}%</b></div>
   </div><div className="wd-depth">{levels.map((x,i)=><div key={i}><span>{x.side}</span><span>{x.price.toLocaleString('en-US')}</span><b>{compact(x.notional)} U</b></div>)}</div></>:<p className="wa-empty">{depthError}</p>}
   <p className="wa-hint">仅为有限盘口档位的即时快照，挂单可能撤销；并非完整历史热力图或真实鲸鱼账户持仓。</p>
  </div>
  <div className="wa-panel"><div className="wa-panel-head"><strong>BTC / ETH / SOL 同步扫描</strong><select value={min} onChange={e=>setMin(Number(e.target.value))} aria-label="大额门槛"><option value={10000}>≥1万U</option><option value={50000}>≥5万U</option><option value={100000}>≥10万U</option><option value={500000}>≥50万U</option></select></div>
  {scan.length?scan.map(x=><div className="wd-scan" key={x.symbol}><strong>{x.symbol.replace('USDT','/USDT')}</strong>{x.error?<small>{x.error}</small>:<><span>{x.count}笔达标</span><span>最大 {compact(x.max)} U</span><b className={x.buy>=x.sell?'positive':'negative'}>净差 {compact(x.buy-x.sell)} U</b></>}</div>):<p className="wa-empty">{scanning?'扫描中…':'未收到数据'}</p>}
  <p className="wa-hint">每30秒检查各币种的近期公开现货成交样本，不代表全量或连续市场资金流。</p></div>
 </div>
 <div className="wa-panel"><div className="wa-panel-head"><strong>异常成交记录（本机）</strong><div className="wd-actions"><button onClick={()=>setRecord(v=>!v)}>{record?'● 记录已开启':'○ 开启记录'}</button><button onClick={()=>{setArchive([]);localStorage.removeItem('whale-local-events-v1')}}>清除记录</button></div></div>
  <p className="wa-hint">仅打开本页面时记录新捕获的大额成交，最多100条。不会后台连续监控，也不会自动发送 Bark。</p>
  {archive.length?<div className="wd-archive">{archive.slice(0,12).map(x=><div key={x.key}><span>{new Date(x.time).toLocaleTimeString('zh-CN')}</span><b>{x.symbol.replace('USDT','/USDT')}</b><span>{x.side==='buy'?'主动买入':'主动卖出'}</span><b>{compact(x.amount)} U</b></div>)}</div>:<p className="wa-empty">暂无本机记录</p>}
 </div></section>
}
