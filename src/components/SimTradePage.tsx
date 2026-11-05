import { useEffect, useRef, useState } from 'react'
import type { ConnectionState, SymbolId, Ticker } from '../types'
import { LIMITS, UNIT, freshQuote, parseOrder } from '../lib/simRisk.ts'
import type { Account, OrderInput, Position, Quote } from '../lib/simRisk.ts'
import './simV2.css'
type Receipt = { id:string; action:string; symbol:string; time:number; fill:number; pnl:number; fee:number; source:string }
type Snapshot = { account:Account|null; healthy:boolean; orders:Receipt[] }
type Research = { source:string; cvd:number; cvdUnit:string; vwap:number; samples:number; from:number; to:number; openInterest:number|null; oiUnit:string; oiTime:number|null; fundingRate:number|null; fundingTime:number|null; errors:string[] }
const money=(n:number)=>new Intl.NumberFormat('zh-CN',{maximumFractionDigits:4}).format(n)
const pendingKey='yiming-sim-v2-pending'
const restore=():OrderInput|null=>{try{return parseOrder(JSON.parse(sessionStorage.getItem(pendingKey)||'null'))}catch{return null}}
export function SimTradePage({symbol:initialSymbol}:{symbol:SymbolId;ticker:Ticker|null;status:ConnectionState}) {
 const [symbol,setSymbol]=useState<SymbolId>(initialSymbol),[secret,setSecret]=useState(''),[accountData,setAccountData]=useState<Snapshot|null>(null)
 const [quote,setQuote]=useState<Quote|null>(null),[research,setResearch]=useState<Research|null>(null),[now,setNow]=useState(Date.now()),[error,setError]=useState(''),[researchError,setResearchError]=useState('')
 const [size,setSize]=useState('100'),[stop,setStop]=useState(''),[take,setTake]=useState(''),[busy,setBusy]=useState(false),[pending,setPending]=useState<OrderInput|null>(restore)
 const autoAttempt=useRef('')
 const inFlight=useRef(false), currentSecret=useRef(secret);currentSecret.current=secret
 const setIntent=(x:OrderInput|null)=>{setPending(x);if(x)sessionStorage.setItem(pendingKey,JSON.stringify(x));else sessionStorage.removeItem(pendingKey)}
 const account=accountData?.account,position:Position|null=account?.position?JSON.parse(account.position):null
 const live=quote?.symbol===symbol&&freshQuote(quote,now),matching=!position||position.symbol===symbol
 const refreshAccount=async(key=secret)=>{
  const r=await fetch('/api/sim/account',{headers:{Authorization:`Bearer ${key}`}}),body=await r.json()
  if(!r.ok)throw new Error(body.error||'模拟账户不可用')
  if(currentSecret.current===key)setAccountData(prev=>prev?.account && body.account && prev.account.revision>body.account.revision?prev:body as Snapshot)
 }
 useEffect(()=>{setAccountData(null);setError('');if(!secret)return;let active=true
  const load=()=>{void refreshAccount(secret).catch(e=>{if(active){setAccountData(null);setError(String(e.message))}})}
  load();const timer=window.setInterval(load,3000);return()=>{active=false;clearInterval(timer)}
 },[secret])
 useEffect(()=>{let active=true;setQuote(null);setResearch(null);setResearchError('');const controller=new AbortController()
  const loadQuote=async()=>{try{const r=await fetch(`/api/sim/quote?symbol=${symbol}`,{signal:controller.signal}),q=await r.json();if(!r.ok)throw new Error(q.error);if(active){setQuote(q);setError('')}}catch(e){if(active){setQuote(null);setError(e instanceof Error?e.message:'行情不可用')}}}
  const loadResearch=async()=>{try{const r=await fetch(`/api/quant-research?symbol=${symbol}`,{signal:controller.signal}),q=await r.json();if(!r.ok)throw new Error(q.error);if(active){setResearch(q);setResearchError('')}}catch(e){if(active){setResearch(null);setResearchError(e instanceof Error?e.message:'研究不可用')}}}
  void loadQuote();void loadResearch();const quotes=window.setInterval(()=>void loadQuote(),2500),studies=window.setInterval(()=>void loadResearch(),10000),clock=window.setInterval(()=>setNow(Date.now()),250)
  return()=>{active=false;controller.abort();clearInterval(quotes);clearInterval(studies);clearInterval(clock)}
 },[symbol])
 const send=async(input:OrderInput)=>{
  if(inFlight.current)return;inFlight.current=true;setBusy(true);setError('')
  try{
   setIntent(input)
   const r=await fetch('/api/sim/orders',{method:'POST',headers:{Authorization:`Bearer ${secret}`,'content-type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.timeout(15000)})
   const result=await r.json()
   if(!r.ok){if([400,409,413,415,422].includes(r.status))setIntent(null);throw new Error(result.error||'订单未确认')}
   setIntent(null);await refreshAccount()
  }catch(e){setError(e instanceof Error?e.message:'订单未确认，请以同一幂等键重试')}
  finally{inFlight.current=false;setBusy(false)}
 }
 const order=(action:'open'|'close')=>{if(!quote||!live||pending)return;void send({id:crypto.randomUUID(),action,symbol,expectedPrice:quote.price,...(action==='open'?{side:'long' as const,notional:Number(size),stop:Number(stop),...(take===''?{}:{take:Number(take)})}:{})})}
 // Best-effort stop monitoring while this panel is open, NOT a guaranteed exchange stop.
 useEffect(()=>{if(!position||!live||!matching||busy||pending||!secret||!accountData?.healthy)return
  if(position.side==='long'?(quote!.price<=position.stop||(position.take!==undefined&&quote!.price>=position.take)):(quote!.price>=position.stop||(position.take!==undefined&&quote!.price<=position.take))){
   const attempt=`${account?.revision}:${quote!.timestamp}`
   if(autoAttempt.current!==attempt){autoAttempt.current=attempt;order('close')}
  }
 },[quote,account?.revision,live,secret,busy,pending])
 const halted=!!account&&((account.day===new Date(now).toISOString().slice(0,10)&&account.daily_pnl<=-LIMITS.dailyLoss)||account.streak>=LIMITS.streak)
 const permitted=!!secret&&!!accountData?.healthy&&live&&!busy&&!pending
 const unrealized=position&&live&&matching?(position.side==='long'?quote!.price-position.entry:position.entry-quote!.price)*position.quantity:null
 const equity=account?(position?(unrealized===null?null:(account.cash+position.notional)/UNIT+unrealized):account.cash/UNIT):null
 const exportCsv=()=>{const rows=['id,time,action,symbol,fill,pnl_micro_usdt,fee_micro_usdt',...(accountData?.orders??[]).map(o=>[o.id,new Date(o.time).toISOString(),o.action,o.symbol,o.fill,o.pnl,o.fee].map(v=>'"'+String(v).replaceAll('"','""')+'"').join(','))];const url=URL.createObjectURL(new Blob([rows.join('\n')],{type:'text/csv'}));const a=document.createElement('a');a.href=url;a.download='simulation-ledger.csv';a.click();URL.revokeObjectURL(url)}
 return <main className="sim-v2"><header><div className="eyebrow">V2.0 · 仅模拟 · D1 原子账本</div><h1>1000U 模拟操盘</h1><p>不连接交易账户，不发送交易所订单。使用公开永续合约行情的中间价，加 0.03% 模拟滑点和单边 0.05% 手续费。</p></header>
 <section className="sim-auth"><label>模拟账户访问密钥<input type="password" autoComplete="off" value={secret} onChange={e=>setSecret(e.target.value)} placeholder="独立预览环境的 SIM_API_KEY（仅保存在内存）"/></label><p>初始虚拟资金 1000U；单笔 ≤250U；计划风险 ≤5U；日亏损 ≥20U 或连亏3笔停止开仓。</p></section>
 {error&&<div role="alert" className="data-error">{error}</div>}{pending&&<div role="alert" className="risk-banner warn">订单 {pending.id} 尚未确认。请使用原幂等键查询或重试；不会创建第二笔订单。<button disabled={busy||!secret} onClick={()=>void send(pending)}>重试原订单</button></div>}
 <section className="sim-metrics"><div>可用资金<b>{account?`${money(account.cash/UNIT)} U`:'—'}</b></div><div>估算权益（未扣平仓费）<b>{equity===null?'—':`${money(equity)} U`}</b></div><div>今日已实现净损益 UTC<b>{account?`${money(account.day===new Date(now).toISOString().slice(0,10)?account.daily_pnl/UNIT:0)} U`:'—'}</b></div><div>账本状态<b>{accountData?(accountData.healthy?'审计通过':'审计失败 · 拒绝交易'):'未连接'}</b><span>连续亏损 {account?.streak??'—'} 笔 · {halted?'已熔断':'等待服务端风控校验'}</span></div></section>
 <div className="sim-columns"><section className="trade-card"><h2>模拟订单</h2><label>品种<select value={symbol} onChange={e=>setSymbol(e.target.value as SymbolId)}>{['BTCUSDT','ETHUSDT','SOLUSDT'].map(s=><option key={s}>{s}</option>)}</select></label><b className={live?'positive':'negative'}>{live?'报价可用':'报价不可用 · 拒绝成交'}</b><p>{quote?`${money(quote.price)} USDT · ${quote.source} · ${new Date(quote.timestamp).toLocaleTimeString()}`:'等待真实行情'}</p><p>方向：现货模拟做多（第一阶段禁止新开空单）</p><label>名义仓位 U（最多250）<input type="number" min="0.01" max="250" value={size} onChange={e=>setSize(e.target.value)}/></label><label>止损价（必填，计划风险含费用及0.5%止损滑点）<input type="number" min="0" value={stop} onChange={e=>setStop(e.target.value)}/></label><label>止盈价（可选）<input type="number" min="0" value={take} onChange={e=>setTake(e.target.value)}/></label><button className="primary" disabled={!permitted||!!position||halted} onClick={()=>order('open')}>提交模拟开仓</button><p>成交价格相对提交时参考价偏移超过 0.5% 时拒绝。超过10秒无新报价，开平仓均停止。</p></section>
 <section className="trade-card"><h2>模拟持仓</h2>{position?<><p>{position.symbol} · {position.side==='long'?'多头':'空头'}</p><p>开仓 {money(position.entry)} · 数量 {position.quantity.toPrecision(8)}</p><p>仓位 {money(position.notional/UNIT)} U · 止损 {money(position.stop)} · 止盈 {position.take===undefined?'未设置':money(position.take)}</p><p>未实现盈亏 {unrealized===null?'不可估值':`${money(unrealized)} U`}</p><button className="primary" disabled={!permitted||!matching} onClick={()=>order('close')}>模拟平仓</button>{!matching&&<p>请切换到持仓品种后平仓。</p>}</>:<p>暂无持仓</p>}<p>止损仅在面板开启、鉴权且行情有效时自动监测。断线、跳空及页面关闭可能使实际模拟损失超过5U预算；熔断允许平仓以降低风险。</p><p>连亏熔断无自动重置；日亏损按 UTC 统计净已实现损益，包含开平仓费用。账户不提供清空账本或重置资金入口。</p></section></div>
 <section className="trade-card"><h2>CVD / OI / VWAP / 资金费率研究</h2>{researchError&&<p role="alert">{researchError}</p>}{research?<><p>{research.source} · 窗口 {new Date(research.from).toLocaleTimeString()}—{new Date(research.to).toLocaleTimeString()} · {research.samples} 笔{now-research.to>=10000?' · 样本已过期':''}</p><div className="sim-metrics"><div>窗口 CVD<b>{money(research.cvd)}</b><span>{research.cvdUnit}</span></div><div>窗口 VWAP<b>{money(research.vwap)} USDT</b></div><div>持仓量 OI<b>{research.openInterest===null?'无数据':money(research.openInterest)}</b><span>{research.oiUnit} · {research.oiTime?new Date(research.oiTime).toLocaleTimeString():'时间未知'}</span></div><div>资金费率<b>{research.fundingRate===null?'无数据':`${money(research.fundingRate*100)}%`}</b><span>{research.fundingTime?new Date(research.fundingTime).toLocaleTimeString():'时间未知'}</span></div></div>{research.errors.map(x=><p key={x}>{x}</p>)}<p>CVD 为当前返回成交样本的主动买入减主动卖出；VWAP 为该窗口的成交量加权价，不代表全天数据。不同交易所的数量单位和窗口不同，不拼接或填造缺失值。</p></>:<p>等待公开交易所研究数据，不生成替代数值。</p>}</section>
 <section className="trade-card"><h2>已确认订单与资金审计</h2><button disabled={!accountData?.orders.length} onClick={exportCsv}>导出最近100笔 CSV</button><div className="sim-table"><table><thead><tr><th>时间</th><th>动作</th><th>品种</th><th>成交价</th><th>净损益 U</th><th>费用 U</th></tr></thead><tbody>{accountData?.orders.map(o=><tr key={o.id}><td>{new Date(o.time).toLocaleString()}</td><td>{o.action==='open'?'模拟开仓':'模拟平仓'}</td><td>{o.symbol}</td><td>{money(o.fill)}</td><td>{money(o.pnl/UNIT)}</td><td>{money(o.fee/UNIT)}</td></tr>)}</tbody></table></div></section></main>
}
