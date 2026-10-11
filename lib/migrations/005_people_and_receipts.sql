-- A person who may appear in several groups. `members` stays per-group (it
-- carries group-specific history); this is the identity those rows point at.
CREATE TABLE IF NOT EXISTS people (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  display_name TEXT NOT NULL,
  email        TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

ALTER TABLE members ADD COLUMN person_id INTEGER REFERENCES people(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_members_person ON members(person_id);

-- Backfill: one person per distinct case-insensitive name, which is the link a
-- human would confirm anyway for existing data. Linking is editable afterwards,
-- so two genuinely different people sharing a name can be split apart.
INSERT INTO people (display_name, email)
SELECT MIN(name), MAX(email) FROM members
 WHERE person_id IS NULL
 GROUP BY replace(replace(replace(lower(trim(name)),'  ',' '),'  ',' '),'  ',' ');

UPDATE members SET person_id = (
  SELECT p.id FROM people p
   WHERE replace(replace(replace(lower(trim(p.display_name)),'  ',' '),'  ',' '),'  ',' ') = replace(replace(replace(lower(trim(members.name)),'  ',' '),'  ',' '),'  ',' ')
) WHERE person_id IS NULL;

-- An itemised bill. The expense row stays the source of truth for balances;
-- these tables record how its total was arrived at.
CREATE TABLE IF NOT EXISTS receipts (
  expense_id INTEGER PRIMARY KEY REFERENCES expenses(id) ON DELETE CASCADE,
  tax_cents  INTEGER NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  tip_cents  INTEGER NOT NULL DEFAULT 0 CHECK (tip_cents >= 0)
);

CREATE TABLE IF NOT EXISTS receipt_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  expense_id   INTEGER NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  position     INTEGER NOT NULL,
  description  TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0)
);
CREATE INDEX IF NOT EXISTS idx_receipt_items_expense ON receipt_items(expense_id);

-- Who had this item. An item's cost is divided equally between everyone
-- assigned to it; the resolved amount is stored so the receipt view never has
-- to recompute it.
CREATE TABLE IF NOT EXISTS receipt_item_shares (
  item_id      INTEGER NOT NULL REFERENCES receipt_items(id) ON DELETE CASCADE,
  member_id    INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  amount_cents INTEGER NOT NULL,
  PRIMARY KEY (item_id, member_id)
);

-- Breakdown of each person's share of a receipt. amount_cents on the split row
-- remains the total; these three columns say where it came from and always add
-- up to it.
ALTER TABLE expense_splits ADD COLUMN items_cents INTEGER;
ALTER TABLE expense_splits ADD COLUMN tax_cents INTEGER;
ALTER TABLE expense_splits ADD COLUMN tip_cents INTEGER;
