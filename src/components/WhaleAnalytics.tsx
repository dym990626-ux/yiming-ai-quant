import { useMemo, useState } from 'react'

type Print = {id:string;timestamp:number;price:number;qty:number;notional:number;aggressor:'buy'|'sell';source:string}
const levels=[{threshold:1000,label:'≥1千 U'},{threshold:10000,label:'≥1万 U'},{threshold:50000,label:'≥5万 U'},{threshold:100000,label:'≥10万 U'},{threshold:500000,label:'≥50万 U'},{threshold:1000000,label:'≥100万 U'}] as const
const num=(n:number)=>new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:2}).format(n)
const full=(n:number)=>new Intl.NumberFormat('en-US',{maximumFractionDigits:2}).format(n)
export function WhaleAnalytics({trades,source,fetchedAt}:{trades:Print[];source:string;fetchedAt:number|null}){
 const [windowMinutes,setWindowMinutes]=useState<1|5|15>(5)
 const latest=trades.length?Math.max(...trades.map(t=>t.timestamp)):0
 const earliest=trades.length?Math.min(...trades.map(t=>t.timestamp)):0
 const period=windowMinutes*60_000
 const start=latest-period
 const filtered=useMemo(()=>trades.filter(t=>t.timestamp>=start&&t.timestamp<=latest&&Number.isFinite(t.notional)&&t.notional>0),[trades,start,latest])
 const sums=useMemo(()=>filtered.reduce((acc,t)=>{if(t.aggressor==='buy')acc.buy+=t.notional;else acc.sell+=t.notional;return acc},{buy:0,sell:0}),[filtered])
 const total=sums.buy+sums.sell
 const bins=useMemo(()=>Array.from({length:12},(_,i)=>{
  const lo=start+i*period/12,hi=lo+period/12
  const bucket=filtered.filter(t=>t.timestamp>=lo&&(i===11?t.timestamp<=hi:t.timestamp<hi))
  return {buy:bucket.filter(t=>t.aggressor==='buy').reduce((a,t)=>a+t.notional,0),sell:bucket.filter(t=>t.aggressor==='sell').reduce((a,t)=>a+t.notional,0),count:bucket.length}
 }),[filtered,start,period])
 const max=Math.max(1,...bins.map(b=>b.buy+b.sell))
 const ranking=useMemo(()=>[...trades].filter(t=>Number.isFinite(t.notional)&&t.notional>0).sort((a,b)=>b.notional-a.notional).slice(0,12),[trades])
 const span=latest&&earliest?(latest-earliest)/1000:0
 return <section className="wa-root">
  <div className="wa-caption"><div><span className="eyebrow">ORDER FLOW INTELLIGENCE</span><h2>资金流向 · 大单分级</h2></div><small>{source||'等待数据源'} · {fetchedAt?new Date(fetchedAt).toLocaleTimeString('zh-CN'):'未更新'}</small></div>
  <div className="wa-tile-grid">
   <div className="wa-tile"><span>样本总成交额</span><b>{num(total)} <small>U</small></b></div>
   <div className="wa-tile"><span>主动净买卖差</span><b className={sums.buy>=sums.sell?'positive':'negative'}>{sums.buy>=sums.sell?'+':''}{num(sums.buy-sums.sell)} <small>U</small></b></div>
   <div className="wa-tile"><span>主动买入占比</span><b className="positive">{total?(100*sums.buy/total).toFixed(1):'—'}%</b></div>
   <div className="wa-tile"><span>有效成交笔数</span><b>{filtered.length} <small>笔</small></b></div>
  </div>
  <div className="wa-columns">
   <div className="wa-panel">
    <div className="wa-panel-head"><strong>主动买卖成交额趋势</strong><div className="wa-periods">{([1,5,15] as const).map(n=><button key={n} className={windowMinutes===n?'active':''} onClick={()=>setWindowMinutes(n)}>{n}分</button>)}</div></div>
    {filtered.length?<svg viewBox="0 0 650 220" role="img" aria-label="按时间段划分的主动买卖成交额柱状图，绿色为主动买，红色为主动卖" preserveAspectRatio="xMidYMid meet">
      {bins.map((b,i)=>{const hBuy=150*b.buy/max,hSell=150*b.sell/max,x=45+i*48;return <g key={i}>
       <rect x={x} y={178-hBuy-hSell} width={28} height={hBuy} rx={2} fill="#38d9aa"/>
       <rect x={x} y={178-hSell} width={28} height={hSell} rx={2} fill="#ed677a"/>
       <text x={x+14} y={201} textAnchor="middle" fontSize="10" fill="#8bb5a2">{i%2===0?new Date(start+(i+1)*period/12).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',second:'2-digit'}).slice(3):''}</text>
      </g>})}
      <line x1="33" x2="625" y1="178" y2="178" stroke="#3d5f51"/>
     </svg>:<p className="wa-empty">当前样本没有落在此时间窗口内的成交。</p>}
    <div className="wa-legend"><span><i className="wa-buy"/> 主动买入 {num(sums.buy)} U</span><span><i className="wa-sell"/> 主动卖出 {num(sums.sell)} U</span></div>
    <p className="wa-hint">基于交易所最近返回的 {trades.length} 笔现货成交样本，实际时间跨度约 {span.toFixed(1)} 秒。1/5/15 分钟是筛选窗口，样本未覆盖的时间不表示零成交；不能当作全市场连续资金流或净入金。</p>
   </div>
   <div className="wa-panel">
    <div className="wa-panel-head"><strong>大额成交门槛分布</strong><small>每档包含更高档成交，非互斥</small></div>
    <div className="wa-levels">{levels.map(l=>{const rows=trades.filter(t=>t.notional>=l.threshold);const amount=rows.reduce((a,t)=>a+t.notional,0);return <div className="wa-level" key={l.threshold}><span>{l.label}</span><div className="wa-meter"><i style={{width:`${trades.length?100*rows.length/trades.length:0}%`}}/></div><b>{rows.length} 笔</b><small>{num(amount)} U</small></div>})}</div>
    <p className="wa-hint">这是交易所返回样本的成交金额分布，不是鲸鱼账户身份识别。</p>
   </div>
  </div>
  <div className="wa-panel wa-ranking">
   <div className="wa-panel-head"><strong>单笔成交金额 TOP 12</strong><small>仅本次 REST 样本</small></div>
   {ranking.length?<div className="wa-ranking-scroll"><table><thead><tr><th>排名</th><th>时间</th><th>方向</th><th>成交价</th><th>数量</th><th>金额 (USDT)</th></tr></thead><tbody>{ranking.map((r,i)=><tr key={r.source+':'+r.id}><td>{i+1}</td><td>{new Date(r.timestamp).toLocaleTimeString('zh-CN')}</td><td className={r.aggressor==='buy'?'positive':'negative'}>{r.aggressor==='buy'?'主动买入':'主动卖出'}</td><td>{full(r.price)}</td><td>{full(r.qty)}</td><td><b>{full(r.notional)}</b></td></tr>)}</tbody></table></div>:<p className="wa-empty">等待真实交易所样本。</p>}
  </div>
 </section>
}
