-- Durable Bark whale alert queue. Does not modify existing ledger or historical data.
CREATE TABLE IF NOT EXISTS whale_alert_events (
  event_key TEXT PRIMARY KEY,
  symbol TEXT NOT NULL CHECK(symbol IN ('BTCUSDT','ETHUSDT','SOLUSDT')),
  source TEXT NOT NULL,
  trade_id TEXT NOT NULL,
  trade_time INTEGER NOT NULL,
  side TEXT NOT NULL CHECK(side IN ('buy','sell')),
  price REAL NOT NULL CHECK(price > 0),
  notional_usdt REAL NOT NULL CHECK(notional_usdt >= 0),
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','sending','sent','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_error TEXT
);
CREATE INDEX IF NOT EXISTS idx_whale_alert_state ON whale_alert_events(state,created_at);
CREATE INDEX IF NOT EXISTS idx_whale_alert_cooldown ON whale_alert_events(symbol,created_at);
