/**
 * How edits interact with budgets, recurring schedules, payment plans and
 * stored exchange rates.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.TALLY_NOW = '2026-10-18T14:03:22Z';
require('./harness.cjs');

const { listActivity } = require('../.test-build/activity-queries.js');
const { getBudgetReport, setBudget } = require('../.test-build/budget-queries.js');
const q = require('../.test-build/queries.js');
const sq = require('../.test-build/scheduling-queries.js');
const { undoActivity } = require('../.test-build/undo.js');
const { db } = require('../.test-build/db.js');

function setUp(currency = 'USD') {
  const groupId = q.createGroup({ name: 'Trip', currency, memberNames: ['Ana', 'Ben'] });
  const [ana, ben] = q.listMembers(groupId).map((m) => m.id);
  return { groupId, ana, ben };
}

const lastEntry = (groupId, kind) => listActivity(groupId, { kind })[0];

/** What the budgets route reports for a category in a month. */
function spent(groupId, month, category) {
  const report = getBudgetReport(groupId, month);
  const row = [...report.lines, ...report.unbudgeted].find((l) => l.category === category);
  return row ? row.spent_cents : 0;
}

const expenseRow = (id) => db.prepare('SELECT * FROM expenses WHERE id = ?').get(id);

/* ---------------------------------------------------------------- budgets -- */

test('an edit moves spend between months and categories, and its undo moves it back', () => {
  const { groupId, ana, ben } = setUp();
  for (const month of ['2026-09', '2026-10']) {
    setBudget(groupId, 'food', month, 50000);
    setBudget(groupId, 'travel', month, 50000);
  }
  const groceries = {
    groupId,
    description: 'Groceries',
    amountCents: 6000,
    paidBy: ana,
    category: 'food',
    splitType: 'equal',
    spentAt: '2026-09-28',
    participants: [ana, ben],
    actorId: ana,
  };
  const id = q.createExpense(groceries);
  const before = {
    sepFood: spent(groupId, '2026-09', 'food'),
    octTravel: spent(groupId, '2026-10', 'travel'),
    octFood: spent(groupId, '2026-10', 'food'),
    sep: getBudgetReport(groupId, '2026-09'),
    oct: getBudgetReport(groupId, '2026-10'),
  };

  q.updateExpense(id, { ...groceries, spentAt: '2026-10-02', category: 'travel' });
  assert.equal(spent(groupId, '2026-09', 'food'), before.sepFood - 6000);
  assert.equal(spent(groupId, '2026-10', 'travel'), before.octTravel + 6000);
  assert.equal(spent(groupId, '2026-10', 'food'), before.octFood);
  assert.equal(
    lastEntry(groupId, 'expense_edited').summary,
    'Ana edited "Groceries" (date, category)'
  );

  undoActivity(groupId, lastEntry(groupId, 'expense_edited').id, ana);
  assert.deepEqual(getBudgetReport(groupId, '2026-09'), before.sep);
  assert.deepEqual(getBudgetReport(groupId, '2026-10'), before.oct);

  // A restored delete counts in its month and category again.
  q.deleteExpense(id, ana);
  assert.equal(spent(groupId, '2026-09', 'food'), before.sepFood - 6000);
  undoActivity(groupId, lastEntry(groupId, 'expense_deleted').id, ana);
  assert.deepEqual(getBudgetReport(groupId, '2026-09'), before.sep);
});

/* -------------------------------------------------------------- recurring -- */

function rentSchedule(groupId, ana, ben) {
  return sq.createRecurring({
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
    endDate: '2026-04-30',
    participants: [ana, ben],
  });
}

const rentsFor = (groupId, period) =>
  db
    .prepare("SELECT * FROM expenses WHERE group_id = ? AND description = 'Rent' AND spent_at LIKE ?")
    .all(groupId, `${period}%`);

