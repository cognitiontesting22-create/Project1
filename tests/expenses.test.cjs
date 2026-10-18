const test = require('node:test');
const assert = require('node:assert/strict');

require('./harness.cjs');

const q = require('../.test-build/queries.js');
const { expenseFieldsFromForm, expenseInputFrom } = require('../.test-build/expense-input.js');
const { db } = require('../.test-build/db.js');

function setUp() {
  const groupId = q.createGroup({ name: 'Trip', currency: 'USD', memberNames: ['Ana', 'Ben', 'Cy'] });
  const [ana, ben, cy] = q.listMembers(groupId).map((m) => m.id);
  const expenseId = q.createExpense({
    groupId,
    description: 'Dinner',
    amountCents: 12000,
    paidBy: ana,
    category: 'food',
    splitType: 'equal',
    spentAt: '2026-10-10',
    participants: [ana, ben, cy],
  });
  return { groupId, ana, ben, cy, expenseId };
}

/** Saves through the same steps updateExpenseAction takes. */
function submitEdit(groupId, expenseId, fields) {
  const form = new FormData();
  form.set('groupId', String(groupId));
  form.set('expenseId', String(expenseId));
  for (const [key, value] of Object.entries(fields)) {
    for (const v of [].concat(value)) form.append(key, String(v));
  }
  const parsed = expenseInputFrom(groupId, q.getGroup(groupId), expenseFieldsFromForm(form));
  if ('error' in parsed) throw new Error(parsed.error);
  return q.updateExpense(expenseId, parsed.input);
}

function snapshot(groupId) {
  return { expenses: q.listExpenses(groupId), balances: q.getBalances(groupId) };
}

const net = (groupId) => Object.fromEntries(q.getBalances(groupId).map((b) => [b.name, b.net_cents]));

test('editing an expense rewrites it in place and balances follow', () => {
  const { groupId, ana, ben, cy, expenseId } = setUp();
  const before = q.getExpense(groupId, expenseId);
  assert.deepEqual(net(groupId), { Ana: 8000, Ben: -4000, Cy: -4000 });

  const booked = submitEdit(groupId, expenseId, {
    description: 'Dinner',
    amount: '90.00',
    paidBy: ben,
    spentAt: '2026-10-10',
    category: 'food',
    splitType: 'percent',
    participants: [ana, ben, cy],
    [`value_${ana}`]: '50',
    [`value_${ben}`]: '25',
    [`value_${cy}`]: '25',
  });
  assert.deepEqual(booked, { amountCents: 9000, detached: false });

  const [after] = q.listExpenses(groupId);
  assert.equal(after.id, expenseId);
  assert.equal(after.created_at, before.created_at);
  assert.equal(after.amount_cents, 9000);
  assert.equal(after.paid_by, ben);
  assert.equal(after.split_type, 'percent');
  assert.deepEqual(
    after.splits.map((s) => [s.member_id, s.amount_cents, s.weight]),
    [
      [ana, 4500, 5000],
      [ben, 2250, 2500],
      [cy, 2250, 2500],
    ]
  );

  assert.deepEqual(net(groupId), { Ana: -4500, Ben: 6750, Cy: -2250 });
  assert.equal(
    q.getBalances(groupId).reduce((sum, b) => sum + b.net_cents, 0),
    0
  );
});

test('every field can change, including the people in the split and the currency', () => {
  const { groupId, ana, ben, expenseId } = setUp();

  submitEdit(groupId, expenseId, {
    description: 'Hotel',
    amount: '100.00',
    currency: 'EUR',
    paidBy: ben,
    spentAt: '2026-09-30',
    category: 'travel',
    splitType: 'shares',
    participants: [ana, ben],
    [`value_${ana}`]: '1.5',
    [`value_${ben}`]: '1',
  });

  const [e] = q.listExpenses(groupId);
  assert.equal(e.description, 'Hotel');
  assert.equal(e.category, 'travel');
  assert.equal(e.spent_at, '2026-09-30');
  assert.equal(e.original_currency, 'EUR');
  assert.equal(e.original_amount_cents, 10000);
  assert.notEqual(e.amount_cents, 10000, 'booked in the group currency, not the typed one');
  assert.deepEqual(e.splits.map((s) => [s.member_id, s.weight]), [
    [ana, 150],
    [ben, 100],
  ]);
  assert.equal(
    e.splits.reduce((sum, s) => sum + s.amount_cents, 0),
    e.amount_cents
  );
});

test('a rejected edit says what create says and writes nothing', () => {
  const { groupId, ana, ben, cy, expenseId } = setUp();
  const before = snapshot(groupId);
  const base = { description: 'Dinner', amount: '90.00', paidBy: ben, participants: [ana, ben, cy] };

  assert.throws(
    () =>
      submitEdit(groupId, expenseId, {
        ...base,
        splitType: 'exact',
        [`value_${ana}`]: '45',
        [`value_${ben}`]: '20',
        [`value_${cy}`]: '20',
      }),
    { message: '$5.00 is still unassigned — the amounts have to add up to $90.00.' }
  );
  assert.throws(
    () =>
      submitEdit(groupId, expenseId, {
        ...base,
        splitType: 'percent',
        [`value_${ana}`]: '50',
        [`value_${ben}`]: '25',
        [`value_${cy}`]: '20',
      }),
    { message: 'The percentages add up to 95% — 5% short of 100%.' }
  );
  assert.throws(() => submitEdit(groupId, expenseId, { ...base, description: ' ', splitType: 'equal' }), {
    message: 'What was this expense for?',
  });

  assert.deepEqual(snapshot(groupId), before);

  // Create rejects the same input with the same words.
  assert.throws(
    () =>
      q.createExpense({
        groupId,
        description: 'Dinner',
        amountCents: 9000,
        paidBy: ben,
        splitType: 'exact',
        participants: [ana, ben, cy],
        values: { [ana]: 4500, [ben]: 2000, [cy]: 2000 },
      }),
    { message: '$5.00 is still unassigned — the amounts have to add up to $90.00.' }
  );
});

