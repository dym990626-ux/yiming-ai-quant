import { useEffect, useMemo, useState } from 'react'
import { fetchKlines, intervals, symbols } from '../lib/market'
import { runMaCrossBacktest, type BacktestResult, type BacktestSettings, type StrategyId } from '../lib/backtest'
import { sma, rsi } from '../lib/indicators'
import type { Candle, IntervalId, SymbolId } from '../types'

const STRATEGIES: { id:StrategyId; name:string; tag:string }[]=[
 {id:'ma-cross',name:'MA 7 / 25 趋势跟踪',tag:'TREND'},
 {id:'ema-cross',name:'EMA 12 / 26 动量追踪',tag:'MOMENTUM'},
 {id:'rsi-reversion',name:'RSI 14 均值回归',tag:'REVERSION'},
]
type ResearchRow={id:StrategyId;name:string;result:BacktestResult|null;error?:string}
const value=(n:number,d=2)=>Number.isFinite(n)?n.toFixed(d):'—'
const clock=(t:number)=>new Date(t*1000).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})
export function ShadowResearchPage(){
 const [symbol,setSymbol]=useState<SymbolId>('BTCUSDT')
 const [interval,setInterval]=useState<IntervalId>('1h')
 const [candles,setCandles]=useState<Candle[]>([])
 const [source,setSource]=useState('')
 const [error,setError]=useState('')
 const [loading,setLoading]=useState(false)
 const [feePct,setFeePct]=useState(.1)
 const [slipPct,setSlipPct]=useState(.05)
 const [position,setPosition]=useState(0)
 const [sample,setSample]=useState<'train'|'test'>('test')
 const [simStatus,setSimStatus]=useState('正在读取真实后端风控状态…')
 useEffect(()=>{
  let active=true
  const controller=new AbortController()
  fetch('/api/sim/status',{cache:'no-store',signal:controller.signal})
   .then(async r=>{if(!r.ok)throw Error('后端风控接口不可用');return r.json() as Promise<{serverExecutionEnabled:boolean;ledgerSchemaReady:boolean}>})
   .then(x=>{if(active)setSimStatus(x.serverExecutionEnabled?'服务端模拟成交已开启（需验收）':`服务端模拟成交关闭 · D1 账本${x.ledgerSchemaReady?'表已就绪':'未就绪'} · 当前禁止真实交易`)})
   .catch(()=>{if(active)setSimStatus('无法确认后端风控状态；此页面仅允许离线研究')})
  return()=>{active=false;controller.abort()}
 },[])
 const load=async()=>{
  setLoading(true);setError('');setCandles([]);setSource('')
  try{
   const result=await fetchKlines(symbol,interval)
   const clean=result.filter(c=>c.closed!==false && [c.open,c.high,c.low,c.close,c.volume,c.time].every(Number.isFinite) && c.open>0 && c.close>0)
   clean.sort((a,b)=>a.time-b.time)
   const unique=clean.filter((c,i)=>i===0||c.time!==clean[i-1].time)
   if(unique.length<100)throw Error('已完成历史 K 线不足100根，无法执行可信样本外比较')
   setCandles(unique);setSource(`已验证公开历史 K 线 ${unique.length} 根 · ${clock(unique[0].time)} 至 ${clock(unique[unique.length-1].time)}`)
   setPosition(0)
  }catch(e){setError(e instanceof Error?e.message:'公开数据无法读取')}
  finally{setLoading(false)}
 }
 useEffect(()=>{void load()},[symbol,interval])
 const split=Math.floor(candles.length*.7)
 const activeCandles=sample==='train'?candles.slice(0,split):candles.slice(split)
 const settingsBase:Omit<BacktestSettings,'strategy'>={initialCapital:10000,feeRate:feePct/100,slippageRate:slipPct/100,interval}
 const research=useMemo(()=>{
  if(candles.length<100)return [] as ResearchRow[]
  return STRATEGIES.map(strategy=>{
   try{
    // Training and holdout periods are disjoint; the evaluation function never sees later candles.
    const chunk=sample==='train'?candles.slice(0,split):candles.slice(split)
    const result=runMaCrossBacktest(chunk,{...settingsBase,strategy:strategy.id})
    return {id:strategy.id,name:strategy.name,result}
   }catch(e){return {id:strategy.id,name:strategy.name,result:null,error:e instanceof Error?e.message:'回测失败'}}
  })
 },[candles,split,sample,interval,feePct,slipPct])
 const totalAbsolute=research.reduce((sum,r)=>sum+Math.abs(r.result ? r.result.finalEquity-10000 : 0),0)
 const replayCandles=activeCandles
 const replayIndex=Math.min(replayCandles.length-1,Math.max(0,position||Math.min(30,replayCandles.length-1)))
 const replayHistory=useMemo(()=>replayCandles.slice(0,replayIndex+1),[replayCandles,replayIndex])
 const replayLast=replayHistory.at(-1)
 const movingFast=useMemo(()=>sma(replayHistory,7).at(-1)?.value,[replayHistory])
 const movingSlow=useMemo(()=>sma(replayHistory,25).at(-1)?.value,[replayHistory])
 const strength=useMemo(()=>rsi(replayHistory,14).at(-1)?.value,[replayHistory])
 const replayDirection=movingFast===undefined||movingSlow===undefined?'等待指标预热':movingFast>movingSlow?'均线偏多':movingFast<movingSlow?'均线偏空':'均线中性'
 const move=(next:number)=>setPosition(Math.min(replayCandles.length-1,Math.max(0,next)))
 return <main className="sr-page">
  <div className="sr-heading"><div><div className="eyebrow">YIMING QUANT / INSTITUTIONAL RESEARCH WORKSPACE</div><h1>SHADOW RESEARCH <span>影子研究</span></h1><p>真实历史、策略独立归因、逐根遥测回放与风控状态核验。仅为研究沙盒，不下达交易所订单。</p></div><div className="sr-version"><span>STARWAVE SHADOW RESEARCH</span><b>RESEARCH MODE</b><small>{simStatus}</small></div></div>
  <div className="sr-controls">
   <label>交易品种<select value={symbol} onChange={e=>setSymbol(e.target.value as SymbolId)}>{(Object.keys(symbols) as SymbolId[]).map(id=><option key={id} value={id}>{symbols[id].label}</option>)}</select></label>
   <label>K 线周期<select value={interval} onChange={e=>setInterval(e.target.value as IntervalId)}>{intervals.map(i=><option key={i.id} value={i.id}>{i.label}</option>)}</select></label>
   <label>手续费 %<input type="number" min="0" max="5" step=".01" value={feePct} onChange={e=>setFeePct(Math.max(0,Math.min(5,Number(e.target.value)||0)))}/></label>
   <label>滑点 %<input type="number" min="0" max="5" step=".01" value={slipPct} onChange={e=>setSlipPct(Math.max(0,Math.min(5,Number(e.target.value)||0)))}/></label>
   <button onClick={()=>void load()} disabled={loading}>{loading?'读取历史中…':'刷新真实数据'}</button>
  </div>
  {error?<p className="sr-error">{error}</p>:<p className="sr-provenance">{source||'正在读取真实历史数据…'} · 时间顺序70%研究 / 30%独立样本外 · 已纳入手续费和滑点</p>}
  <div className="sr-section-head"><div><span>01 / STRATEGY ATTRIBUTION</span><h2>多策略独立绩效透视</h2></div><div className="sr-tabs"><button className={sample==='train'?'active':''} onClick={()=>{setSample('train');setPosition(0)}}>研究样本 70%</button><button className={sample==='test'?'active':''} onClick={()=>{setSample('test');setPosition(0)}}>样本外 30%</button></div></div>
  <div className="sr-strategies">{research.map(row=>{
   const result=row.result,delta=result?result.finalEquity-10000:0
   return <div className="sr-strategy" key={row.id}>
    <div className="sr-strategy-head"><div><small>{STRATEGIES.find(x=>x.id===row.id)?.tag}</small><strong>{row.name}</strong></div><b className={delta>=0?'positive':'negative'}>{result?`${delta>=0?'+':''}${value(delta)} U`:'—'}</b></div>
    {result?<><div className="sr-strategy-stats"><span>净收益 <b>{value(result.netReturn)}%</b></span><span>最大回撤 <b>{value(result.maxDrawdown)}%</b></span><span>完整交易 <b>{result.totalTrades}</b></span><span>胜率 <b>{result.totalTrades?value(result.winRate)+'%':'无样本'}</b></span></div><div className="sr-attribution-bar"><i style={{width:`${totalAbsolute?100*Math.abs(delta)/totalAbsolute:0}%`}}/></div><p>单策略净损益绝对值占比：{totalAbsolute?value(100*Math.abs(delta)/totalAbsolute):'—'}%。此比例仅用于比较独立运行结果，不能相加作为组合盈亏贡献。</p></>:<p>{row.error||'尚无结果'}</p>}
   </div>
  })}</div>
  <div className="sr-section-head"><div><span>02 / TELEMETRY REPLAY</span><h2>逐根行情回放</h2></div><small>无未来 K 线参与当前回放指标</small></div>
  <div className="sr-replay">
    <div className="sr-replay-chart">
      <div className="sr-replay-header"><span>{replayLast?clock(replayLast.time):'—'}</span><b>{replayLast?value(replayLast.close,2):'—'} USDT</b><small>{replayIndex+1}/{replayCandles.length} 根</small></div>
      <svg viewBox="0 0 680 220" role="img" aria-label="逐根回放的历史收盘价格线">
       {(()=>{
        const visible=replayHistory.slice(-80)
        if(visible.length<2)return null
        const min=Math.min(...visible.map(c=>c.low)),max=Math.max(...visible.map(c=>c.high)),range=Math.max(1e-9,max-min)
        const path=visible.map((c,i)=>`${i?'L':'M'}${30+i*620/(visible.length-1)},${195-(c.close-min)/range*164}`).join(' ')
        return <><path d={path} stroke="#4ddeb5" fill="none" strokeWidth="2.5"/><path d={`${path} L650 195 L30 195 Z`} fill="rgba(63,211,167,.07)"/></>
       })()}
      </svg>
      <div className="sr-replay-controls"><button onClick={()=>move(replayIndex-1)} disabled={replayIndex<=0}>上一根</button><input type="range" min={0} max={Math.max(0,replayCandles.length-1)} value={Math.max(0,replayIndex)} onChange={e=>move(Number(e.target.value))}/><button onClick={()=>move(replayIndex+1)} disabled={replayIndex>=replayCandles.length-1}>下一根</button></div>
    </div>
    <div className="sr-replay-evidence">
      <h3>TIME-LOCKED SIGNAL EVIDENCE</h3>
      <div><span>MA7</span><b>{movingFast===undefined?'—':value(movingFast)}</b></div>
      <div><span>MA25</span><b>{movingSlow===undefined?'—':value(movingSlow)}</b></div>
      <div><span>RSI14</span><b>{strength===undefined?'—':value(strength)}</b></div>
      <div><span>规则结论</span><b>{replayDirection}</b></div>
      <p>每次只用当前及更早的已完成 K 线计算指标。拖动时间轴不会提前读取后续数据来生成当前结论。</p>
    </div>
  </div>
  <div className="sr-section-head"><div><span>03 / RISK GUARDRAILS</span><h2>真实系统保护状态</h2></div></div>
  <div className="sr-risk">
   <div><span>单笔风险上限</span><b>5 U</b><small>Worker 准入规则</small></div>
   <div><span>单笔名义价值上限</span><b>250 U</b><small>Worker 准入规则</small></div>
   <div><span>当日亏损熔断</span><b>-20 U</b><small>达到阈值拒绝</small></div>
   <div><span>模拟成交引擎</span><b>未启用</b><small>不可把本地模拟当作服务端风控</small></div>
  </div>
  <p className="sr-disclaimer">研究报告是独立策略比较，不代表合成组合归因；无真实资金交易、无账户持仓识别。当前回放是历史 K 线级别，不是逐笔订单薄遥测重建，也不是交易所级仿真。完整 D1 原子账本仍需单独验收。</p>
 </main>
}
