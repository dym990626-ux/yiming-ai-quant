import { useEffect, useState } from 'react'

type Exchange='binance'|'okx'
type View='balances'|'positions'|'orders'
type AccountStatus={
 mode:'read-only';tradingEnabled:false;configured:{binance:boolean;okx:boolean}
 checkedAt:string;supported:string[];disclaimer:string
}
type Row=Record<string,string|number|boolean|null>
type AccountData={exchange:Exchange;view:View;fetchedAt:number;source:string;accountType:string;records:Row[];warning:string}
const labels:Record<View,string>={balances:'账户资产',positions:'合约持仓',orders:'未完成委托'}
const exchanges:Record<Exchange,string>={binance:'Binance 币安',okx:'OKX 欧易'}
const time=(d:number)=>new Date(d).toLocaleString('zh-CN')
const format=(x:Row[string])=>typeof x==='number'?new Intl.NumberFormat('en-US',{maximumFractionDigits:8}).format(x):String(x??'—')
const rowLabels:Record<string,string>={
 asset:'资产',free:'可用',locked:'冻结',equity:'权益',available:'可用',cashBalance:'现金余额',
 equityUsd:'等值 USD',symbol:'交易对',side:'方向',qty:'数量',entryPrice:'开仓均价',markPrice:'标记价',
 liquidationPrice:'强平价',unrealizedPnl:'未实现盈亏',leverage:'杠杆',marginMode:'保证金模式',
 orderId:'订单号',type:'订单类型',status:'状态',price:'价格',origQty:'原数量',executedQty:'已成交'
}
export function ExchangeAccountsPage(){
 const [exchange,setExchange]=useState<Exchange>('binance')
 const [view,setView]=useState<View>('balances')
 const [status,setStatus]=useState<AccountStatus|null>(null)
 const [statusError,setStatusError]=useState('')
 const [data,setData]=useState<AccountData|null>(null)
 const [error,setError]=useState('')
 const [loading,setLoading]=useState(false)
 const [lastRefresh,setLastRefresh]=useState(0)
 useEffect(()=>{
   const ctl=new AbortController()
   void (async()=>{
     try{
      const r=await fetch('/api/exchange/status',{cache:'no-store',signal:ctl.signal,credentials:'same-origin'})
      const x=await r.json() as AccountStatus&{error?:string}
      if(!r.ok)throw Error(x.error==='ACCESS_NOT_CONFIGURED'?'尚未配置 Cloudflare Access 身份保护':x.error==='ACCESS_DENIED'?'没有账户读取权限：请先完成 Access 登录':'只读账户状态接口暂不可用')
      setStatus(x);setStatusError('')
     }catch(e){if(!ctl.signal.aborted){setStatus(null);setStatusError(e instanceof Error?e.message:'账户状态失败')}}
   })()
   return()=>ctl.abort()
 },[lastRefresh])
 useEffect(()=>{
   const ctl=new AbortController()
   setData(null);setError('')
   if(!status||!status.configured[exchange])return()=>ctl.abort()
   setLoading(true)
   void (async()=>{
    try{
     const r=await fetch(`/api/exchange/read?exchange=${exchange}&view=${view}`,{cache:'no-store',signal:ctl.signal,credentials:'same-origin'})
     const x=await r.json() as AccountData&{error?:string;message?:string}
     if(!r.ok||!Array.isArray(x.records))throw Error(x.message||'交易所只读请求失败')
     if(!ctl.signal.aborted)setData(x)
    }catch(e){if(!ctl.signal.aborted)setError(e instanceof Error?e.message:'读取失败')}
    finally{if(!ctl.signal.aborted)setLoading(false)}
   })()
   return()=>ctl.abort()
 },[exchange,view,status,lastRefresh])
 const ready=Boolean(status?.configured[exchange])
 const cols=data?.records[0]?Object.keys(data.records[0]):[]
 return <main className="exchange-account-page">
  <div className="exa-head">
    <div><div className="eyebrow">PRIVATE ACCOUNT CONNECTIVITY · READ ONLY</div><h1>交易所账户中心</h1><p>Binance / OKX · 只读资产、持仓和委托。密钥只保存在 Cloudflare Worker，绝不传入浏览器。</p></div>
    <div className="exa-lock"><strong>READ ONLY</strong><span>下单关闭 · 撤单关闭 · 提币关闭</span></div>
  </div>
  <section className="exa-state">
   <div><span>身份访问控制</span><b className={status?'positive':'negative'}>{status?'已通过 Cloudflare Access 验证':'未授权 / 未配置'}</b></div>
   <div><span>Binance 只读密钥</span><b>{status?status.configured.binance?'服务端已配置':'待配置':'不可验证'}</b></div>
   <div><span>OKX 只读密钥</span><b>{status?status.configured.okx?'服务端已配置':'待配置':'不可验证'}</b></div>
   <div><span>真实交易开关</span><b className="negative">永久关闭（本阶段）</b></div>
  </section>
  {statusError&&<div className="exa-error"><b>账户保护状态</b><p>{statusError}</p><p>所有私有资产接口会保持拒绝访问。请先在 Cloudflare Zero Trust 创建 Access 应用，再为 Worker 配置对应验证参数。</p></div>}
  <div className="exa-controls">
    <label>交易所<select value={exchange} onChange={e=>setExchange(e.target.value as Exchange)}><option value="binance">Binance 币安</option><option value="okx">OKX 欧易</option></select></label>
    <label>账户数据<select value={view} onChange={e=>setView(e.target.value as View)}><option value="balances">资产余额</option><option value="positions">合约持仓</option><option value="orders">未完成委托</option></select></label>
    <button onClick={()=>setLastRefresh(n=>n+1)} disabled={loading}>{loading?'正在读取…':'手动刷新'}</button>
  </div>
  <section className="exa-table">
   <div className="exa-table-heading"><div><strong>{exchanges[exchange]} · {labels[view]}</strong><small>{data?`${data.accountType} · ${time(data.fetchedAt)}`:'连接准备中'}</small></div><span>{data?`${data.records.length} 条`:'—'}</span></div>
   {!status?<p className="exa-empty">出于账户安全考虑，未通过身份验证时不展示资产或持仓。</p>:
    !ready?<p className="exa-empty">还未设置此交易所的服务端只读 API Key。不要将密钥填进网页或聊天。</p>:
    loading?<p className="exa-empty">正在安全读取交易所真实账户数据…</p>:
    error?<p className="exa-error">{error}</p>:
    data?.records.length?<div className="exa-scroll"><table><thead><tr>{cols.map(c=><th key={c}>{rowLabels[c]||c}</th>)}</tr></thead><tbody>
     {data.records.map((r,i)=><tr key={i}>{cols.map(c=><td key={c}>{format(r[c])}</td>)}</tr>)}
    </tbody></table></div>:<p className="exa-empty">{data?'交易所已返回有效响应，但此项没有非零资产 / 持仓 / 委托。':'等待真实账户响应。'}</p>}
   {data&&<p className="exa-source">数据来源：{data.source}。{data.warning||'仅展示交易所本次返回的实时账户样本。'}</p>}
  </section>
  <section className="exa-instructions"><h2>安全接入步骤</h2>
   <p>先启用 Cloudflare Access，并在 Worker Secrets 设置 <code>ACCESS_TEAM_DOMAIN</code>、<code>ACCESS_APP_AUD</code>。然后分别创建<strong>无交易、无提币权限</strong>的 Binance / OKX API Key，密钥仅写入 Worker Secrets。</p>
   <p>币安：<code>BINANCE_RO_API_KEY</code>、<code>BINANCE_RO_API_SECRET</code>。欧易：<code>OKX_RO_API_KEY</code>、<code>OKX_RO_API_SECRET</code>、<code>OKX_RO_PASSPHRASE</code>。</p>
   <p>如果启用交易所 IP 白名单，Cloudflare Workers 的出站 IP 可能变化，需先设计固定出口代理，否则账户接口可能被拒绝。严禁关闭交易所安全限制来绕过连接问题。</p>
   <p>自动实盘交易没有启用。第一阶段只读完成后，才会另行开发独立交易授权、双重风控、暂停和审计机制。</p>
  </section>
 </main>
}
