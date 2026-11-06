/** Verified exchange order book snapshots, with explicit exchange/source attribution.
 * No historical heatmap or spoofing identification is inferred from a single snapshot.
 */
export type DepthLevel = { price: number; qty: number; notional: number }
export type DepthSnapshot = {
  source: 'OKX' | 'Binance'
  symbol: string
  instrumentType: 'SPOT'
  fetchedAt: number
  exchangeTime: number | null
  bids: DepthLevel[]
  asks: DepthLevel[]
  bestBid: number
  bestAsk: number
  spreadPct: number
  bidNotional: number
  askNotional: number
  imbalance: number
}
function positiveNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}
export function normalizeDepth(
  raw: unknown, source: 'OKX' | 'Binance', symbol: string, fetchedAt = Date.now()
): DepthSnapshot {
  if (typeof raw !== 'object' || raw === null) throw new Error('盘口数据格式不正确')
  const r = raw as { bids?: unknown; asks?: unknown; ts?: unknown }
  const convert = (input: unknown): DepthLevel[] => {
    if (!Array.isArray(input)) throw new Error('盘口缺少价格档位')
    return input.slice(0, 100).flatMap(item => {
      if (!Array.isArray(item)) return []
      const price = positiveNumber(item[0]), qty = positiveNumber(item[1])
      return price && qty ? [{ price, qty, notional: price * qty }] : []
    })
  }
  const bids = convert(r.bids).sort((a,b)=>b.price-a.price)
  const asks = convert(r.asks).sort((a,b)=>a.price-b.price)
  if (!bids.length || !asks.length || bids[0].price >= asks[0].price) throw new Error('盘口最优买卖价异常')
  const bidNotional = bids.reduce((s,x)=>s+x.notional,0)
  const askNotional = asks.reduce((s,x)=>s+x.notional,0)
  const spreadPct = (asks[0].price-bids[0].price) / ((asks[0].price+bids[0].price)/2) * 100
  const exchangeTime = r.ts === undefined ? null : Number(r.ts)
  return {
    source,symbol,instrumentType:'SPOT',fetchedAt,
    exchangeTime: exchangeTime !== null && Number.isFinite(exchangeTime) ? exchangeTime : null,
    bids,asks,bestBid:bids[0].price,bestAsk:asks[0].price,spreadPct,
    bidNotional,askNotional,imbalance:(bidNotional-askNotional)/(bidNotional+askNotional)
  }
}
