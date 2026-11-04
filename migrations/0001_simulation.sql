-- REVIEW ONLY: apply to a NEW local/preview SIM_DB. Never to production DB.
PRAGMA foreign_keys = ON;
CREATE TABLE sim_accounts (
 id TEXT PRIMARY KEY CHECK(id='paper-1000'), cash INTEGER NOT NULL,
 revision INTEGER NOT NULL DEFAULT 0, day TEXT NOT NULL DEFAULT '',
 daily_pnl INTEGER NOT NULL DEFAULT 0, streak INTEGER NOT NULL DEFAULT 0,
 position TEXT CHECK(position IS NULL OR json_valid(position))
);
INSERT INTO sim_accounts(id,cash) VALUES('paper-1000',1000000000);
CREATE TABLE sim_orders (
 id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, action TEXT NOT NULL CHECK(action IN ('open','close')),
 symbol TEXT NOT NULL CHECK(symbol IN ('BTCUSDT','ETHUSDT','SOLUSDT')), revision INTEGER NOT NULL UNIQUE,
 day TEXT NOT NULL, time INTEGER NOT NULL, fill REAL NOT NULL CHECK(fill>0),
 cash_delta INTEGER NOT NULL, position_delta INTEGER NOT NULL, fee INTEGER NOT NULL CHECK(fee>=0),
 pnl INTEGER NOT NULL, position TEXT CHECK(position IS NULL OR json_valid(position)), source TEXT NOT NULL
);
CREATE TABLE sim_ledger (
 seq INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT NOT NULL REFERENCES sim_orders(id),
 bucket TEXT NOT NULL CHECK(bucket IN ('cash','position','fees','pnl')), amount INTEGER NOT NULL,
 UNIQUE(order_id,bucket)
);
CREATE TRIGGER sim_guard BEFORE INSERT ON sim_orders BEGIN
 SELECT CASE WHEN NEW.revision != (SELECT revision FROM sim_accounts WHERE id='paper-1000') THEN RAISE(ABORT,'revision conflict') END;
 SELECT CASE WHEN NEW.action='open' AND (
   (SELECT position IS NOT NULL OR cash + NEW.cash_delta < 0 OR streak>=3 OR (day=NEW.day AND daily_pnl<=-20000000) FROM sim_accounts WHERE id='paper-1000')
   OR NEW.position_delta<=0 OR NEW.position_delta>250000000 OR NEW.position IS NULL
   OR NEW.cash_delta != -NEW.position_delta-NEW.fee OR NEW.pnl!=0
 ) THEN RAISE(ABORT,'open risk guard') END;
 SELECT CASE WHEN NEW.action='close' AND (
   (SELECT position IS NULL OR json_extract(position,'$.symbol')!=NEW.symbol OR NEW.position_delta != -json_extract(position,'$.notional') OR NEW.cash_delta != json_extract(position,'$.notional') + NEW.pnl + json_extract(position,'$.entryFee') FROM sim_accounts WHERE id='paper-1000')
   OR NEW.position IS NOT NULL
 ) THEN RAISE(ABORT,'close guard') END;
END;
CREATE TRIGGER sim_post AFTER INSERT ON sim_orders BEGIN
 INSERT INTO sim_ledger(order_id,bucket,amount) VALUES(NEW.id,'cash',NEW.cash_delta),(NEW.id,'position',NEW.position_delta),(NEW.id,'fees',NEW.fee),
 (NEW.id,'pnl',-NEW.cash_delta-NEW.position_delta-NEW.fee);
 UPDATE sim_accounts SET cash=cash+NEW.cash_delta, revision=revision+1, position=NEW.position,
 daily_pnl=CASE WHEN day=NEW.day THEN daily_pnl ELSE 0 END + NEW.pnl,
 day=NEW.day,
 streak=CASE WHEN NEW.action='open' THEN streak WHEN NEW.pnl<0 THEN streak+1 ELSE 0 END
 WHERE id='paper-1000';
END;
CREATE TRIGGER sim_orders_no_update BEFORE UPDATE ON sim_orders BEGIN SELECT RAISE(ABORT,'immutable orders'); END;
CREATE TRIGGER sim_orders_no_delete BEFORE DELETE ON sim_orders BEGIN SELECT RAISE(ABORT,'immutable orders'); END;
CREATE TRIGGER sim_ledger_no_update BEFORE UPDATE ON sim_ledger BEGIN SELECT RAISE(ABORT,'immutable ledger'); END;
CREATE TRIGGER sim_ledger_no_delete BEFORE DELETE ON sim_ledger BEGIN SELECT RAISE(ABORT,'immutable ledger'); END;
