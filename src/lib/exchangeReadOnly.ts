/** Read-only exchange connectivity. This module intentionally contains NO order-write
 * routes, trading commands, withdraw endpoints or credential persistence.
 * Only exchange-specific server-side Worker secrets are permitted.
 */
export type ExchangeReadOnlyEnv = {
 BINANCE_RO_API_KEY?: string
 BINANCE_RO_API_SECRET?: string
 OKX_RO_API_KEY?: string
 OKX_RO_API_SECRET?: string
 OKX_RO_PASSPHRASE?: string
}
type Exchange = 'binance'|'okx'
type View = 'balances'|'positions'|'orders'
export type ReadOnlyRow = Record<string,string|number|boolean|null>
export type ReadOnlyResult = {
 exchange:Exchange
 fetchedAt:number
 view:View
 source:string
 accountType:string
 records:ReadOnlyRow[]
 warning:string
}
export const supportedExchangeViews = ['balances','positions','orders'] as const
const textEncoder = new TextEncoder()
function numeric(value:unknown):number{
 const n=Number(value)
 return Number.isFinite(n)?n:0
}
function str(value:unknown,max=64):string {
 return String(value??'').slice(0,max)
}
async function hmac(secret:string,message:string,output:'hex'|'base64'):Promise<string>{
 const key=await crypto.subtle.importKey('raw',textEncoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign'])
 const bytes=new Uint8Array(await crypto.subtle.sign('HMAC',key,textEncoder.encode(message)))
 if(output==='hex')return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('')
 let s='';for(const byte of bytes)s+=String.fromCharCode(byte)
 return btoa(s)
}
async function fetchJson(url:string,headers:Record<string,string>):Promise<unknown>{
 const ctl=new AbortController()
 const timeout=setTimeout(()=>ctl.abort(),6500)
 try{
  const response=await fetch(url,{method:'GET',signal:ctl.signal,headers:{accept:'application/json',...headers},redirect:'error',cache:'no-store'})
  if(!response.ok)throw Error('交易所只读接口 HTTP '+response.status)
  return response.json()
 }finally{clearTimeout(timeout)}
}
async function binanceGet(path:string,params:Record<string,string>,env:ExchangeReadOnlyEnv):Promise<unknown>{
 if(!env.BINANCE_RO_API_KEY||!env.BINANCE_RO_API_SECRET)throw Error('BINANCE_SECRETS_MISSING')
 const allowed=new Set(['/api/v3/account','/api/v3/openOrders','/fapi/v3/positionRisk'])
 if(!allowed.has(path))throw Error('EXCHANGE_READ_ONLY_ROUTE_DENIED')
 const query=new URLSearchParams({...params,recvWindow:'5000',timestamp:String(Date.now())}).toString()
 const signature=await hmac(env.BINANCE_RO_API_SECRET,query,'hex')
 const host=path.startsWith('/fapi/')?'https://fapi.binance.com':'https://api.binance.com'
 return fetchJson(host+path+'?'+query+'&signature='+signature,{'X-MBX-APIKEY':env.BINANCE_RO_API_KEY})
}
async function okxGet(path:string,env:ExchangeReadOnlyEnv):Promise<unknown>{
 if(!env.OKX_RO_API_KEY||!env.OKX_RO_API_SECRET||!env.OKX_RO_PASSPHRASE)throw Error('OKX_SECRETS_MISSING')
 if(!new Set(['/api/v5/account/balance','/api/v5/account/positions','/api/v5/trade/orders-pending']).has(path))
   throw Error('EXCHANGE_READ_ONLY_ROUTE_DENIED')
 const timestamp=new Date().toISOString()
 const sign=await hmac(env.OKX_RO_API_SECRET,timestamp+'GET'+path,'base64')
 const result=await fetchJson('https://www.okx.com'+path,{
   'OK-ACCESS-KEY':env.OKX_RO_API_KEY,
   'OK-ACCESS-SIGN':sign,
   'OK-ACCESS-PASSPHRASE':env.OKX_RO_PASSPHRASE,
   'OK-ACCESS-TIMESTAMP':timestamp
 })
 if(!result||typeof result!=='object')throw Error('OKX_PRIVATE_RESPONSE_INVALID')
 const d=result as {code?:string;data?:unknown;msg?:string}
 if(d.code!=='0'||!Array.isArray(d.data))throw Error('OKX_READ_FAILED_'+str(d.code||'INVALID'))
 return d.data
}
function objectArray(v:unknown):Record<string,unknown>[] {
 if(!Array.isArray(v))throw Error('EXCHANGE_PRIVATE_RESPONSE_INVALID')
 return v.filter((x):x is Record<string,unknown>=>Boolean(x)&&typeof x==='object'&&!Array.isArray(x))
}
export async function readPrivateExchange(exchange:Exchange,view:View,env:ExchangeReadOnlyEnv):Promise<ReadOnlyResult>{
 if(!supportedExchangeViews.includes(view))throw Error('EXCHANGE_VIEW_NOT_ALLOWED')
 const fetchedAt=Date.now()
 let records:ReadOnlyRow[]=[]
 let source=''
 let accountType=''
 let warning=''
 if(exchange==='binance'){
  if(view==='balances'){
   const data=await binanceGet('/api/v3/account',{},env) as {balances?:unknown;canTrade?:boolean}
   if(!data||!Array.isArray(data.balances))throw Error('BINANCE_SPOT_RESPONSE_INVALID')
   records=objectArray(data.balances).map(x=>({asset:str(x.asset),free:numeric(x.free),locked:numeric(x.locked)}))
     .filter(x=>Number(x.free)+Number(x.locked)>0).slice(0,200)
   if(data.canTrade)warning='交易所账户可能启用了交易权限。请使用单独创建的纯只读 API Key。'
   accountType='SPOT';source='Binance GET /api/v3/account'
  }else if(view==='positions'){
   const data=objectArray(await binanceGet('/fapi/v3/positionRisk',{},env))
   records=data.filter(x=>numeric(x.positionAmt)!==0).slice(0,100).map(x=>({
     symbol:str(x.symbol),side:str(x.positionSide||'BOTH'),qty:numeric(x.positionAmt),
     entryPrice:numeric(x.entryPrice),markPrice:numeric(x.markPrice),
     liquidationPrice:numeric(x.liquidationPrice),unrealizedPnl:numeric(x.unRealizedProfit),
     leverage:numeric(x.leverage)
   }))
   accountType='USD-M FUTURES';source='Binance GET /fapi/v3/positionRisk'
   warning='读取合约持仓需要 Binance USD-M 对应的只读权限；现货账户可能无此权限。'
  }else{
   // Symbol-scoped to avoid expensive unrestricted openOrders requests.
   const symbols=['BTCUSDT','ETHUSDT','SOLUSDT']
   const answers=await Promise.allSettled(symbols.map(s=>binanceGet('/api/v3/openOrders',{symbol:s},env)))
   const succeeded=answers.filter((r):r is PromiseFulfilledResult<unknown>=>r.status==='fulfilled')
   if(!succeeded.length)throw Error('BINANCE_SPOT_ORDERS_UNAVAILABLE')
   records=answers.flatMap((ans,i)=>ans.status==='fulfilled'?objectArray(ans.value).map(x=>({
     symbol:str(x.symbol||symbols[i]),orderId:str(x.orderId),side:str(x.side),type:str(x.type),status:str(x.status),
     price:numeric(x.price),origQty:numeric(x.origQty),executedQty:numeric(x.executedQty)
   })):[]).slice(0,150)
   if(succeeded.length<symbols.length)warning='部分交易对的未完成委托读取失败；列表不完整。'
   accountType='SPOT · BTC/ETH/SOL ONLY';source='Binance GET /api/v3/openOrders?symbol=…'
  }
 }else{
  if(view==='balances'){
   const data=objectArray(await okxGet('/api/v5/account/balance',env))
   records=data.flatMap(x=>objectArray(x.details||[])).filter(x=>numeric(x.cashBal)!==0||numeric(x.eq)!==0).slice(0,200).map(x=>({
     asset:str(x.ccy),equity:numeric(x.eq),available:numeric(x.availBal),
     cashBalance:numeric(x.cashBal),equityUsd:numeric(x.eqUsd)
   }))
   accountType='TRADING ACCOUNT';source='OKX GET /api/v5/account/balance'
   warning='仅为 OKX 交易账户资产；资金账户 Funding Account 余额未包含。'
  }else if(view==='positions'){
   const data=objectArray(await okxGet('/api/v5/account/positions',env))
   records=data.filter(x=>numeric(x.pos)!==0).slice(0,150).map(x=>({
     symbol:str(x.instId),side:str(x.posSide),qty:numeric(x.pos),entryPrice:numeric(x.avgPx),
     markPrice:numeric(x.markPx),liquidationPrice:numeric(x.liqPx),unrealizedPnl:numeric(x.upl),
     leverage:numeric(x.lever),marginMode:str(x.mgnMode)
   }))
   accountType='DERIVATIVES / MARGIN';source='OKX GET /api/v5/account/positions'
  }else{
   const data=objectArray(await okxGet('/api/v5/trade/orders-pending',env))
   records=data.slice(0,150).map(x=>({
     symbol:str(x.instId),orderId:str(x.ordId),side:str(x.side),type:str(x.ordType),status:str(x.state),
     price:numeric(x.px),origQty:numeric(x.sz),executedQty:numeric(x.accFillSz)
   }))
   accountType='TRADING ACCOUNT · FIRST PAGE';source='OKX GET /api/v5/trade/orders-pending'
   warning='仅第一页未完成订单，最多150条；不包含全部历史委托。'
  }
 }
 return {exchange,fetchedAt,view,source,accountType,records,warning}
}
