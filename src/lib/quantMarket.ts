import { SimError, freshQuote, positive } from './simRisk.ts'
import type { Quote, SimSymbol } from './simRisk.ts'
const symbols = new Set(['BTCUSDT','ETHUSDT','SOLUSDT'])
export const checkedSymbol = (raw: string): SimSymbol => { if (!symbols.has(raw)) throw new SimError('不支持的品种',400); return raw as SimSymbol }
export async function publicJson(url: string): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(4000), headers: { accept: 'application/json' } })
  if (!response.ok) throw new SimError(`公开行情HTTP ${response.status}`,503)
  return response.json()
}
function object(x: unknown): Record<string, unknown> { if (!x || typeof x !== 'object') throw new SimError('行情格式错误',503); return x as Record<string,unknown> }
const number = (x: unknown) => typeof x === 'string' && x.trim() !== '' || typeof x === 'number' ? Number(x) : NaN
async function okx(path: string) { const p=object(await publicJson(`https://www.okx.com${path}`)); if (p.code !== '0' || !Array.isArray(p.data)) throw new SimError('OKX行情不可用',503); return p.data as unknown[] }
export async function getQuote(raw: string): Promise<Quote> {
  const symbol = checkedSymbol(raw)
  try {
    const b=object(await publicJson(`https://fapi.binance.com/fapi/v1/ticker/bookTicker?symbol=${symbol}`))
    const bid=number(b.bidPrice),ask=number(b.askPrice)
    const q={symbol,price:(bid+ask)/2,timestamp:number(b.time),source:'Binance USDⓈ-M bookTicker（买卖中间价）'}
    if (!positive(bid)||!positive(ask)||ask<bid||!freshQuote(q)) throw new Error('过期或无效报价')
    return q
  } catch {
    const rows=await okx(`/api/v5/market/ticker?instId=${symbol.replace('USDT','')}-USDT-SWAP`),b=object(rows[0])
    const bid=number(b.bidPx),ask=number(b.askPx)
    const q={symbol,price:(bid+ask)/2,timestamp:number(b.ts),source:'OKX USDT-SWAP ticker（买卖中间价）'}
    if (!positive(bid)||!positive(ask)||ask<bid||!freshQuote(q)) throw new SimError('两交易所行情不可用或超过10秒',503)
    return q
  }
}
export type TradeSample = { price: number; size: number; buy: boolean; time: number }
export function tradeMetrics(trades: TradeSample[]) {
  const rows = trades.filter(t=>positive(t.price)&&positive(t.size)&&Number.isFinite(t.time)).sort((a,b)=>a.time-b.time)
  if (!rows.length) return null
  const volume=rows.reduce((s,t)=>s+t.size,0)
  return { cvd: rows.reduce((s,t)=>s+(t.buy?t.size:-t.size),0), vwap: rows.reduce((s,t)=>s+t.price*t.size,0)/volume, samples:rows.length, from:rows[0].time, to:rows.at(-1)!.time }
}
export async function getResearch(raw: string) {
  const symbol=checkedSymbol(raw), errors: string[]=[]
  try {
    const settled=await Promise.allSettled([
      publicJson(`https://fapi.binance.com/fapi/v1/aggTrades?symbol=${symbol}&limit=500`),
      publicJson(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${symbol}`),
      publicJson(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`),
    ])
    const read=(i:number)=>{const r=settled[i];if(r.status==='fulfilled')return r.value;errors.push(`Binance 研究字段${i+1}不可用`);return null}
    const rawTrades=read(0), oiRaw=read(1), fundingRaw=read(2)
    if (!Array.isArray(rawTrades)) throw new Error('成交样本不可用')
    const trades=rawTrades.map(object).filter(t=>typeof t.m==='boolean').map(t=>({price:number(t.p),size:number(t.q),buy:t.m===false,time:number(t.T)}))
    const metrics=tradeMetrics(trades)
    if (!metrics||Date.now()-metrics.to>=10_000||metrics.to>Date.now()) throw new Error('成交样本已过期')
    const oi=oiRaw?object(oiRaw):{},f=fundingRaw?object(fundingRaw):{}
    const oiValue=number(oi.openInterest), funding=number(f.lastFundingRate)
    return {symbol,source:'Binance USDⓈ-M public API',...metrics,cvdUnit:'标的币数量',openInterest:positive(oiValue)?oiValue:null,oiUnit:'标的币数量',oiTime:Number.isFinite(number(oi.time))?number(oi.time):null,fundingRate:Number.isFinite(funding)?funding:null,fundingTime:Number.isFinite(number(f.time))?number(f.time):null,errors,updatedAt:Date.now()}
  } catch {
    const inst=`${symbol.replace('USDT','')}-USDT-SWAP`
    const settled=await Promise.allSettled([okx(`/api/v5/market/trades?instId=${inst}&limit=100`),okx(`/api/v5/public/open-interest?instType=SWAP&instId=${inst}`),okx(`/api/v5/public/funding-rate?instId=${inst}`)])
    const read=(i:number)=>{const r=settled[i];if(r.status==='fulfilled')return r.value;errors.push(`OKX 研究字段${i+1}不可用`);return null}
    const rawTrades=read(0), oiRows=read(1), fundingRows=read(2)
    if (!rawTrades) throw new SimError('研究成交样本不可用',503)
    const metrics=tradeMetrics(rawTrades.map(object).filter(t=>t.side==='buy'||t.side==='sell').map(t=>({price:number(t.px),size:number(t.sz),buy:t.side==='buy',time:number(t.ts)})))
    if (!metrics||Date.now()-metrics.to>=10_000||metrics.to>Date.now()) throw new SimError('研究成交样本超过10秒',503)
    const oi=oiRows?.length?object(oiRows[0]):{},f=fundingRows?.length?object(fundingRows[0]):{}
    return {symbol,source:'OKX USDT-SWAP public API',...metrics,cvdUnit:'合约张数（不可与Binance直接比较）',openInterest:positive(number(oi.oi))?number(oi.oi):null,oiUnit:'合约张数',oiTime:Number.isFinite(number(oi.ts))?number(oi.ts):null,fundingRate:Number.isFinite(number(f.fundingRate))?number(f.fundingRate):null,fundingTime:Number.isFinite(number(f.ts))?number(f.ts):null,errors,updatedAt:Date.now()}
  }
}
