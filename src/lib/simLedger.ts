import { SimError, fingerprint, parseOrder, prepareOrder } from './simRisk.ts'
import type { Account, Quote } from './simRisk.ts'
export interface Statement { bind(...args: unknown[]): Statement; first<T>(): Promise<T | null>; all<T>(): Promise<{ results: T[] }> }
export interface SimDatabase { prepare(sql: string): Statement; batch(statements: Statement[]): Promise<unknown[]> }
export const ACCOUNT_SQL = "SELECT * FROM sim_accounts WHERE id='paper-1000'"
export const AUDIT_SQL = `SELECT a.cash, a.revision,
 1000000000+COALESCE((SELECT SUM(amount) FROM sim_ledger WHERE bucket='cash'),0) AS ledger_cash,
 COALESCE((SELECT SUM(amount) FROM sim_ledger WHERE bucket='position'),0) AS ledger_position,
 COALESCE(json_extract(a.position,'$.notional'),0) AS position,
 (SELECT COUNT(*) FROM sim_orders) AS orders,
 (SELECT COUNT(*) FROM sim_ledger) AS entries,
 (SELECT COUNT(*) FROM (SELECT order_id FROM sim_ledger GROUP BY order_id HAVING SUM(amount)!=0 OR COUNT(*)!=4)) AS unbalanced
 FROM sim_accounts a WHERE id='paper-1000'`
export type Audit = { cash: number; revision: number; ledger_cash: number; ledger_position: number; position: number; orders: number; entries: number; unbalanced: number }
export const auditValid = (a: Audit | null) => !!a && a.cash === a.ledger_cash && a.ledger_position === a.position && a.revision === a.orders && a.entries === a.orders * 4 && a.unbalanced === 0
export const INSERT_SQL = 'INSERT INTO sim_orders(id,fingerprint,action,symbol,revision,day,time,fill,cash_delta,position_delta,fee,pnl,position,source) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
export async function executeOrder(db: SimDatabase, raw: unknown, quoteFor: (symbol: string) => Promise<Quote>, now = Date.now()) {
  const input = parseOrder(raw), signature = fingerprint(input)
  const existing = await db.prepare('SELECT * FROM sim_orders WHERE id=?').bind(input.id).first<{ fingerprint: string }>()
  if (existing) { if (existing.fingerprint !== signature) throw new SimError('幂等键已用于不同订单', 409); return { order: existing, replayed: true } }
  const quote = await quoteFor(input.symbol)
  const account = await db.prepare(ACCOUNT_SQL).first<Account>()
  const audit = await db.prepare(AUDIT_SQL).first<Audit>()
  if (!account || !auditValid(audit)) throw new SimError('账本审计失败，停止交易', 503)
  const o = prepareOrder(account, input, quote, Math.max(now, Date.now()))
  try {
    // D1 batch is transactional. Trigger posts four balanced entries and account update
    // within the INSERT; any trigger/constraint failure rolls the entire batch back.
    await db.batch([db.prepare(INSERT_SQL).bind(o.id,o.fingerprint,o.action,o.symbol,o.revision,o.day,o.time,o.fill,o.cashDelta,o.positionDelta,o.fee,o.pnl,o.position,o.source)])
  } catch {
    const raced = await db.prepare('SELECT * FROM sim_orders WHERE id=?').bind(input.id).first<{ fingerprint: string }>()
    if (raced?.fingerprint === signature) return { order: raced, replayed: true }
    throw new SimError('订单冲突或事务已回滚；请查询账户后重试', 409)
  }
  return { order: o, replayed: false }
}
