const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const {
  BUDGETS_IN_EFFECT_SQL,
  SPEND_BY_CATEGORY_SQL,
  budgetStatus,
  buildBudgetReport,
  isEditableMonth,
  isMonth,
  monthRange,
  shiftMonth,
} = require('../.test-build/budgets.js');

/* ------------------------------------------------------------ month helpers -- */

test('month params must be YYYY-MM with a real month', () => {
  assert.ok(isMonth('2026-10'));
  assert.ok(isMonth('2026-01'));
  for (const bad of ['2026-13', '2026-00', '2026-1', '2026-10-01', '', 'October']) {
    assert.equal(isMonth(bad), false, bad);
  }
});

test('month ranges end on the last real day, including leap years', () => {
  assert.deepEqual(monthRange('2026-02'), { start: '2026-02-01', end: '2026-02-28' });
  assert.deepEqual(monthRange('2028-02'), { start: '2028-02-01', end: '2028-02-29' });
  assert.deepEqual(monthRange('2026-12'), { start: '2026-12-01', end: '2026-12-31' });
});

test('shifting months crosses year boundaries both ways', () => {
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.equal(shiftMonth('2026-10', -14), '2025-08');
});

test('only this month and later can be edited', () => {
  assert.equal(isEditableMonth('2026-09', '2026-10'), false);
  assert.equal(isEditableMonth('2026-10', '2026-10'), true);
  assert.equal(isEditableMonth('2027-01', '2026-10'), true);
});

/* ------------------------------------------------------------- status math -- */

test('status thresholds: near from 80%, over only above 100%', () => {
  assert.deepEqual(budgetStatus(10000, 7999), { percent_bp: 7999, status: 'under' });
  assert.deepEqual(budgetStatus(10000, 8000), { percent_bp: 8000, status: 'near' });
  assert.deepEqual(budgetStatus(10000, 10000), { percent_bp: 10000, status: 'near' });
  assert.deepEqual(budgetStatus(10000, 10001), { percent_bp: 10001, status: 'over' });
});

test('percent is floored basis points, never rounded up into the next band', () => {
  // 2/3 of a budget is 66.66…%, not 66.67%.
  assert.equal(budgetStatus(300, 200).percent_bp, 6666);
  // 79.995% must not round up to "near".
  assert.equal(budgetStatus(20000, 15999).status, 'under');
});

test('a zero budget has no percentage and any spend is over', () => {
  assert.deepEqual(budgetStatus(0, 0), { percent_bp: null, status: 'under' });
  assert.deepEqual(budgetStatus(0, 1), { percent_bp: null, status: 'over' });
});

test('the report lists budgeted categories in a fixed order with remaining', () => {
  const report = buildBudgetReport(
    '2026-10',
    [
      { category: 'rent', amount_cents: 200000, effective_from: '2026-01' },
      { category: 'food', amount_cents: 40000, effective_from: '2026-10' },
    ],
    [
      { category: 'food', spent_cents: 45000 },
      { category: 'travel', spent_cents: 12000 },
      { category: 'fun', spent_cents: 3000 },
    ]
  );

  assert.deepEqual(report.lines.map((l) => l.category), ['food', 'rent'], 'CATEGORIES order');
  const food = report.lines[0];
  assert.equal(food.remaining_cents, -5000, 'over budget goes negative');
  assert.equal(food.status, 'over');
  assert.equal(report.lines[1].spent_cents, 0, 'a budget with no spend still shows');
  assert.deepEqual(
    report.unbudgeted.map((u) => [u.category, u.spent_cents]),
    [['travel', 12000], ['fun', 3000]],
    'unbudgeted spend, largest first'
  );
});

test('spend under an unknown category counts as General, as the ledger shows it', () => {
  const report = buildBudgetReport(
    '2026-10',
    [{ category: 'general', amount_cents: 10000, effective_from: '2026-10' }],
    [
      { category: 'general', spent_cents: 2000 },
      { category: 'groceries-legacy', spent_cents: 3000 },
    ]
  );
  assert.equal(report.lines[0].spent_cents, 5000);
  assert.deepEqual(report.unbudgeted, []);
});

/* ------------------------------------------------ the real SQL, real DB -- */

function buildDatabase() {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tally-')), 'test.db');
  const db = new Database(file);
  db.pragma('foreign_keys = ON');

  const dir = path.join(__dirname, '..', 'lib', 'migrations');
  for (const name of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(fs.readFileSync(path.join(dir, name), 'utf8'));
  }
  return db;
}

function seed(db) {
  const groupId = Number(
    db.prepare("INSERT INTO groups (name, currency) VALUES ('Flat', 'USD')").run().lastInsertRowid
  );
  const member = (name) =>
    Number(
      db.prepare('INSERT INTO members (group_id, name) VALUES (?, ?)').run(groupId, name)
        .lastInsertRowid
    );
  const alex = member('Alex');
  const sam = member('Sam');

  const expense = (cents, category, spentAt, extra = {}) =>
    Number(
      db
        .prepare(
          `INSERT INTO expenses (group_id, description, amount_cents, paid_by, category, spent_at,
                                 original_amount_cents, original_currency, rate_e8,
                                 recurring_id, period)
           VALUES (@groupId, 'x', @cents, @alex, @category, @spentAt, @cents, 'USD', 100000000,
                   @recurringId, @period)`
        )
        .run({
          groupId,
          cents,
          alex,
          category,
          spentAt,
          recurringId: extra.recurringId ?? null,
          period: extra.period ?? null,
        }).lastInsertRowid
    );

  const budget = (category, effectiveFrom, cents) =>
    db
      .prepare(
        `INSERT INTO budgets (group_id, category, amount_cents, effective_from)
         VALUES (?, ?, ?, ?)`
      )
      .run(groupId, category, cents, effectiveFrom);

  return { groupId, alex, sam, expense, budget };
}

