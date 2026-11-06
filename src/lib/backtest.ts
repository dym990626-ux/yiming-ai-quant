import type { Candle, IntervalId } from '../types'
import { ema, rsi, sma } from './indicators'

export type StrategyId = 'ma-cross' | 'ema-cross' | 'rsi-reversion'
export interface BacktestSettings { initialCapital: number; feeRate: number; slippageRate: number; strategy: StrategyId; interval: IntervalId }
export interface Trade { entryTime: number; exitTime: number; entryPrice: number; exitPrice: number; quantity: number; pnl: number; returnPct: number }
export interface BacktestResult { trades: Trade[]; equity: { time: number; value: number }[]; netReturn: number; maxDrawdown: number; winRate: number; profitFactor: number; sharpeRatio: number; totalTrades: number; finalEquity: number }

/** Long-only MA(7/25) crossing. Orders execute at the next completed bar open; no future bar is read. */
export function runMaCrossBacktest(candles: Candle[], settings: BacktestSettings): BacktestResult {
  candles = candles.filter(c => c.closed !== false)
  if (candles.length < 27) throw new Error('历史 K 线不足，至少需要 27 根已完成 K 线。')
  const fast = settings.strategy === 'ema-cross' ? ema(candles, 12) : sma(candles, 7)
  const slow = settings.strategy === 'ema-cross' ? ema(candles, 26) : sma(candles, 25)
  const fastMap = new Map(fast.map(x => [x.time, x.value])); const slowMap = new Map(slow.map(x => [x.time, x.value])); const rsiMap = new Map(rsi(candles, 14).map(x => [x.time, x.value]))
  let cash = settings.initialCapital, qty = 0, entryPrice = 0, entryTime = 0
  const trades: Trade[] = [], equity: { time: number; value: number }[] = []; let previousDiff: number | null = null
  for (let i = 24; i < candles.length - 1; i++) {
    const current = candles[i], next = candles[i + 1], fastValue = fastMap.get(current.time), slowValue = slowMap.get(current.time), rsiValue = rsiMap.get(current.time)
    if (fastValue === undefined || slowValue === undefined) continue
    const diff = fastValue - slowValue
    const enter = settings.strategy === 'rsi-reversion' ? rsiValue !== undefined && rsiValue < 30 : previousDiff !== null && previousDiff <= 0 && diff > 0
    const exit = settings.strategy === 'rsi-reversion' ? rsiValue !== undefined && rsiValue > 55 : previousDiff !== null && previousDiff >= 0 && diff < 0
    if (qty === 0 && enter) {
      const fill = next.open * (1 + settings.slippageRate); qty = cash / (fill * (1 + settings.feeRate)); cash = 0; entryPrice = fill; entryTime = next.time
    } else if (qty > 0 && exit) {
      const fill = next.open * (1 - settings.slippageRate); const proceeds = qty * fill * (1 - settings.feeRate); const cost = qty * entryPrice * (1 + settings.feeRate); const pnl = proceeds - cost
      trades.push({ entryTime, exitTime: next.time, entryPrice, exitPrice: fill, quantity: qty, pnl, returnPct: pnl / cost * 100 }); cash = proceeds; qty = 0
    }
    previousDiff = diff; equity.push({ time: current.time, value: qty ? qty * current.close * (1 - settings.feeRate) : cash })
  }
  const last = candles.at(-1)!; if (qty > 0) { const fill = last.close * (1 - settings.slippageRate); const proceeds = qty * fill * (1 - settings.feeRate); const cost = qty * entryPrice * (1 + settings.feeRate); const pnl = proceeds - cost; trades.push({ entryTime, exitTime: last.time, entryPrice, exitPrice: fill, quantity: qty, pnl, returnPct: pnl / cost * 100 }); cash = proceeds; equity.push({ time: last.time, value: cash }) }
  let peak = settings.initialCapital, maxDrawdown = 0; for (const point of equity) { peak = Math.max(peak, point.value); maxDrawdown = Math.max(maxDrawdown, peak ? (peak - point.value) / peak : 0) }
  const wins = trades.filter(x => x.pnl > 0), losses = trades.filter(x => x.pnl < 0), grossProfit = wins.reduce((s, x) => s + x.pnl, 0), grossLoss = Math.abs(losses.reduce((s, x) => s + x.pnl, 0))
  const returns = equity.slice(1).map((x, i) => x.value / equity[i].value - 1).filter(Number.isFinite)
  const mean = returns.length ? returns.reduce((sum, value) => sum + value, 0) / returns.length : 0
  const variance = returns.length > 1 ? returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1) : 0
  const periodsPerYear:Record<IntervalId,number>={'1m':525600,'5m':105120,'15m':35040,'1h':8760,'4h':2190,'1d':365,'1w':52}
  const sharpeRatio = variance ? mean / Math.sqrt(variance) * Math.sqrt(periodsPerYear[settings.interval]) : 0
  return { trades, equity, totalTrades: trades.length, finalEquity: cash || settings.initialCapital, netReturn: (cash / settings.initialCapital - 1) * 100, maxDrawdown: maxDrawdown * 100, winRate: trades.length ? wins.length / trades.length * 100 : 0, profitFactor: grossLoss ? grossProfit / grossLoss : 0, sharpeRatio }
}
