const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.TALLY_NOW = '2026-10-18T14:03:22Z';
require('./harness.cjs');

const { listActivity, undoableEntryIds } = require('../.test-build/activity-queries.js');
const { getBudgetReport } = require('../.test-build/budget-queries.js');
const q = require('../.test-build/queries.js');
const sq = require('../.test-build/scheduling-queries.js');
const { undoActivity } = require('../.test-build/undo.js');
const { db } = require('../.test-build/db.js');

function setUp() {
  const groupId = q.createGroup({ name: 'Trip', currency: 'USD', memberNames: ['Ana', 'Ben', 'Cy'] });
  const [ana, ben, cy] = q.listMembers(groupId).map((m) => m.id);
  const dinnerId = q.createExpense({
    groupId,
    description: 'Dinner',
    amountCents: 9000,
    paidBy: ben,
    category: 'food',
    splitType: 'percent',
    spentAt: '2026-10-10',
    participants: [ana, ben, cy],
    values: { [ana]: 5000, [ben]: 2500, [cy]: 2500 },
    actorId: ana,
  });
  return { groupId, ana, ben, cy, dinnerId };
}

/** Everything a person can see about a group's money, for before/after comparisons. */
function world(groupId) {
  return {
    expenses: db.prepare('SELECT * FROM expenses WHERE group_id = ? ORDER BY id').all(groupId),
    splits: db
      .prepare(
        `SELECT s.* FROM expense_splits s JOIN expenses e ON e.id = s.expense_id
          WHERE e.group_id = ? ORDER BY s.expense_id, s.member_id`
      )
      .all(groupId)
      .map(({ id, ...rest }) => rest),
    ledger: q.listExpenses(groupId),
    balances: q.getBalances(groupId),
    budgets: getBudgetReport(groupId, '2026-10'),
  };
}

const entry = (groupId, kind) => listActivity(groupId, { kind })[0];

function edit(groupId, id, ana, ben, cy, changes) {
  q.updateExpense(id, {
    groupId,
    description: 'Dinner',
    amountCents: 9000,
    paidBy: ben,
    category: 'food',
    splitType: 'percent',
    spentAt: '2026-10-10',
    participants: [ana, ben, cy],
    values: { [ana]: 5000, [ben]: 2500, [cy]: 2500 },
    actorId: ana,
    ...changes,
  });
}

test('undoing a delete restores the expense exactly, splits, balances and budgets included', () => {
  const { groupId, ana, ben, dinnerId } = setUp();
  const before = world(groupId);

  q.deleteExpense(dinnerId, ana);
  assert.notDeepEqual(world(groupId), before);
  const deleted = entry(groupId, 'expense_deleted');

  const undoId = undoActivity(groupId, deleted.id, ben);
  assert.deepEqual(world(groupId), before);

  const restored = listActivity(groupId)[0];
  assert.equal(restored.id, undoId);
  assert.equal(restored.kind, 'expense_restored');
  assert.equal(restored.summary, 'Ben restored "Dinner" ($90.00)');
  assert.equal(restored.actor_id, ben);
  assert.equal(restored.amount_before, null);
  assert.equal(restored.amount_after, 9000);
  assert.equal(restored.undoes_id, deleted.id);
  assert.equal(entry(groupId, 'expense_deleted').undone_by_id, undoId);

  assert.throws(() => undoActivity(groupId, deleted.id, ben), {
    message: `Entry #${deleted.id} has already been undone.`,
  });
});

test('edits undo newest first, and an older edit is refused until the newer one is undone', () => {
  const { groupId, ana, ben, cy, dinnerId } = setUp();
  const original = world(groupId);

  edit(groupId, dinnerId, ana, ben, cy, { amountCents: 12000, splitType: 'equal', values: {} });
  const first = entry(groupId, 'expense_edited');
  edit(groupId, dinnerId, ana, ben, cy, { description: 'Supper', amountCents: 15000, paidBy: cy, splitType: 'equal', values: {} });
  const second = entry(groupId, 'expense_edited');
  const afterBoth = world(groupId);

  assert.deepEqual(undoableEntryIds(groupId), [second.id]);
  assert.throws(() => undoActivity(groupId, first.id, ana), {
    message: `Can't undo entry #${first.id}. Entry #${second.id} changed this expense afterwards, undo that one first.`,
  });
  assert.deepEqual(world(groupId), afterBoth, 'a refusal writes nothing');

  undoActivity(groupId, second.id, ana);
  let revert = entry(groupId, 'expense_reverted');
  assert.equal(revert.summary, `Ana reverted "Dinner" to its version before entry #${second.id}`);
  assert.deepEqual([revert.amount_before, revert.amount_after], [15000, 12000]);
  assert.deepEqual(undoableEntryIds(groupId), [first.id], 'the older edit is undoable again');

  undoActivity(groupId, first.id, ana);
  revert = entry(groupId, 'expense_reverted');
  assert.equal(revert.summary, `Ana reverted "Dinner" to its version before entry #${first.id}`);
  assert.deepEqual([revert.amount_before, revert.amount_after], [12000, 9000]);
  assert.deepEqual(world(groupId), original, 'back on the original expense');

  assert.deepEqual(
    listActivity(groupId).map((e) => e.kind),
    ['expense_reverted', 'expense_reverted', 'expense_edited', 'expense_edited', 'expense_created']
  );
  assert.deepEqual(undoableEntryIds(groupId), []);
});

