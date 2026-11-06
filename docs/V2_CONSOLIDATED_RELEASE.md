# One-time consolidated Quant release — 2026-11-06

This release preserves all previous app pages and avoids production D1 mutations.

## Implemented in source
- BTC/ETH/SOL public-spot scanner using genuine recent exchange trades, with threshold bands and a labeled limited sample.
- Current SPOT order-book snapshot via `/api/whale/depth`, sourced from OKX or Binance, checked for crossed/invalid books and timestamp staleness. Bid/ask imbalance represents **only the returned price levels**.
- Whale orderflow dashboard: signed buy/sell sample charts, ranked recent trade prints, observed liquidation snapshots where exchange broadcasts are accessible.
- Opt-in on-device event evidence log: browser-local, only while the page is open, max 100 records. **Not background tracking**.
- Bark scheduled worker code: five-minute tick, spot whale single-trade threshold default 100,000 USDT, 15-minute symbol cooldown, persistent D1 queue, retry and event status. The code is deployed but alert sending is **disabled until** Worker secrets and D1 migration are configured and checked.
- Deployment checks: TypeScript build, hard-risk-rule tests, order-book normalization tests, isolated D1 migration tests.

## Production safety gates
1. Verify Cloudflare API token has the least-privilege access and rotate any previously shared credentials.
2. Back up the existing D1 database and confirm that backup is restorable. **Do not delete, reset or replace the current database.**
3. Check any existing table shapes before applying migrations. `CREATE TABLE IF NOT EXISTS` alone does not prove compatibility.
4. Only after backup, migrate using:
   `npx wrangler@4 d1 migrations apply yiming-quant --remote`
   through an authenticated Cloudflare environment. This command has NOT been run by the code-only deployment.
5. Set the following as Cloudflare **Worker Secrets**, never frontend environment variables:
   - `BARK_DEVICE_KEY`: device key obtained in Bark on iPhone
   - `BARK_AUTO_ENABLED`: exact string `1`, **only after** migration and alert gateway validation
   - `BARK_WHALE_THRESHOLD_USDT`: optional 100000 (clamped between 10000 and 10000000)
   - `BARK_ADMIN_KEY`: strong, separate secret for restricted manual test API
6. Check `GET /api/bark/status`; `notificationEnabled: true` means server setup is ready, **not** that phone receipt has been proven.
7. Trigger an authenticated Bark test then confirm device receipt. Check the D1 queue and errors. Data may be region-restricted and alerts may be missed or duplicated around crashes.
8. In-app local simulation continues to use browser state. It is **not** a completed server-side atomic trading engine; do not enable live trading.

## Limitations retained deliberately
- No identifiable individual whale account holdings.
- No verified future liquidation heatmap from public trades.
- A snapshot sample cannot be extrapolated into full 1h volume, institutional capital flow, or a predictable winning signal.
- Pro-grade six-AI and walk-forward backtest work remains in separate issues; publishing dashboards does not certify strategy quality.
- Scheduled Bark is off until explicit production setup. No confirmed iPhone push delivery yet.

## Links
- Cloudflare Worker: https://divine-wood-aa20.floral-sun-f603.workers.dev/
- Project issues: https://github.com/dym990626-ux/yiming-ai-quant/issues
