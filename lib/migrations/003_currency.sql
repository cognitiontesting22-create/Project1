-- Expenses can be entered in a currency other than the group's. The group's
-- currency stays the single unit that balances are computed in, so they keep
-- summing to zero.
--
-- A rate is "units of this currency per 1 USD", scaled by 1e8. Everything is
-- quoted against one base so cross-rates can't disagree with each other.
CREATE TABLE IF NOT EXISTS exchange_rates (
  currency   TEXT PRIMARY KEY,
  rate_e8    INTEGER NOT NULL CHECK (rate_e8 > 0),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO exchange_rates (currency, rate_e8) VALUES
  ('USD',    100000000),
  ('EUR',     92000000),
  ('GBP',     79000000),
  ('CAD',    136000000),
  ('AUD',    152000000),
  ('CHF',     88000000),
  ('MXN',   1710000000),
  ('INR',   8320000000),
  ('JPY',  15700000000);

-- What the user actually typed, plus the rate it was booked at. The converted
-- `amount_cents` is authoritative and never recomputed, so editing the rate
-- table later cannot retroactively change a past expense or a settled balance.
ALTER TABLE expenses ADD COLUMN original_amount_cents INTEGER;
ALTER TABLE expenses ADD COLUMN original_currency TEXT;
ALTER TABLE expenses ADD COLUMN rate_e8 INTEGER;

UPDATE expenses
   SET original_amount_cents = amount_cents,
       original_currency = (SELECT g.currency FROM groups g WHERE g.id = expenses.group_id),
       rate_e8 = 100000000
 WHERE original_currency IS NULL;

ALTER TABLE settlements ADD COLUMN original_amount_cents INTEGER;
ALTER TABLE settlements ADD COLUMN original_currency TEXT;
ALTER TABLE settlements ADD COLUMN rate_e8 INTEGER;

UPDATE settlements
   SET original_amount_cents = amount_cents,
       original_currency = (SELECT g.currency FROM groups g WHERE g.id = settlements.group_id),
       rate_e8 = 100000000
 WHERE original_currency IS NULL;