test('a revert puts back the stored version without reconverting currency', () => {
  const { groupId, ana, ben, cy, dinnerId } = setUp();
  edit(groupId, dinnerId, ana, ben, cy, { amountCents: 10000, currency: 'EUR' });
  const euroVersion = world(groupId);
  edit(groupId, dinnerId, ana, ben, cy, { amountCents: 5000, currency: 'USD' });

  // The rate table moves; the revert must still bring back the old booked figures.
  q.upsertRate('EUR', 50000000);
  undoActivity(groupId, entry(groupId, 'expense_edited').id, ana);
  assert.deepEqual(world(groupId), euroVersion);
});

test('an edit to an expense that has since been deleted is refused, naming the delete', () => {
  const { groupId, ana, ben, cy, dinnerId } = setUp();
  edit(groupId, dinnerId, ana, ben, cy, { amountCents: 12000 });
  const edited = entry(groupId, 'expense_edited');
  q.deleteExpense(dinnerId, ana);
  const deleted = entry(groupId, 'expense_deleted');

  assert.throws(() => undoActivity(groupId, edited.id, ana), {
    message: `Can't undo entry #${edited.id}. Entry #${deleted.id} changed this expense afterwards, undo that one first.`,
  });

  // Once the delete is undone, the edit can be undone too.
  undoActivity(groupId, deleted.id, ana);
  undoActivity(groupId, edited.id, ana);
  assert.equal(q.getExpense(groupId, dinnerId).amount_cents, 9000);
});

test('only edits and deletions of expenses can be undone', () => {
  const { groupId, ana, ben, cy, dinnerId } = setUp();
  const settlementId = q.createSettlement({ groupId, fromMemberId: ben, toMemberId: cy, amountCents: 4000, actorId: ana });
  q.deleteSettlement(settlementId, ana);
  q.deleteExpense(dinnerId, ana);
  undoActivity(groupId, entry(groupId, 'expense_deleted').id, ana);

  for (const kind of ['expense_created', 'settlement_created', 'settlement_deleted', 'expense_restored']) {
    assert.throws(() => undoActivity(groupId, entry(groupId, kind).id, ana), {
      message: 'Only edits and deletions of expenses can be undone.',
    });
  }
  assert.throws(() => undoActivity(groupId, 999999, ana), { message: 'Unknown activity entry.' });
  const other = setUp();
  assert.throws(() => undoActivity(other.groupId, entry(groupId, 'expense_deleted').id, ana), {
    message: 'Unknown activity entry.',
  });
});

test('a restore is refused when someone in it has left the group, and writes nothing', () => {
  const { groupId, ana, ben, dinnerId } = setUp();
  q.deleteExpense(dinnerId, ana);
  assert.equal(q.memberHasActivity(ben), false);
  q.removeMember(ben);
  const before = { world: world(groupId), log: listActivity(groupId) };

  assert.throws(() => undoActivity(groupId, entry(groupId, 'expense_deleted').id, ana), {
    message: 'Can\'t restore "Dinner" because Ben is no longer in this group.',
  });
  assert.deepEqual({ world: world(groupId), log: listActivity(groupId) }, before);
});

test('a restored recurring posting rejoins its schedule only while the period is free', () => {
  const { groupId, ana, ben } = setUp();
  const recurringId = sq.createRecurring({
    groupId,
    description: 'Rent',
    amountCents: 100000,
    currency: 'USD',
    paidBy: ana,
    category: 'rent',
    splitType: 'equal',
    anchorDay: 1,
    intervalMonths: 1,
    startDate: '2026-01-01',
    endDate: '2026-02-28',
    participants: [ana, ben],
  });
  sq.postDueItems(groupId);
  const rent = () => db.prepare("SELECT * FROM expenses WHERE recurring_id = ? AND period = '2026-01'").get(recurringId);
  const january = rent();

  // Period still free: comes back linked.
  q.deleteExpense(january.id, ana);
  undoActivity(groupId, entry(groupId, 'expense_deleted').id, ana);
  assert.deepEqual(rent(), january);

  // The schedule posts January again before the undo: comes back detached.
  q.deleteExpense(january.id, ana);
  const deleted = entry(groupId, 'expense_deleted');
  sq.postDueItems(groupId);
  const reposted = rent();
  assert.notEqual(reposted.id, january.id);
  undoActivity(groupId, deleted.id, ana);
  const back = db.prepare('SELECT * FROM expenses WHERE id = ?').get(january.id);
  assert.deepEqual(back, { ...january, recurring_id: null, period: null });
  assert.equal(rent().id, reposted.id);
});

