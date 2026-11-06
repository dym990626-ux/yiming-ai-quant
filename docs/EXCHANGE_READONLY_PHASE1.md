# Exchange account integration — Phase 1 (read-only)

## What was implemented

- UI: **交易所账户** tab, with exchange/view selection and explicit locked/unconfigured/network failure states. Never paste keys into website.
- Worker: `GET /api/exchange/status` and `GET /api/exchange/read?exchange=binance|okx&view=balances|positions|orders`.
- Both routes **require a valid Cloudflare Access RS256 JWT**. Validations include JWT signature, issuer, audience, expiry and optional nbf via team JWKS. Missing config = 503; missing/invalid login = 403.
- Binance: signed read-only `GET /api/v3/account`, `GET /fapi/v3/positionRisk`, `GET /api/v3/openOrders` scoped to BTC, ETH, SOL.
- OKX: signed read-only `GET /api/v5/account/balance`, `GET /api/v5/account/positions`, `GET /api/v5/trade/orders-pending`.
- The entire API implementation contains no order submission, cancel, transfer or withdrawal endpoints; all private exchange requests use GET. No browser local storage of credentials. All private responses use no-store.
- The first phase does **not** activate live or automatic trading, and does not change existing D1 data.

## Required manual one-time setup on phone

1. In Cloudflare Zero Trust / Access, create a **self-hosted Access application** for the private `/api/exchange/*` path of the exact production hostname. Restrict Access to **only your approved identity**, not all users in a public email domain. The application must deliver signed `Cf-Access-Jwt-Assertion` headers to the Worker. If the domain/path model is unsupported, use a custom domain or dedicated private Worker; NEVER remove JWT verification to work around this.
2. In your Worker settings, add **Secrets**:
   - `ACCESS_TEAM_DOMAIN` — exact issuer URL, e.g. `https://my-team.cloudflareaccess.com` (not the application hostname).
   - `ACCESS_APP_AUD` — the exact Access application Audience tag under its settings.
   - `BINANCE_RO_API_KEY` and `BINANCE_RO_API_SECRET` — a distinct Binance **read-only** HMAC API key with User Data permission; disable trade and withdrawal.
   - `OKX_RO_API_KEY`, `OKX_RO_API_SECRET`, `OKX_RO_PASSPHRASE` — distinct OKX API credentials with **Read only** enabled, Trade and Withdraw disabled.
3. Where possible restrict API key to a **stable egress IP**. Cloudflare Workers outbound IPs are not stable by default, so a fixed egress proxy is required for a strict exchange IP allowlist. Do **not** weaken exchange security without understanding the consequence.
4. Use the website's **交易所账户** page after Cloudflare Access login. First verify status, then fetch balances, positions and orders.
5. Enable read-only rights for each account/market specifically. A spot API key may not permit Binance futures; unsupported private endpoints show a scoped error without leaking secrets.
6. Verify every amount against your exchange account directly. Binance spot balances are in **asset units**, not USD; OKX eqUsd may be present but is not a converted wallet total. OKX Funding wallet is not included. Binance open orders cover only 3 USDT spot pairs and OKX orders are limited to first page.
7. If the API key was ever shared or exposed, revoke and rotate it. Do not share exchange credentials in chat, GitHub issues, screenshots or JS bundles.

## Security/test requirements

- Any missing Access settings or invalid token must fail closed and perform **zero private requests**.
- Market-data endpoints remain public and unaffected.
- No private balances, positions, login, API keys or identifiable account IDs in public `/api/health` or logs.
- Futures positions and order data are view-only, with no execution, stop-loss placement or account modification.
- Official exchange APIs may be region limited. HTTP 403, 451, -2015, 501xx etc must not be bypassed by fake data or unauthorized network workarounds.
- **Do not deploy real trading** until separated credentials, formal authorization, account-bound policies, D1 audit, emergency stop, retries and complete testnet demonstration have passed.

## API references

- Binance signed spot API: https://github.com/binance/binance-spot-api-docs/blob/master/rest-api.md
- OKX REST v5: https://www.okx.com/docs-v5/
- Cloudflare Access validating JWT: https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/
