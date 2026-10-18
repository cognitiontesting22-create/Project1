-- Periods a recurring schedule must never post again because the expense it
-- posted for them was edited into a one-off. Editing detaches the expense
-- (its recurring_id and period are cleared, so it reads as manual), and this
-- row keeps the period claimed so there are never two rents for one month,
-- even if that one-off is deleted later. Undoing the edit relinks the expense
-- and removes the row.
CREATE TABLE IF NOT EXISTS recurring_detached (
  recurring_id INTEGER NOT NULL REFERENCES recurring_expenses(id) ON DELETE CASCADE,
  period       TEXT NOT NULL,
  -- The expense that was detached, for the record; it may since have been deleted.
  expense_id   INTEGER,
  PRIMARY KEY (recurring_id, period)
);