test('editing a recurring posting detaches it, and the schedule never posts that month again', () => {
  const { groupId, ana, ben } = setUp();
  const scheduleId = rentSchedule(groupId, ana, ben);
  sq.postDueItems(groupId);
  const [feb] = rentsFor(groupId, '2026-02');
  assert.equal(feb.recurring_id, scheduleId);
  const original = expenseRow(feb.id);

  const result = q.updateExpense(feb.id, {
    groupId,
    description: 'Rent',
    amountCents: 110000,
    paidBy: ana,
    category: 'rent',
    splitType: 'equal',
    spentAt: '2026-02-01',
    participants: [ana, ben],
    actorId: ana,
  });
  assert.deepEqual(result, { amountCents: 110000, detached: true });
  assert.equal(
    lastEntry(groupId, 'expense_edited').summary,
    'Ana edited "Rent" (amount) and detached it from its recurring schedule'
  );
  assert.equal(q.listExpenses(groupId).find((e) => e.id === feb.id).source, 'manual');
  assert.deepEqual([expenseRow(feb.id).recurring_id, expenseRow(feb.id).period], [null, null]);

  // Not on the next load, and not even once the one-off is gone.
  sq.postDueItems(groupId);
  assert.equal(rentsFor(groupId, '2026-02').length, 1);
  for (const period of ['2026-01', '2026-03', '2026-04']) {
    assert.equal(rentsFor(groupId, period).length, 1, `${period} still posts`);
    assert.equal(rentsFor(groupId, period)[0].recurring_id, scheduleId);
  }

  // Undo restores the old values and the link.
  undoActivity(groupId, lastEntry(groupId, 'expense_edited').id, ana);
  assert.deepEqual(expenseRow(feb.id), original);
  assert.equal(q.listExpenses(groupId).find((e) => e.id === feb.id).source, 'recurring');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM recurring_detached').get().n, 0);
  sq.postDueItems(groupId);
  assert.equal(rentsFor(groupId, '2026-02').length, 1);
});

test('a detached month stays claimed even when the one-off is deleted', () => {
  const { groupId, ana, ben } = setUp();
  rentSchedule(groupId, ana, ben);
  sq.postDueItems(groupId);
  const [march] = rentsFor(groupId, '2026-03');
  q.updateExpense(march.id, {
    groupId,
    description: 'Rent (split differently)',
    amountCents: 100000,
    paidBy: ana,
    category: 'rent',
    splitType: 'exact',
    spentAt: '2026-03-01',
    participants: [ana, ben],
    values: { [ana]: 70000, [ben]: 30000 },
  });
  q.deleteExpense(march.id, ana);
  sq.postDueItems(groupId);
  assert.equal(rentsFor(groupId, '2026-03').length, 0);
});

test('deleting a recurring posting behaves as before: the schedule posts it again', () => {
  const { groupId, ana, ben } = setUp();
  rentSchedule(groupId, ana, ben);
  sq.postDueItems(groupId);
  const [jan] = rentsFor(groupId, '2026-01');
  q.deleteExpense(jan.id, ana);
  sq.postDueItems(groupId);
  assert.equal(rentsFor(groupId, '2026-01').length, 1);
  assert.notEqual(rentsFor(groupId, '2026-01')[0].id, jan.id);
});

test('an edit that changes nothing on a recurring posting does not detach it', () => {
  const { groupId, ana, ben } = setUp();
  rentSchedule(groupId, ana, ben);
  sq.postDueItems(groupId);
  const [apr] = rentsFor(groupId, '2026-04');
  const result = q.updateExpense(apr.id, {
    groupId,
    description: 'Rent',
    amountCents: 100000,
    paidBy: ana,
    category: 'rent',
    splitType: 'equal',
    spentAt: '2026-04-01',
    participants: [ana, ben],
  });
  assert.deepEqual(result, { amountCents: 100000, detached: false });
  assert.equal(expenseRow(apr.id).recurring_id, apr.recurring_id);
});

/* ------------------------------------------------------------ payment plans -- */

