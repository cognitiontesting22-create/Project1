-- Recurring expenses: a template plus a calendar rule. Nothing is pre-generated;
-- occurrences are materialised into real expenses as their due date arrives, so
-- editing or cancelling a recurrence never has to rewrite history.
CREATE TABLE IF NOT EXISTS recurring_expenses (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id        INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  description     TEXT NOT NULL,
  amount_cents    INTEGER NOT NULL CHECK (amount_cents > 0),
  currency        TEXT NOT NULL,
  paid_by         INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  category        TEXT NOT NULL DEFAULT 'rent',
  split_type      TEXT NOT NULL DEFAULT 'equal',
  -- The day of the month it wants to land on. Short months clamp to their last
  -- day without the anchor itself drifting.
  anchor_day      INTEGER NOT NULL CHECK (anchor_day BETWEEN 1 AND 31),
  interval_months INTEGER NOT NULL DEFAULT 1 CHECK (interval_months >= 1),
  start_date      TEXT NOT NULL,
  end_date        TEXT,
  active          INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_recurring_group ON recurring_expenses(group_id);

CREATE TABLE IF NOT EXISTS recurring_participants (
  recurring_id INTEGER NOT NULL REFERENCES recurring_expenses(id) ON DELETE CASCADE,
  member_id    INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  -- In the split mode's unit: cents, basis points, or centishares. NULL for equal.
  value        INTEGER,
  PRIMARY KEY (recurring_id, member_id)
);

-- Link a posted expense back to the recurrence that produced it. The partial
-- unique index is what makes catch-up posting idempotent: two concurrent page
-- loads cannot both post January's rent.
ALTER TABLE expenses ADD COLUMN recurring_id INTEGER REFERENCES recurring_expenses(id) ON DELETE SET NULL;
ALTER TABLE expenses ADD COLUMN period TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_expenses_recurrence
  ON expenses(recurring_id, period) WHERE recurring_id IS NOT NULL;

-- Payment plans: "I can't cover my share now, I'll pay you back over N months."
CREATE TABLE IF NOT EXISTS payment_plans (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id         INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  debtor_id        INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  creditor_id      INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  principal_cents  INTEGER NOT NULL CHECK (principal_cents > 0),
  apr_bp           INTEGER NOT NULL DEFAULT 0 CHECK (apr_bp >= 0),
  installments     INTEGER NOT NULL CHECK (installments >= 1),
  grace_periods    INTEGER NOT NULL DEFAULT 0 CHECK (grace_periods >= 0),
  anchor_day       INTEGER NOT NULL CHECK (anchor_day BETWEEN 1 AND 31),
  start_date       TEXT NOT NULL,
  note             TEXT NOT NULL DEFAULT '',
  cancelled        INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (debtor_id <> creditor_id)
);
CREATE INDEX IF NOT EXISTS idx_plans_group ON payment_plans(group_id);

-- The whole schedule is computed and stored up front, so the terms someone
-- agreed to are a fixed record rather than something recomputed later.
CREATE TABLE IF NOT EXISTS plan_installments (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id             INTEGER NOT NULL REFERENCES payment_plans(id) ON DELETE CASCADE,
  number              INTEGER NOT NULL,
  due_date            TEXT NOT NULL,
  period              TEXT NOT NULL,
  payment_cents       INTEGER NOT NULL,
  principal_cents     INTEGER NOT NULL,
  interest_cents      INTEGER NOT NULL,
  balance_cents       INTEGER NOT NULL,
  in_grace            INTEGER NOT NULL DEFAULT 0,
  -- Set when the instalment has been turned into real ledger rows.
  posted_at           TEXT,
  settlement_id       INTEGER REFERENCES settlements(id) ON DELETE SET NULL,
  interest_expense_id INTEGER REFERENCES expenses(id) ON DELETE SET NULL,
  UNIQUE (plan_id, number)
);
CREATE INDEX IF NOT EXISTS idx_installments_due ON plan_installments(due_date);
