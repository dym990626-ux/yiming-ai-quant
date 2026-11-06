import type { Candle } from '../types'

export type Point = { time: number; value: number }
const point = (c: Candle, value: number | undefined): Point | null => value === undefined || !Number.isFinite(value) ? null : { time: c.time, value }

export function sma(candles: Candle[], length: number): Point[] {
  return candles.map((c, i) => point(c, i < length - 1 ? undefined : candles.slice(i - length + 1, i + 1).reduce((s, x) => s + x.close, 0) / length)).filter((x): x is Point => x !== null)
}
export function ema(candles: Candle[], length: number): Point[] {
  const multiplier = 2 / (length + 1); let value: number | undefined
  return candles.map((c, i) => { value = i === 0 ? c.close : c.close * multiplier + value! * (1 - multiplier); return point(c, i < length - 1 ? undefined : value) }).filter((x): x is Point => x !== null)
}
export function bollinger(candles: Candle[], length = 20, mult = 2): { upper: Point[]; middle: Point[]; lower: Point[] } {
  const upper: Point[] = [], middle: Point[] = [], lower: Point[] = []
  candles.forEach((c, i) => { if (i >= length - 1) { const xs = candles.slice(i - length + 1, i + 1).map(x => x.close); const m = xs.reduce((a, b) => a + b, 0) / length; const std = Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / length); middle.push({ time: c.time, value: m }); upper.push({ time: c.time, value: m + mult * std }); lower.push({ time: c.time, value: m - mult * std }) } })
  return { upper, middle, lower }
}
export function rsi(candles: Candle[], length = 14): Point[] {
  if (candles.length <= length) return []
  let gains = 0, losses = 0; for (let i = 1; i <= length; i++) { const diff = candles[i].close - candles[i - 1].close; gains += Math.max(diff, 0); losses += Math.max(-diff, 0) }
  const out: Point[] = []; let avgGain = gains / length, avgLoss = losses / length
  out.push({ time: candles[length].time, value: 100 - 100 / (1 + avgGain / (avgLoss || Number.EPSILON)) })
  for (let i = length + 1; i < candles.length; i++) { const diff = candles[i].close - candles[i - 1].close; avgGain = (avgGain * (length - 1) + Math.max(diff, 0)) / length; avgLoss = (avgLoss * (length - 1) + Math.max(-diff, 0)) / length; out.push({ time: candles[i].time, value: 100 - 100 / (1 + avgGain / (avgLoss || Number.EPSILON)) }) }
  return out
}
export function macd(candles: Candle[]): { macd: Point[]; signal: Point[] } {
  const fast = ema(candles, 12), slow = ema(candles, 26); const slowMap = new Map(slow.map(x => [x.time, x.value])); const macd = fast.filter(x => slowMap.has(x.time)).map(x => ({ time: x.time, value: x.value - slowMap.get(x.time)! }));
  const pseudo = macd.map(x => ({ time: x.time, open: x.value, high: x.value, low: x.value, close: x.value, volume: 0 })); return { macd, signal: ema(pseudo, 9) }
}

/** Wilder ATR; every value only uses the current and prior completed candles. */
export function atr(candles: Candle[], length = 14): Point[] {
  if (candles.length <= length) return []
  const tr = candles.map((c, i) => i === 0 ? c.high - c.low : Math.max(c.high - c.low, Math.abs(c.high - candles[i - 1].close), Math.abs(c.low - candles[i - 1].close)))
  let value = tr.slice(1, length + 1).reduce((sum, x) => sum + x, 0) / length; const out = [{ time: candles[length].time, value }]
  for (let i = length + 1; i < candles.length; i++) { value = (value * (length - 1) + tr[i]) / length; out.push({ time: candles[i].time, value }) }
  return out
}
export function rollingVolatility(candles: Candle[], length = 20): Point[] {
  return candles.map((c, i) => { if (i < length) return null; const returns = candles.slice(i - length + 1, i + 1).map((x, j, a) => j ? Math.log(x.close / a[j - 1].close) : 0).slice(1); const mean = returns.reduce((s, x) => s + x, 0) / returns.length; return point(c, Math.sqrt(returns.reduce((s, x) => s + (x - mean) ** 2, 0) / returns.length) * 100) }).filter((x): x is Point => x !== null)
}