const spendFor = (db, groupId, month) =>
  Object.fromEntries(
    db
      .prepare(SPEND_BY_CATEGORY_SQL)
      .all({ groupId, ...monthRange(month) })
      .map((r) => [r.category, r.spent_cents])
  );

const budgetsFor = (db, groupId, month) =>
  Object.fromEntries(
    db
      .prepare(BUDGETS_IN_EFFECT_SQL)
      .all({ groupId, month })
      .map((r) => [r.category, r])
  );

test('spend is bucketed by calendar date, both stored timestamp shapes', () => {
  const db = buildDatabase();
  const { groupId, expense } = seed(db);

  expense(1000, 'food', '2026-10-01');
  expense(2000, 'food', '2026-10-31 23:59:59'); // datetime('now') shape
  expense(4000, 'food', '2026-09-30');
  expense(8000, 'food', '2026-11-01 00:00:00');

  assert.deepEqual(spendFor(db, groupId, '2026-10'), { food: 3000 });
  db.close();
});

test('recurring postings count; plan interest and settlements do not', () => {
  const db = buildDatabase();
  const { groupId, alex, sam, expense } = seed(db);

  const recurringId = Number(
    db
      .prepare(
        `INSERT INTO recurring_expenses
           (group_id, description, amount_cents, currency, paid_by, anchor_day, start_date)
         VALUES (?, 'Rent', 150000, 'USD', ?, 1, '2026-01-01')`
      )
      .run(groupId, alex).lastInsertRowid
  );
  expense(150000, 'rent', '2026-10-01', { recurringId, period: '2026-10' });

  const interestId = expense(1234, 'general', '2026-10-15');
  const planId = Number(
    db
      .prepare(
        `INSERT INTO payment_plans
           (group_id, debtor_id, creditor_id, principal_cents, installments, anchor_day, start_date)
         VALUES (?, ?, ?, 60000, 6, 15, '2026-10-15')`
      )
      .run(groupId, sam, alex).lastInsertRowid
  );
  db.prepare(
    `INSERT INTO plan_installments
       (plan_id, number, due_date, period, payment_cents, principal_cents, interest_cents,
        balance_cents, interest_expense_id)
     VALUES (?, 1, '2026-10-15', '2026-10', 11234, 10000, 1234, 50000, ?)`
  ).run(planId, interestId);

  db.prepare(
    `INSERT INTO settlements (group_id, from_member_id, to_member_id, amount_cents, settled_at,
                              original_amount_cents, original_currency, rate_e8)
     VALUES (?, ?, ?, 10000, '2026-10-15', 10000, 'USD', 100000000)`
  ).run(groupId, sam, alex);

  assert.deepEqual(spendFor(db, groupId, '2026-10'), { rent: 150000 });
  db.close();
});

test('spend never leaks across groups', () => {
  const db = buildDatabase();
  const a = seed(db);
  const b = seed(db);
  a.expense(1000, 'food', '2026-10-05');
  b.expense(9000, 'food', '2026-10-05');
  assert.deepEqual(spendFor(db, a.groupId, '2026-10'), { food: 1000 });
  db.close();
});

test('the latest budget on or before the month is the one in effect', () => {
  const db = buildDatabase();
  const { groupId, budget } = seed(db);

  budget('food', '2026-03', 30000);
  budget('food', '2026-08', 40000);
  budget('food', '2026-12', 50000);

  assert.deepEqual(budgetsFor(db, groupId, '2026-02'), {}, 'nothing before the first row');
  assert.equal(budgetsFor(db, groupId, '2026-05').food.amount_cents, 30000);
  assert.equal(budgetsFor(db, groupId, '2026-08').food.amount_cents, 40000);
  assert.equal(budgetsFor(db, groupId, '2026-10').food.effective_from, '2026-08');
  assert.equal(budgetsFor(db, groupId, '2027-06').food.amount_cents, 50000);
  db.close();
});

test('a tombstone removes a budget from its month on, not before', () => {
  const db = buildDatabase();
  const { groupId, budget } = seed(db);

  budget('fun', '2026-01', 10000);
  budget('fun', '2026-06', null);
  budget('rent', '2026-01', 200000);

  assert.equal(budgetsFor(db, groupId, '2026-05').fun.amount_cents, 10000);
  assert.deepEqual(Object.keys(budgetsFor(db, groupId, '2026-06')), ['rent']);
  db.close();
});

test('the schema rejects duplicates, bad months, negatives, and cascades on delete', () => {
  const db = buildDatabase();
  const { groupId, budget } = seed(db);

  budget('food', '2026-10', 1000);
  assert.throws(() => budget('food', '2026-10', 2000), /UNIQUE/);
  assert.throws(() => budget('food', '2026-1', 2000), /CHECK/);
  assert.throws(() => budget('food', '2026-11', -1), /CHECK/);

  db.prepare('DELETE FROM groups WHERE id = ?').run(groupId);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM budgets').get().n, 0);
  db.close();
});
