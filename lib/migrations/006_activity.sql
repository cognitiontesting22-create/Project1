-- The per-group activity log: one row for every expense created, edited or
-- deleted and every settlement created or deleted. Each row is written in the
-- same transaction as the change it describes.
--
-- actor_id is the acting-as member at the time, NULL when Tally posted the row
-- itself (recurring expenses, plan instalments). It deliberately has no foreign
-- key: the log outlives a member being removed, and actor_name keeps the name
-- it was written under.
--
-- Amounts are the booked amount_cents in the group's currency. before_json and
-- after_json hold the full row (and an expense's splits) on each side of the
-- change, so it can be put back later.
CREATE TABLE IF NOT EXISTS activity (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id      INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('expense_created', 'expense_edited', 'expense_deleted',
                                              'settlement_created', 'settlement_deleted')),
  -- ISO 8601 UTC, e.g. 2026-10-18T14:03:22Z, from the app's clock (TALLY_NOW pins it).
  occurred_at   TEXT NOT NULL,
  actor_id      INTEGER,
  actor_name    TEXT,
  summary       TEXT NOT NULL,
  amount_before INTEGER,
  amount_after  INTEGER,
  expense_id    INTEGER,
  settlement_id INTEGER,
  before_json   TEXT,
  after_json    TEXT,
  CHECK (
    (kind IN ('expense_created', 'settlement_created')
       AND amount_before IS NULL AND amount_after IS NOT NULL
       AND before_json IS NULL AND after_json IS NOT NULL)
    OR (kind IN ('expense_deleted', 'settlement_deleted')
       AND amount_before IS NOT NULL AND amount_after IS NULL
       AND before_json IS NOT NULL AND after_json IS NULL)
    OR (kind = 'expense_edited'
       AND amount_before IS NOT NULL AND amount_after IS NOT NULL
       AND before_json IS NOT NULL AND after_json IS NOT NULL)
  ),
  CHECK ((kind LIKE 'expense_%') = (expense_id IS NOT NULL)),
  CHECK ((kind LIKE 'settlement_%') = (settlement_id IS NOT NULL))
);

-- Newest first within a group is the only order the log is read in.
CREATE INDEX IF NOT EXISTS idx_activity_group ON activity(group_id, id);