test('an expense from another group, or someone outside the group, is refused untouched', () => {
  const first = setUp();
  const second = setUp();
  const before = snapshot(second.groupId);

  const input = {
    groupId: first.groupId,
    description: 'Taxi',
    amountCents: 500,
    paidBy: first.ana,
    splitType: 'equal',
    participants: [first.ana],
  };
  assert.throws(() => q.updateExpense(second.expenseId, input), { message: 'Unknown expense.' });
  assert.throws(
    () =>
      q.updateExpense(second.expenseId, {
        ...input,
        groupId: second.groupId,
        participants: [second.ana, first.ben],
      }),
    { message: 'Someone in this split is not a member of this group.' }
  );

  assert.deepEqual(snapshot(second.groupId), before);
});

test('editing every field in each of the four split modes keeps the id and created_at and sums to the booked total', () => {
  const groupId = q.createGroup({ name: 'Modes', currency: 'USD', memberNames: ['Ana', 'Ben', 'Cy', 'Di'] });
  const [ana, ben, cy, di] = q.listMembers(groupId).map((m) => m.id);
  const modes = {
    equal: {},
    exact: { [ben]: 6001, [cy]: 3333, [di]: 667 },
    percent: { [ben]: 3333, [cy]: 3333, [di]: 3334 },
    shares: { [ben]: 150, [cy]: 100, [di]: 25 },
  };

  for (const [splitType, values] of Object.entries(modes)) {
    const id = q.createExpense({
      groupId,
      description: 'Before',
      amountCents: 5000,
      paidBy: ana,
      category: 'food',
      splitType: 'equal',
      spentAt: '2026-10-01',
      participants: [ana, ben],
    });
    const before = q.getExpense(groupId, id);

    q.updateExpense(id, {
      groupId,
      description: `After (${splitType})`,
      amountCents: 10001,
      currency: 'EUR',
      paidBy: di,
      category: 'travel',
      splitType,
      spentAt: '2026-10-09',
      participants: [ben, cy, di],
      values,
    });

    const [after] = q.listExpenses(groupId).filter((e) => e.id === id);
    assert.equal(after.id, id, splitType);
    assert.equal(after.created_at, before.created_at, splitType);
    assert.deepEqual(
      [after.description, after.paid_by, after.category, after.split_type, after.spent_at],
      [`After (${splitType})`, di, 'travel', splitType, '2026-10-09'],
      splitType
    );
    assert.deepEqual([after.original_amount_cents, after.original_currency], [10001, 'EUR'], splitType);
    assert.deepEqual(after.splits.map((s) => s.member_id), [ben, cy, di], splitType);
    assert.equal(
      after.splits.reduce((sum, s) => sum + s.amount_cents, 0),
      after.amount_cents,
      `${splitType} splits sum to the booked total`
    );
    if (splitType === 'percent' || splitType === 'shares') {
      assert.deepEqual(after.splits.map((s) => s.weight), [values[ben], values[cy], values[di]], splitType);
    }
  }
});

test('a failed validation throws the create message and leaves the rows byte for byte unchanged', () => {
  const { groupId, ana, ben, cy, expenseId } = setUp();
  const outsider = q.listMembers(setUp().groupId)[0].id;
  const rows = () => ({
    expense: db.prepare('SELECT * FROM expenses WHERE id = ?').get(expenseId),
    splits: db.prepare('SELECT * FROM expense_splits WHERE expense_id = ? ORDER BY id').all(expenseId),
    log: db.prepare('SELECT * FROM activity WHERE group_id = ? ORDER BY id').all(groupId),
  });
  const before = rows();
  const base = { groupId, description: 'Dinner', amountCents: 9000, paidBy: ben };

  const cases = [
    {
      name: 'exact amounts short of the total',
      input: { ...base, splitType: 'exact', participants: [ana, ben, cy], values: { [ana]: 4500, [ben]: 2000, [cy]: 2000 } },
      message: '$5.00 is still unassigned — the amounts have to add up to $90.00.',
    },
    {
      name: 'percentages short of 100',
      input: { ...base, splitType: 'percent', participants: [ana, ben, cy], values: { [ana]: 5000, [ben]: 2500, [cy]: 2000 } },
      message: 'The percentages add up to 95% — 5% short of 100%.',
    },
    {
      name: 'a participant from another group',
      input: { ...base, splitType: 'equal', participants: [ana, outsider] },
      message: 'Someone in this split is not a member of this group.',
    },
  ];

  for (const c of cases) {
    assert.throws(() => q.updateExpense(expenseId, c.input), { message: c.message }, c.name);
    assert.throws(() => q.createExpense(c.input), { message: c.message }, `create: ${c.name}`);
    assert.deepEqual(rows(), before, c.name);
  }
});
