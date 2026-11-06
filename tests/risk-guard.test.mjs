import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluateSimRisk } from '../src/lib/riskGuard.ts'

const baseline = { dailyRealizedPnl: 0, markPrice: 100, stopPrice: 95, quantity: 1, side: 'long' }
const check = patch => evaluateSimRisk({ ...baseline, ...patch })

test('5 U exposure is accepted; > 5 U rejected', () => {
  assert.equal(check({}).allowed, true)
  assert.equal(check({ stopPrice: 94.99 }).reason, 'RISK_EXPOSURE_OVER_5_USDT')
})
test('notional 250 U accepted; >250 rejected', () => {
  assert.equal(check({ quantity: 2.5, stopPrice: 99 }).allowed, true)
  assert.equal(check({ quantity: 2.501, stopPrice: 99 }).reason, 'NOTIONAL_OVER_250_USDT')
})
test('UTC realized daily loss circuit-breaker inclusive of -20 U', () => {
  assert.equal(check({ dailyRealizedPnl: -19.99 }).allowed, true)
  assert.equal(check({ dailyRealizedPnl: -20 }).reason, 'DAILY_LOSS_CIRCUIT_BREAKER')
  assert.equal(check({ dailyRealizedPnl: -50 }).reason, 'DAILY_LOSS_CIRCUIT_BREAKER')
})
test('correct stop side for long and short', () => {
  assert.equal(check({ stopPrice: 100 }).reason, 'INVALID_STOP')
  assert.equal(check({ side: 'short', stopPrice: 101 }).allowed, true)
  assert.equal(check({ side: 'short', stopPrice: 99 }).reason, 'INVALID_STOP')
})
test('fail closed on malformed values and non-finite derived exposure', () => {
  for (const patch of [{quantity: 0}, {quantity: Infinity}, {markPrice: NaN},
    {markPrice: -100}, {stopPrice: 0}, {dailyRealizedPnl: NaN}, {side: 'bad'},
    {quantity: Number.MAX_VALUE}]) {
    assert.equal(check(patch).allowed, false, JSON.stringify(patch))
  }
})
