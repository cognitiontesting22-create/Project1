-- Undo for the activity log: two new kinds, and a link both ways between an
-- undone entry and the entry that undid it.
--
--   expense_restored  the undo of an expense_deleted entry
--   expense_reverted  the undo of an expense_edited entry
--
-- undone_by_id is set on the entry that was undone; undoes_id on the undo entry.
-- SQLite can't change a CHECK constraint in place, so the table is rebuilt
-- with every existing row carried over under the same id.
CREATE TABLE activity_v2 (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id      INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('expense_created', 'expense_edited', 'expense_deleted',
                                              'settlement_created', 'settlement_deleted',
                                              'expense_restored', 'expense_reverted')),
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
  undone_by_id  INTEGER,
  undoes_id     INTEGER,
  CHECK (
    (kind IN ('expense_created', 'settlement_created', 'expense_restored')
       AND amount_before IS NULL AND amount_after IS NOT NULL
       AND before_json IS NULL AND after_json IS NOT NULL)
    OR (kind IN ('expense_deleted', 'settlement_deleted')
       AND amount_before IS NOT NULL AND amount_after IS NULL
       AND before_json IS NOT NULL AND after_json IS NULL)
    OR (kind IN ('expense_edited', 'expense_reverted')
       AND amount_before IS NOT NULL AND amount_after IS NOT NULL
       AND before_json IS NOT NULL AND after_json IS NOT NULL)
  ),
  CHECK ((kind LIKE 'expense_%') = (expense_id IS NOT NULL)),
  CHECK ((kind LIKE 'settlement_%') = (settlement_id IS NOT NULL)),
  -- Only edits and deletions can be undone, and only undo entries undo anything.
  CHECK (undone_by_id IS NULL OR kind IN ('expense_edited', 'expense_deleted')),
  CHECK ((undoes_id IS NOT NULL) = (kind IN ('expense_restored', 'expense_reverted')))
);

INSERT INTO activity_v2
  (id, group_id, kind, occurred_at, actor_id, actor_name, summary, amount_before, amount_after,
   expense_id, settlement_id, before_json, after_json)
SELECT id, group_id, kind, occurred_at, actor_id, actor_name, summary, amount_before, amount_after,
       expense_id, settlement_id, before_json, after_json
  FROM activity;

-- Carry the AUTOINCREMENT counter over, so ids of entries removed with their
-- group are never handed out again.
DELETE FROM sqlite_sequence WHERE name = 'activity_v2';
INSERT INTO sqlite_sequence (name, seq) SELECT 'activity_v2', seq FROM sqlite_sequence WHERE name = 'activity';

DROP TABLE activity;
ALTER TABLE activity_v2 RENAME TO activity;

CREATE INDEX IF NOT EXISTS idx_activity_group ON activity(group_id, id);
-- "The latest change to this expense not yet undone" is the undo rule's lookup.
CREATE INDEX IF NOT EXISTS idx_activity_expense ON activity(expense_id, id);
-- Each entry can be undone once.
CREATE UNIQUE INDEX IF NOT EXISTS idx_activity_undoes ON activity(undoes_id) WHERE undoes_id IS NOT NULL;
