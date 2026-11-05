import { useState } from 'react'
import { atr, bollinger, ema, rollingVolatility, rsi, sma } from '../lib/indicators'
import { readReports } from '../lib/archive'
import { deleteSnapshot, readSnapshots, saveSnapshot, type ResearchSnapshot } from '../lib/researchArchive'
import type { Candle, IntervalId, SymbolId, Ticker } from '../types'

const f=(value?:number,digits=2)=>value===undefined?'—':value.toFixed(digits)
type Tone='positive'|'negative'|''
type Module={number:string;title:string;state:string;tone?:Tone;evidence:string[];limit:string}
function Card({number,title,state,tone='',evidence,limit}:Module){return <article className="ai-module"><div className="ai-module-head"><span>AI {number}</span><h2>{title}</h2><b className={tone}>{state}</b></div><ul>{evidence.map(x=><li key={x}>{x}</li>)}</ul><p className="ai-limitation">边界：{limit}</p></article>}

export function ResearchPage({candles,ticker,symbol,interval}:{candles:Candle[];ticker:Ticker|null;symbol:SymbolId;interval:IntervalId}){
 const [snapshots,setSnapshots]=useState<ResearchSnapshot[]>(readSnapshots)
 const completed=candles.filter(c=>c.closed!==false),ma7=sma(completed,7).at(-1)?.value,ma25=sma(completed,25).at(-1)?.value,ma99=sma(completed,99).at(-1)?.value,ema12=ema(completed,12).at(-1)?.value,ema26=ema(completed,26).at(-1)?.value,r=rsi(completed).at(-1)?.value,a=atr(completed).at(-1)?.value,v=rollingVolatility(completed).at(-1)?.value
 const bb=bollinger(completed),mid=bb.middle.at(-1)?.value,up=bb.upper.at(-1)?.value,low=bb.lower.at(-1)?.value,width=mid&&up&&low?(up-low)/mid*100:undefined
 const currentVolume=completed.at(-1)?.volume,averageVolume=completed.slice(-21,-1).reduce((n,c)=>n+c.volume,0)/20,volumeRatio=currentVolume&&averageVolume>0?currentVolume/averageVolume:undefined
 const enough=Boolean(ticker&&ma7&&ma25&&ma99&&ema12&&ema26&&r!==undefined),bull=enough&&ma7!>ma25!&&ma25!>ma99!&&ema12!>ema26!&&r!>=50,bear=enough&&ma7!<ma25!&&ma25!<ma99!&&ema12!<ema26!&&r!<=50
 const trend=!enough?'证据不足':bull?'趋势偏多':bear?'趋势偏空':'趋势观望',trendTone:Tone=bull?'positive':bear?'negative':''
 const high=v!==undefined&&v>2,riskPct=a&&ticker?a/ticker.price*100:undefined,risk=riskPct===undefined?'证据不足':high||riskPct>3?'风险偏高':riskPct>1?'风险中等':'风险较低',riskTone:Tone=risk==='风险偏高'?'negative':''
 const strategy=!enough?'证据不足':ma7!>ma25!?'MA 多头条件':ma7!<ma25!?'MA 空头条件':'无交叉条件',decision=!enough||high?'观望':bull?'偏多':bear?'偏空':'观望',decisionTone:Tone=decision==='偏多'?'positive':decision==='偏空'?'negative':''
 const relationship=ma7&&ma25?(ma7>ma25?'>':ma7<ma25?'<':'='):'—',time=ticker?new Date(ticker.updatedAt).toLocaleString('zh-CN'):'—'
 const latestReport=readReports()[0]
 const modules:Module[]=[
  {number:'01',title:'趋势研究',state:trend,tone:trendTone,evidence:[`MA 7 / 25 / 99：${f(ma7)} / ${f(ma25)} / ${f(ma99)}`,`EMA 12 / 26：${f(ema12)} / ${f(ema26)}`,`RSI 14：${f(r)}`],limit:'仅代表当前已载入周期，不代表跨周期趋势。'},
  {number:'02',title:'资金研究',state:volumeRatio===undefined?'证据不足':volumeRatio>=1.5?'成交活跃':'成交平稳',tone:volumeRatio&&volumeRatio>=1.5?'positive':'',evidence:[`当前成交量：${f(currentVolume,4)}`,`相对 20 根均量：${volumeRatio===undefined?'—':`${f(volumeRatio)}x`}`,'公开 K 线成交量可用'],limit:'不含订单流、主动买卖和资金费率，故不输出资金方向。'},
  {number:'03',title:'波动研究',state:v===undefined?'证据不足':high?'高波动':v>.8?'中等波动':'低波动',tone:high?'negative':'',evidence:[`ATR 14：${f(a)}`,`滚动波动率：${f(v,3)}%`,`布林带宽：${f(width)}%`],limit:'描述历史分布，不预测未来振幅。'},
  {number:'04',title:'风险研究',state:risk,tone:riskTone,evidence:[`单 ATR 相对价格：${f(riskPct)}%`,`RSI 14：${f(r)}`,`波动阈值：${high?'超过观望阈值':'未超过观望阈值'}`],limit:'不设定仓位或止损；实际风险还受流动性和滑点影响。'},
  {number:'05',title:'策略研究',state:strategy,tone:strategy.includes('多头')?'positive':strategy.includes('空头')?'negative':'',evidence:[`规则：MA 7 ${relationship} MA 25`,'候选规则：MA(7/25) 趋势跟随',latestReport?`最近保存回测：${latestReport.symbol.replace('USDT','/USDT')} 样本外 ${latestReport.outsideReturn.toFixed(2)}%`:'尚无已保存回测报告'],limit:'条件成立不等同于交易信号；仅引用用户保存的真实历史回测，不将其标为高胜率。'},
  {number:'06',title:'综合决策',state:decision,tone:decisionTone,evidence:[`趋势模块：${trend}`,`波动模块：${high?'高波动，触发观望':'未触发高波动观望'}`,`风险模块：${risk}`],limit:'规则汇总不是投资建议；模块分歧或证据不足时默认观望。'}]
 const save=()=>{if(!ticker||!enough)return;saveSnapshot({id:crypto.randomUUID(),createdAt:Date.now(),symbol,interval,source:ticker.source,price:ticker.price,decision,risk,evidence:[`MA7 ${f(ma7)} / MA25 ${f(ma25)}`,`RSI ${f(r)}`,`ATR 风险 ${f(riskPct)}%`,...modules[5].evidence]});setSnapshots(readSnapshots())}
 return <main className="backtest-page research-page"><div className="backtest-heading"><div><div className="eyebrow">六 AI · 可审计规则引擎</div><h1>研究中心</h1><p>每个模块只展示可复核指标、数据来源和规则边界；无证据不产生方向结论。</p></div><div className="research-stamp"><span>数据时间</span><b>{time}</b><small>{ticker?.source??'等待公开行情'}</small><button className="subtle-button" disabled={!ticker||!enough} onClick={save}>保存研究快照</button></div></div><section className="research-summary"><Summary title="综合决策" value={decision} tone={decisionTone} text={high?'高波动触发观望规则。':'趋势、波动与风险规则汇总。'}/><Summary title="证据完整度" value={enough&&riskPct!==undefined?'可用':'不足'} text="K 线不足时模块拒绝给方向。"/><Summary title="风险等级" value={risk} tone={riskTone} text={`ATR 风险 ${f(riskPct)}% · 波动率 ${f(v,3)}%`}/></section><section className="ai-modules">{modules.map(x=><Card key={x.number}{...x}/>)}</section><section className="metrics research-metrics"><Metric t="MA 7" v={f(ma7)}/><Metric t="MA 25" v={f(ma25)}/><Metric t="RSI 14" v={f(r)}/><Metric t="ATR 14" v={f(a)}/><Metric t="波动率 %" v={f(v,3)}/><Metric t="布林带宽 %" v={f(width)}/></section><section className="trade-card snapshots"><div className="card-title-row"><h2>已保存研究快照（本浏览器）</h2><span>{snapshots.length} / 30</span></div>{snapshots.length?<div className="report-list">{snapshots.map(x=><div key={x.id}><span>{new Date(x.createdAt).toLocaleString('zh-CN')}</span><b>{x.symbol.replace('USDT','/USDT')} · {x.interval} · {x.decision}</b><span>{x.risk} · {x.source}</span><button className="reset" onClick={()=>{deleteSnapshot(x.id);setSnapshots(readSnapshots())}}>删除</button></div>)}</div>:<p className="no-trades">保存后将固定记录品种、周期、价格、来源、规则结论与证据；不写入公共接口。</p>}</section><p className="backtest-note">证据时间：{time}。所有指标按 K 线时间顺序计算，不使用未来数据。</p></main>
}
function Summary({title,value,tone='',text}:{title:string;value:string;tone?:Tone;text:string}){return <div><span>{title}</span><h2 className={tone}>{value}</h2><p>{text}</p></div>}
function Metric({t,v}:{t:string;v:string}){return <div><span>{t}</span><b>{v}</b></div>}
