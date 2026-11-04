import { SimError } from './simRisk.ts'
import { ACCOUNT_SQL, AUDIT_SQL, auditValid, executeOrder } from './simLedger.ts'
import type { Audit, SimDatabase } from './simLedger.ts'
import type { Account } from './simRisk.ts'
import { checkedSymbol, getQuote, getResearch } from './quantMarket.ts'
// This binding MUST be a separate preview/local database, never env.DB.
export type SimEnv = { SIM_DB?: SimDatabase; SIM_API_KEY?: string }
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}})
export async function simApi(request:Request,env:SimEnv):Promise<Response|null> {
 const url=new URL(request.url)
 if (!url.pathname.startsWith('/api/sim/') && url.pathname!=='/api/quant-research') return null
 try {
  if (url.pathname==='/api/quant-research' || url.pathname==='/api/sim/quote') {
   if(request.method!=='GET')return json({error:'Method not allowed'},405)
   const symbol=checkedSymbol(url.searchParams.get('symbol')||'BTCUSDT')
   return json(url.pathname==='/api/sim/quote'?await getQuote(symbol):await getResearch(symbol))
  }
  if(!env.SIM_DB||!env.SIM_API_KEY)return json({error:'模拟账户未配置独立SIM_DB及SIM_API_KEY；禁止使用生产DB'},503)
  if(request.headers.get('Authorization')!==`Bearer ${env.SIM_API_KEY}`)return json({error:'模拟账户鉴权失败'},401)
  if(url.pathname==='/api/sim/account'&&request.method==='GET') {
   const account=await env.SIM_DB.prepare(ACCOUNT_SQL).first<Account>(),audit=await env.SIM_DB.prepare(AUDIT_SQL).first<Audit>()
   const orders=await env.SIM_DB.prepare('SELECT * FROM sim_orders ORDER BY revision DESC LIMIT 100').all()
   return json({account,audit,healthy:auditValid(audit),orders:orders.results,mode:'simulation-only'})
  }
  if(url.pathname==='/api/sim/orders'&&request.method==='POST') {
   if(!request.headers.get('content-type')?.includes('application/json'))return json({error:'需要JSON'},415)
   const raw=await request.text();if(raw.length>4096)return json({error:'订单过大'},413)
   let input:unknown;try{input=JSON.parse(raw)}catch{return json({error:'无效JSON'},400)}
   return json(await executeOrder(env.SIM_DB,input,getQuote))
  }
  return json({error:'Not found or method not allowed'},405)
 } catch(error) { return json({error:error instanceof SimError?error.message:'模拟服务暂不可用；未确认订单请用同一幂等键重试'},error instanceof SimError?error.status:503) }
}
