/** Pure pre-admission limits for the *disabled* simulated order engine.
 * Never trust browser price, daily PnL or account identity as authoritative.
 * Monetary comparisons are expressed in USDT; finite positive inputs are mandatory.
 */
export type SimRiskInput = {
  dailyRealizedPnl: number
  markPrice: number
  stopPrice: number
  quantity: number
  side: 'long' | 'short'
}
export type SimRiskDecision = {
  allowed: boolean
  reason: string | null
  dailyPnl: number
  exposure: number
  notional: number
}
export function evaluateSimRisk(input: SimRiskInput): SimRiskDecision {
  const { dailyRealizedPnl, markPrice, stopPrice, quantity, side } = input
  const exposure = Math.abs(markPrice - stopPrice) * quantity
  const notional = markPrice * quantity
  const base = { dailyPnl: dailyRealizedPnl, exposure, notional }
  if (![dailyRealizedPnl, markPrice, stopPrice, quantity, exposure, notional].every(Number.isFinite) ||
      markPrice <= 0 || stopPrice <= 0 || quantity <= 0 ||
      (side !== 'long' && side !== 'short')) {
    return { ...base, allowed: false, reason: 'INVALID_RISK_INPUT' }
  }
  if (dailyRealizedPnl <= -20) return { ...base, allowed: false, reason: 'DAILY_LOSS_CIRCUIT_BREAKER' }
  if (exposure > 5) return { ...base, allowed: false, reason: 'RISK_EXPOSURE_OVER_5_USDT' }
  if (notional > 250) return { ...base, allowed: false, reason: 'NOTIONAL_OVER_250_USDT' }
  if ((side === 'long' && stopPrice >= markPrice) ||
      (side === 'short' && stopPrice <= markPrice)) {
    return { ...base, allowed: false, reason: 'INVALID_STOP' }
  }
  return { ...base, allowed: true, reason: null }
}
