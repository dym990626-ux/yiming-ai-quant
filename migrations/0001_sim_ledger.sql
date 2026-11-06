-- Yiming AI Quant simulated ledger v1 (UTC). Non-destructive migration.
-- Monetary amounts are USDT. Never stores real exchange credentials.
CREATE TABLE IF NOT EXISTS sim_accounts (
  id TEXT PRIMARY KEY,
  balance_usdt REAL NOT NULL DEFAULT 10000 CHECK(balance_usdt >= 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS sim_orders (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES sim_accounts(id),
  symbol TEXT NOT NULL CHECK(symbol IN ('BTCUSDT','ETHUSDT','SOLUSDT')),
  action TEXT NOT NULL CHECK(action IN ('OPEN','CLOSE')),
  side TEXT NOT NULL CHECK(side IN ('long','short')),
  qty REAL NOT NULL CHECK(qty > 0),
  price REAL NOT NULL CHECK(price > 0),
  notional_usdt REAL NOT NULL CHECK(notional_usdt >= 0),
  risk_usdt REAL NOT NULL CHECK(risk_usdt >= 0),
  realized_pnl_usdt REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  trading_day TEXT NOT NULL DEFAULT (date('now')),
  request_id TEXT UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_sim_orders_account_day ON sim_orders(account_id, trading_day, action);
CREATE TABLE IF NOT EXISTS sim_positions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES sim_accounts(id),
  symbol TEXT NOT NULL CHECK(symbol IN ('BTCUSDT','ETHUSDT','SOLUSDT')),
  side TEXT NOT NULL CHECK(side IN ('long','short')),
  qty REAL NOT NULL CHECK(qty > 0),
  entry_price REAL NOT NULL CHECK(entry_price > 0),
  stop_price REAL NOT NULL CHECK(stop_price > 0),
  initial_risk_usdt REAL NOT NULL CHECK(initial_risk_usdt <= 5),
  reserved_usdt REAL NOT NULL CHECK(reserved_usdt > 0 AND reserved_usdt <= 250),
  opened_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_sim_positions_account ON sim_positions(account_id);
CREATE TABLE IF NOT EXISTS risk_events (
  id TEXT PRIMARY KEY,
  account_id TEXT,
  order_request_id TEXT,
  event_type TEXT NOT NULL,
  reason TEXT NOT NULL,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_risk_events_account_time ON risk_events(account_id,created_at);
