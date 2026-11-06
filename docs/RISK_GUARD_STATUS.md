# Risk Guard implementation status

## Confirmed state (2026-11-06)
- Existing `SimTradePage` is **browser-local localStorage simulation**. It is not routed through D1 and **is not protected by server enforcement**.
- `POST /api/sim/orders` is a server-side authenticated **fail-closed admission endpoint**. Without `SIM_API_KEY` it returns 503; unauthorized requests get 401. With valid key and initialized D1 schema, its checks reject daily realized loss <= -20 USDT, estimated loss-to-stop > 5 USDT, notional > 250 USDT, and invalid stop direction with 403 plus an audit entry.
- This endpoint **never executes orders**, even when checks pass; it returns 503. It must NOT be described as a completed D1 trading engine. A browser must never embed `SIM_API_KEY`.
- The loss query uses the **UTC trading day** and only CLOSE order realized PnL. Before enabling order execution, implement atomic close settlement, unique idempotency keys, concurrent-order tests, and real authenticated server-side sessions.
- Mark Price: Worker fetches genuine Binance premium index or OKX public SWAP mark price. If OKX mark price is unavailable or stale it fails closed rather than substituting candle close. Simplified liquidation formula is approximate and not exchange-grade.
- Orderflow utility `src/lib/orderflow.ts` aggregates validated public trade prints into rolling CVD/VWAP. It is **not yet subscribed** to Binance/OKX trades and is **not shown as live CVD**. Aggressor buy/sell alone does not identify institutions or retail traders.
- The new migration has been committed but **not applied to production**. No tables or production data were changed by the migration commit.

## Production D1 migration procedure
1. Confirm account-wide D1 edit permission in the *deployment* token; Workers Scripts Edit alone may not authorize D1 migrations. Prefer separate, narrowly scoped migration credentials.
2. Back up the existing D1 database first; inspect current tables and schema before running SQL.
3. Verify on a development D1 database first: `npx wrangler d1 migrations apply yiming-quant --local`.
4. After backup and inspection, run `npx wrangler d1 migrations apply yiming-quant --remote` in an authorized environment. This is intentionally **not** included in automatic deploy.
5. Check `sim_accounts`, `sim_orders`, `sim_positions`, and `risk_events`; verify risk-event writes and account isolation.
6. Do not turn on real-money order APIs. Do not expose `SIM_API_KEY` in any frontend bundle.

## Remaining blockers for a complete hard risk loop
- Move all UI trade placement, close, stop/take, and reset to authenticated server APIs.
- Implement atomic D1 balance, order and position settlement in one transaction; guard concurrent requests and double fills.
- Add server-side idempotency, max-open-position rules, and price freshness verification for every simulated fill.
- Add immutable audit of **all** denial reasons, including malformed requests and schema/market failures.
- Validate daily-loss calculation across resets, timezone boundaries and floating-point rounding (recommended: integer micro-USDT).
- Integration tests against local D1: >5 risk, >250 notional, <=-20 loss, concurrency, stale mark, missing schema, auth and auditing.

This status is intentionally explicit: **the entire risk enforcement closed loop is NOT complete**.