test('restoring deleted plan interest relinks it, so it still is not spending', () => {
  const { groupId, ana, ben } = setUp();
  sq.createPlan({
    groupId,
    debtorId: ben,
    creditorId: ana,
    principalCents: 10000,
    aprBp: 1200,
    installments: 1,
    gracePeriods: 0,
    anchorDay: 1,
    startDate: '2026-10-01',
  });
  sq.postDueItems(groupId);
  const before = world(groupId);
  const interestId = db
    .prepare(
      `SELECT interest_expense_id AS id FROM plan_installments i JOIN payment_plans p ON p.id = i.plan_id
        WHERE p.group_id = ?`
    )
    .get(groupId).id;

  q.deleteExpense(interestId, ana);
  undoActivity(groupId, entry(groupId, 'expense_deleted').id, ana);
  assert.deepEqual(world(groupId), before);
  assert.equal(q.listExpenses(groupId).find((e) => e.id === interestId).source, 'plan');
});

test('007 upgrades a database that already logged activity under 006, ids and rows intact', async () => {
  const Database = require('better-sqlite3');
  const { runMigrations } = await import('../lib/migrate.mjs');
  const source = path.join(__dirname, '..', 'lib', 'migrations');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tally-migrations-'));
  const file = path.join(dir, 'upgrade.db');
  const old = new Database(file);
  old.pragma('foreign_keys = ON');

  for (const f of fs.readdirSync(source).filter((f) => f < '007')) fs.copyFileSync(path.join(source, f), path.join(dir, f));
  runMigrations(old, dir);
  old.prepare("INSERT INTO groups (name) VALUES ('Old')").run();
  const insert = old.prepare(
    `INSERT INTO activity (group_id, kind, occurred_at, summary, amount_after, expense_id, after_json)
     VALUES (1, 'expense_created', '2026-10-01T00:00:00Z', ?, 100, ?, '{}')`
  );
  for (let i = 1; i <= 3; i++) insert.run(`entry ${i}`, i);
  old.prepare('DELETE FROM activity WHERE id = 3').run();
  const rows = old.prepare('SELECT * FROM activity ORDER BY id').all();

  fs.copyFileSync(path.join(source, '007_activity_undo.sql'), path.join(dir, '007_activity_undo.sql'));
  runMigrations(old, dir);
  assert.deepEqual(
    old.prepare('SELECT * FROM activity ORDER BY id').all(),
    rows.map((r) => ({ ...r, undone_by_id: null, undoes_id: null }))
  );
  // AUTOINCREMENT carries on past the deleted id 3 rather than reusing it.
  insert.run('entry 4', 4);
  assert.equal(old.prepare('SELECT MAX(id) AS id FROM activity').get().id, 4);
  assert.equal(old.pragma('foreign_key_check').length, 0);
  old.close();
});

test('undoable means an undo would succeed now, and each refusal carries its HTTP status', () => {
  const { undoableNow, undoRefusal } = require('../.test-build/undo.js');
  const { getActivity } = require('../.test-build/activity-queries.js');
  const { groupId, ana, ben, cy, dinnerId } = setUp();
  edit(groupId, dinnerId, ana, ben, cy, { amountCents: 12000 });
  const edited = entry(groupId, 'expense_edited');
  q.deleteExpense(dinnerId, ana);
  const deleted = entry(groupId, 'expense_deleted');
  assert.deepEqual(undoableNow(groupId), [deleted.id]);

  const status = (id) => {
    try {
      undoActivity(groupId, id, ana);
      return 200;
    } catch (err) {
      return err.status;
    }
  };
  assert.equal(status(edited.id), 409, 'superseded');
  assert.equal(status(entry(groupId, 'expense_created').id), 400, 'wrong kind');
  assert.equal(status(999999), 404, 'unknown');

  // Nobody else references Ben now, so he can leave; the delete stops being undoable.
  q.removeMember(ben);
  assert.deepEqual(undoableNow(groupId), []);
  assert.equal(undoRefusal(groupId, getActivity(groupId, deleted.id)).status, 409);
  assert.equal(status(deleted.id), 409, 'someone left');
});
