/** All amounts in ledger are integer micro-USDT. No exchange order API exists. */
export const UNIT = 1_000_000
export const LIMITS = Object.freeze({ initial: 1000 * UNIT, position: 250 * UNIT, risk: 5 * UNIT, dailyLoss: 20 * UNIT, streak: 3, slippage: .005, quoteAge: 10_000, fee: .0005, fillSlip: .0003 })
export type SimSymbol = 'BTCUSDT' | 'ETHUSDT' | 'SOLUSDT'
export type Side = 'long' | 'short'
export type Quote = { symbol: SimSymbol; price: number; timestamp: number; source: string }
export type Account = { id: string; cash: number; revision: number; day: string; daily_pnl: number; streak: number; position: string | null }
export type Position = { symbol: SimSymbol; side: Side; quantity: number; entry: number; notional: number; entryFee: number; stop: number; take?: number; openedAt: number }
export type OrderInput = { id: string; action: 'open' | 'close'; symbol: SimSymbol; side?: Side; notional?: number; stop?: number; take?: number; expectedPrice: number }
export type PreparedOrder = { id: string; fingerprint: string; action: 'open' | 'close'; symbol: SimSymbol; revision: number; day: string; time: number; fill: number; cashDelta: number; positionDelta: number; fee: number; pnl: number; position: string | null; source: string }
export class SimError extends Error { status: number; constructor(message: string, status = 422) { super(message); this.status = status } }
export function positive(x: unknown): x is number { return typeof x === 'number' && Number.isFinite(x) && x > 0 }
export function freshQuote(quote: Quote, now = Date.now()) { return positive(quote.price) && Number.isFinite(quote.timestamp) && quote.timestamp <= now && now - quote.timestamp < LIMITS.quoteAge }
export function parseOrder(raw: unknown): OrderInput {
  if (!raw || typeof raw !== 'object') throw new SimError('无效订单')
  const x = raw as OrderInput
  if (typeof x.id !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(x.id) || !['open', 'close'].includes(x.action) || !['BTCUSDT', 'ETHUSDT', 'SOLUSDT'].includes(x.symbol) || !positive(x.expectedPrice)) throw new SimError('订单标识、品种、动作或参考价无效')
  if (x.action === 'open' && (x.side !== 'long' || !positive(x.notional) || !positive(x.stop))) throw new SimError('第一阶段仅允许现货模拟做多；开仓须提供正数仓位及止损', 403)
  if (x.take !== undefined && !positive(x.take)) throw new SimError('止盈必须为正数')
  return { id: x.id, action: x.action, symbol: x.symbol, expectedPrice: x.expectedPrice, ...(x.action === 'open' ? { side: x.side, notional: x.notional, stop: x.stop, ...(x.take === undefined ? {} : { take: x.take }) } : {}) }
}
export const fingerprint = (x: OrderInput) => JSON.stringify(parseOrder(x))
export function prepareOrder(account: Account, raw: OrderInput, quote: Quote, now = Date.now()): PreparedOrder {
  const x = parseOrder(raw), day = new Date(now).toISOString().slice(0, 10)
  if (quote.symbol !== x.symbol || !freshQuote(quote, now)) throw new SimError('行情断线或超过10秒，拒绝交易', 503)
  if (!Number.isSafeInteger(account.cash) || !Number.isSafeInteger(account.revision)) throw new SimError('账户异常', 409)
  const position = account.position ? JSON.parse(account.position) as Position : null
  const buying = x.action === 'open' ? x.side === 'long' : position?.side === 'short'
  const fill = quote.price * (buying ? 1 + LIMITS.fillSlip : 1 - LIMITS.fillSlip)
  // Both favourable and adverse drift invalidate a stale client intent.
  if (Math.abs(fill / x.expectedPrice - 1) > LIMITS.slippage + 1e-12) throw new SimError('成交偏移超过0.5%，请刷新报价', 409)
  let cashDelta: number, positionDelta: number, fee: number, pnl = 0, next: Position | null = null
  if (x.action === 'open') {
    if (position) throw new SimError('已有持仓', 409)
    if ((account.day === day && account.daily_pnl <= -LIMITS.dailyLoss) || account.streak >= LIMITS.streak) throw new SimError('熔断：每日亏损20U或连续亏损3笔', 403)
    const notional = Math.round(x.notional! * UNIT), quantity = notional / UNIT / fill, stop = x.stop!
    if (!Number.isSafeInteger(notional) || notional <= 0 || notional > LIMITS.position) throw new SimError('单笔仓位不得超过250U')
    if (x.side === 'long' ? stop >= fill : stop <= fill) throw new SimError('止损方向错误')
    if (x.take !== undefined && (x.side === 'long' ? x.take <= fill : x.take >= fill)) throw new SimError('止盈方向错误')
    fee = Math.ceil(notional * LIMITS.fee)
    const worstStop = stop * (x.side === 'long' ? 1 - LIMITS.slippage : 1 + LIMITS.slippage)
    const loss = quantity * Math.abs(fill - worstStop) * UNIT + fee + Math.ceil(quantity * worstStop * UNIT * LIMITS.fee)
    if (!Number.isFinite(loss) || loss > LIMITS.risk) throw new SimError('含费用及止损滑点的计划风险超过5U')
    cashDelta = -notional - fee; positionDelta = notional
    if (account.cash + cashDelta < 0) throw new SimError('模拟资金不足')
    next = { symbol: x.symbol, side: x.side!, quantity, entry: fill, notional, entryFee: fee, stop, ...(x.take === undefined ? {} : { take: x.take }), openedAt: now }
  } else {
    if (!position || position.symbol !== x.symbol) throw new SimError('无匹配持仓', 409)
    if (!positive(position.quantity) || !positive(position.entry) || !Number.isSafeInteger(position.notional)) throw new SimError('持仓异常', 409)
    fee = Math.ceil(position.quantity * fill * UNIT * LIMITS.fee)
    const gross = Math.round((position.side === 'long' ? fill - position.entry : position.entry - fill) * position.quantity * UNIT)
    pnl = gross - position.entryFee - fee
    cashDelta = position.notional + gross - fee; positionDelta = -position.notional
  }
  if (![cashDelta, positionDelta, fee, pnl].every(Number.isSafeInteger)) throw new SimError('金额溢出')
  return { id: x.id, fingerprint: fingerprint(x), action: x.action, symbol: x.symbol, revision: account.revision, day, time: now, fill, cashDelta, positionDelta, fee, pnl, position: next ? JSON.stringify(next) : null, source: quote.source }
}
