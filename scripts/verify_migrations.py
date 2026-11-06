"""Safe local D1 migration checks. Never opens production databases."""
from pathlib import Path
import sqlite3
import tempfile

SCHEMA = Path("migrations/0001_sim_ledger.sql").read_text(encoding="utf-8")
TABLES = {"sim_accounts", "sim_orders", "sim_positions", "risk_events", "whale_alert_events"}
WHALE_SCHEMA = Path("migrations/0002_whale_alerts.sql").read_text(encoding="utf-8")

with tempfile.TemporaryDirectory() as temp:
    db = sqlite3.connect(str(Path(temp) / "ledger.sqlite"))
    db.execute("PRAGMA foreign_keys=ON")
    db.executescript(SCHEMA)
    db.executescript(WHALE_SCHEMA)
    # Creation scripts must be non-destructive and idempotent.
    db.executescript(SCHEMA)
    db.executescript(WHALE_SCHEMA)
    existing = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert TABLES <= existing, f"Missing D1 tables: {TABLES - existing}"

    db.execute("INSERT INTO sim_accounts(id, balance_usdt) VALUES(?, ?)", ("test-account", 10000))
    db.execute("""INSERT INTO sim_orders(
        id,account_id,symbol,action,side,qty,price,notional_usdt,risk_usdt,realized_pnl_usdt
      ) VALUES(?,?,?,?,?,?,?,?,?,?)""",
      ("order-1","test-account","BTCUSDT","CLOSE","long",0.001,100000,100,3,-20))
    pnl = db.execute("""SELECT COALESCE(SUM(realized_pnl_usdt),0)
      FROM sim_orders WHERE account_id=? AND trading_day=date('now') AND action='CLOSE'""",
      ("test-account",)).fetchone()[0]
    assert pnl == -20, f"Daily realized PnL mismatch: {pnl}"
    db.execute("""INSERT INTO risk_events(id,account_id,event_type,reason)
      VALUES(?,?,?,?)""", ("event-1","test-account","ORDER_REJECTED","DAILY_LOSS_CIRCUIT_BREAKER"))
    assert db.execute("SELECT count(*) FROM risk_events").fetchone()[0] == 1
    try:
        db.execute("""INSERT INTO sim_orders(id,account_id,symbol,action,side,qty,price,notional_usdt,risk_usdt)
          VALUES(?,?,?,?,?,?,?,?,?)""",
          ("bad","missing-account","BTCUSDT","OPEN","long",1,100,100,4))
        raise AssertionError("Foreign key protection missing")
    except sqlite3.IntegrityError:
        pass
    db.execute("""INSERT INTO whale_alert_events(event_key,symbol,source,trade_id,trade_time,side,price,notional_usdt)
      VALUES(?,?,?,?,?,?,?,?)""", ("OKX:BTCUSDT:123","BTCUSDT","OKX","123",1,"buy",100,120000))
    db.execute("""INSERT OR IGNORE INTO whale_alert_events(event_key,symbol,source,trade_id,trade_time,side,price,notional_usdt)
      SELECT ?,?,?,?,?,?,?,? WHERE NOT EXISTS
        (SELECT 1 FROM whale_alert_events WHERE symbol=? AND created_at > datetime('now','-15 minutes'))""",
        ("OKX:BTCUSDT:124","BTCUSDT","OKX","124",2,"buy",100,120000,"BTCUSDT"))
    assert db.execute("SELECT count(*) FROM whale_alert_events").fetchone()[0] == 1, "Whale cooldown broken"
    print("OK: migrations 0001/0002 idempotent, ledger PnL, audit, whale alert cooldown and foreign keys")