test('plan interest is logged as Tally but cannot be edited, and a refusal writes nothing', () => {
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
  const interest = q.listExpenses(groupId).find((e) => e.source === 'plan');
  assert.ok(interest);
  assert.equal(q.expenseSource(interest.id), 'plan');
  assert.deepEqual(
    listActivity(groupId).map((e) => [e.kind, e.actor_id]).sort(),
    [
      ['expense_created', null],
      ['settlement_created', null],
    ]
  );

  const before = { row: expenseRow(interest.id), log: listActivity(groupId) };
  assert.throws(
    () =>
      q.updateExpense(interest.id, {
        groupId,
        description: 'Cheaper interest',
        amountCents: 1,
        paidBy: ana,
        splitType: 'exact',
        participants: [ben],
        values: { [ben]: 1 },
        actorId: ana,
      }),
    (err) => err instanceof q.ExpenseLocked && err.message === "Payment plan instalments can't be edited."
  );
  assert.deepEqual({ row: expenseRow(interest.id), log: listActivity(groupId) }, before);
});

/* ---------------------------------------------------------------- currency -- */

test('a same-currency edit converts at the stored rate, never today\'s', () => {
  const { groupId, ana, ben } = setUp();
  q.upsertRate('EUR', 92000000);
  const hotel = {
    groupId,
    description: 'Hotel',
    amountCents: 10000,
    currency: 'EUR',
    paidBy: ana,
    category: 'travel',
    splitType: 'equal',
    spentAt: '2026-10-05',
    participants: [ana, ben],
    actorId: ana,
  };
  const id = q.createExpense(hotel);
  assert.deepEqual([expenseRow(id).amount_cents, expenseRow(id).rate_e8], [10870, 108695652]);

  q.upsertRate('EUR', 80000000); // someone edits the rates page

  // Only the description and category change: the booked figure doesn't move.
  q.updateExpense(id, { ...hotel, description: 'Hotel (2 nights)', category: 'general' });
  assert.deepEqual([expenseRow(id).amount_cents, expenseRow(id).rate_e8], [10870, 108695652]);

  // A new amount, same currency: at the stored rate, $217.39 rather than $250.00.
  const result = q.updateExpense(id, { ...hotel, amountCents: 20000 });
  assert.equal(result.amountCents, 21739);
  const row = expenseRow(id);
  assert.deepEqual([row.amount_cents, row.rate_e8, row.original_amount_cents, row.original_currency], [
    21739,
    108695652,
    20000,
    'EUR',
  ]);
  const splits = db.prepare('SELECT amount_cents FROM expense_splits WHERE expense_id = ?').all(id);
  assert.equal(
    splits.reduce((sum, s) => sum + s.amount_cents, 0),
    21739,
    'splits allocated over the converted total'
  );
  assert.equal(
    lastEntry(groupId, 'expense_edited').summary,
    'Ana edited "Hotel" (description, amount, category)'
  );
  assert.deepEqual(
    [lastEntry(groupId, 'expense_edited').amount_before, lastEntry(groupId, 'expense_edited').amount_after],
    [10870, 21739]
  );

  // Changing the currency converts fresh from today's table, like a new expense.
  q.updateExpense(id, { ...hotel, amountCents: 20000, currency: 'GBP' });
  const fresh = expenseRow(id);
  const gbp = q.getRateE8('GBP');
  const { convertMinorUnits, effectiveRateE8 } = require('../.test-build/currency.js');
  assert.equal(fresh.amount_cents, convertMinorUnits(20000, gbp, 100000000));
  assert.equal(fresh.rate_e8, effectiveRateE8(gbp, 100000000));
  assert.equal(fresh.original_currency, 'GBP');
});

test('the stored-rate conversion rounds half away from zero, as lib/currency.ts does', () => {
  const { applyRateE8 } = require('../.test-build/currency.js');
  assert.equal(applyRateE8(10000, 108695652), 10870); // 10869.5652
  assert.equal(applyRateE8(20000, 108695652), 21739); // 21739.1304
  assert.equal(applyRateE8(1, 150000000), 2); // 1.5 rounds up
  assert.equal(applyRateE8(12345, 100000000), 12345);
  assert.equal(applyRateE8(9_000_000_000, 1_234_567_891), 111111110190);
});
