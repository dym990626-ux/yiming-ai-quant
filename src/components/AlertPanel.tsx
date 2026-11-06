import { useEffect, useMemo, useState } from 'react'
import type { SymbolId, Ticker } from '../types'

type Alert = { id:string; symbol:SymbolId; direction:'above'|'below'; target:number; createdAt:number; triggeredAt?:number }
const key='yiming-price-alerts-v1'
const read=():Alert[]=>{try{return JSON.parse(localStorage.getItem(key)??'[]')}catch{return[]}}
const persist=(items:Alert[])=>localStorage.setItem(key,JSON.stringify(items.slice(0,20)))
const money=(v:number)=>new Intl.NumberFormat('en-US',{maximumFractionDigits:2}).format(v)

export function AlertPanel({symbol,ticker}:{symbol:SymbolId;ticker:Ticker|null}){
 const [alerts,setAlerts]=useState<Alert[]>(read),[direction,setDirection]=useState<Alert['direction']>('above'),[target,setTarget]=useState(''),[notice,setNotice]=useState<string|null>(null)
 const active=useMemo(()=>alerts.filter(x=>!x.triggeredAt),[alerts])
 useEffect(()=>{if(!ticker)return;const next=alerts.map(x=>x.triggeredAt?x:(x.symbol===symbol&&((x.direction==='above'&&ticker.price>=x.target)||(x.direction==='below'&&ticker.price<=x.target))?{...x,triggeredAt:Date.now()}:x));if(next.some((x,i)=>x.triggeredAt&&!alerts[i].triggeredAt)){persist(next);setAlerts(next);const hit=next.find((x,i)=>x.triggeredAt&&!alerts[i].triggeredAt);setNotice(hit?`${hit.symbol.replace('USDT','/USDT')} 已${hit.direction==='above'?'突破':'跌破'} ${money(hit.target)}`:null)}},[alerts,symbol,ticker])
 const add=()=>{const value=Number(target);if(!Number.isFinite(value)||value<=0){setNotice('请输入有效目标价');return}const next=[{id:crypto.randomUUID(),symbol,direction,target:value,createdAt:Date.now()},...alerts];persist(next);setAlerts(next);setTarget('');setNotice(`已创建 ${symbol.replace('USDT','/USDT')} 价格提醒`)}
 const remove=(id:string)=>{const next=alerts.filter(x=>x.id!==id);persist(next);setAlerts(next)}
 return <section className="alert-panel"><div className="panel-title">价格告警 <span>本浏览器</span></div><div className="alert-form"><select value={direction} onChange={e=>setDirection(e.target.value as Alert['direction'])}><option value="above">价格突破</option><option value="below">价格跌破</option></select><input aria-label="告警目标价" type="number" min="0" placeholder="目标价" value={target} onChange={e=>setTarget(e.target.value)}/><button onClick={add}>添加</button></div>{notice&&<p className="alert-notice">{notice}</p>}<div className="alert-list">{active.length?active.map(x=><div key={x.id}><span>{x.symbol.replace('USDT','/USDT')}</span><b>{x.direction==='above'?'≥':'≤'} {money(x.target)}</b><button aria-label="删除告警" onClick={()=>remove(x.id)}>×</button></div>):<p>未设置价格提醒。提醒只在本站点保持打开且接收到真实行情时触发。</p>}</div>{alerts.some(x=>x.triggeredAt)&&<button className="clear-alerts" onClick={()=>{const next=alerts.filter(x=>!x.triggeredAt);persist(next);setAlerts(next)}}>清除已触发提醒</button>}</section>
}
