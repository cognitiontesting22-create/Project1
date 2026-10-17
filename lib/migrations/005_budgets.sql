-- Monthly spending budgets per category. A row is a standing budget that takes
-- effect from `effective_from` (YYYY-MM) and carries forward until a later row
-- for the same category replaces it, so changing next month's budget never
-- rewrites what an earlier month was measured against.
--
-- amount_cents is in the group's currency, like every other booked figure. A
-- NULL amount is a tombstone: "no budget for this category from this month on".
CREATE TABLE IF NOT EXISTS budgets (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id       INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  category       TEXT NOT NULL,
  amount_cents   INTEGER CHECK (amount_cents IS NULL OR amount_cents >= 0),
  effective_from TEXT NOT NULL
                 CHECK (effective_from GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  -- Doubles as the index for "latest row on or before this month".
  UNIQUE (group_id, category, effective_from)
);
