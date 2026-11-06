/** Real public-trade orderflow aggregation. NOT a whale/retail identity detector.
 * Binance maker flag maps to aggressor side. OKX provides taker side.
 * All aggregation is bounded, event-time ordered and rejects invalid/duplicate rows.
 */
export type TradePrint = { id: string; source: 'Binance' | 'OKX'; timestamp: number; price: number; qty: number; aggressor: 'buy' | 'sell' }
export type OrderflowSnapshot = { source: TradePrint['source'] | null; count: number; buyVolume: number; sellVolume: number; cvd: number; vwap: number | null; from: number | null; to: number | null }
export class RollingOrderflow {
  private rows: TradePrint[] = []
  private ids = new Set<string>()
  constructor(private readonly maxTrades = 5000, private readonly maxAgeMs = 15 * 60_000) {}
  add(trade: TradePrint, now = Date.now()): boolean {
    if (!trade.id || !Number.isFinite(trade.timestamp) || !Number.isFinite(trade.price) ||
      !Number.isFinite(trade.qty) || trade.price <= 0 || trade.qty <= 0 ||
      trade.timestamp < now - this.maxAgeMs || trade.timestamp > now + 10_000 || this.ids.has(trade.id)) return false
    // Reject out-of-order trades: adding them would make a sliding rolling window misleading.
    if (this.rows.length && trade.timestamp < this.rows[this.rows.length - 1].timestamp) return false
    this.rows.push(trade); this.ids.add(trade.id); this.prune(now)
    return true
  }
  private prune(now: number) {
    while (this.rows.length > this.maxTrades || (this.rows.length && this.rows[0].timestamp < now - this.maxAgeMs)) {
      const old = this.rows.shift()
      if (old) this.ids.delete(old.id)
    }
  }
  snapshot(now = Date.now()): OrderflowSnapshot {
    this.prune(now)
    let buyVolume = 0, sellVolume = 0, sumPriceVolume = 0, sumVolume = 0
    for (const row of this.rows) {
      if (row.aggressor === 'buy') buyVolume += row.qty; else sellVolume += row.qty
      sumPriceVolume += row.price * row.qty; sumVolume += row.qty
    }
    return { source: this.rows[0]?.source ?? null, count: this.rows.length, buyVolume, sellVolume,
      cvd: buyVolume - sellVolume, vwap: sumVolume > 0 ? sumPriceVolume / sumVolume : null,
      from: this.rows[0]?.timestamp ?? null, to: this.rows[this.rows.length - 1]?.timestamp ?? null }
  }
}
export function parseBinanceTrade(raw: unknown): TradePrint | null {
  if (!raw || typeof raw !== 'object') return null
  const x = raw as Record<string, unknown>
  if (typeof x.t !== 'number' || typeof x.T !== 'number' || typeof x.m !== 'boolean') return null
  const price = Number(x.p), qty = Number(x.q)
  if (!Number.isFinite(price) || !Number.isFinite(qty) || price <= 0 || qty <= 0) return null
  // m=true: buyer was market maker, so the aggressor sold.
  return { id: String(x.t), source: 'Binance', timestamp: x.T, price, qty, aggressor: x.m ? 'sell' : 'buy' }
}
export function parseOkxTrade(raw: unknown): TradePrint | null {
  if (!raw || typeof raw !== 'object') return null
  const x = raw as Record<string, unknown>
  const price = Number(x.px), qty = Number(x.sz), timestamp = Number(x.ts)
  if (typeof x.tradeId !== 'string' || !['buy','sell'].includes(String(x.side)) || !Number.isFinite(price) ||
      !Number.isFinite(qty) || !Number.isFinite(timestamp) || price <= 0 || qty <= 0) return null
  return { id: x.tradeId, source: 'OKX', timestamp, price, qty, aggressor: x.side as 'buy' | 'sell' }
}
