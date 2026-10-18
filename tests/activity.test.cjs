const test = require('node:test');
const assert = require('node:assert/strict');

process.env.TALLY_NOW = '2026-10-18T14:03:22Z';
require('./harness.cjs');

const activity = require('../.test-build/activity.js');
const { listActivity } = require('../.test-build/activity-queries.js');
const q = require('../.test-build/queries.js');
const sq = require('../.test-build/scheduling-queries.js');
const { db } = require('../.test-build/db.js');

function setUp() {
  const groupId = q.createGroup({ name: 'Trip', currency: 'USD', memberNames: ['Ana', 'Ben', 'Cy'] });
  const [ana, ben, cy] = q.listMembers(groupId).map((m) => m.id);
  return { groupId, ana, ben, cy };
}

const dinner = (groupId, ana, ben, cy, actorId) => ({
  groupId,
  description: 'Dinner',
  amountCents: 12000,
  paidBy: ana,
  category: 'food',
  splitType: 'equal',
  spentAt: '2026-10-10',
  participants: [ana, ben, cy],
  actorId,
});

/* -------------------------------------------------------------- pure parts -- */

test('the clock is pinned by TALLY_NOW and otherwise real UTC to the second', () => {
  assert.equal(activity.activityNow(), '2026-10-18T14:03:22Z');
  const pinned = process.env.TALLY_NOW;
  delete process.env.TALLY_NOW;
  try {
    assert.match(activity.activityNow(), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  } finally {
    process.env.TALLY_NOW = pinned;
  }
});

test('the actor is the cookie member, else the lowest member id', () => {
  const members = [{ id: 7 }, { id: 3 }, { id: 12 }];
  assert.equal(activity.resolveActor(members, '12').id, 12);
  assert.equal(activity.resolveActor(members, undefined).id, 3);
  assert.equal(activity.resolveActor(members, '99').id, 3, 'not a member any more');
  assert.equal(activity.resolveActor(members, '12abc').id, 3);
  assert.equal(activity.resolveActor([], '1'), undefined);
  assert.equal(activity.actorCookieName(3), 'tally_actor_3');
});

test('summaries follow the fixed shapes', () => {
  assert.equal(activity.expenseCreatedSummary('Ana', 'Dinner', 12000, 'USD'), 'Ana added "Dinner" ($120.00)');
  assert.equal(
    activity.expenseEditedSummary('Ana', 'Dinner', ['amount', 'payer', 'split']),
    'Ana edited "Dinner" (amount, payer, split)'
  );
  assert.equal(activity.expenseDeletedSummary('Ana', 'Dinner', 9000, 'USD'), 'Ana deleted "Dinner" ($90.00)');
  assert.equal(
    activity.settlementSummary('settlement_created', 'Ana', 4000, 'USD', 'Ben', 'Cy'),
    'Ana recorded a payment of $40.00 from Ben to Cy'
  );
  assert.equal(
    activity.settlementSummary('settlement_deleted', null, 4000, 'USD', 'Ben', 'Cy'),
    'Tally deleted a payment of $40.00 from Ben to Cy'
  );
});

/* -------------------------------------------------------------- the log ---- */

test('create, edit and delete of an expense each write one entry', () => {
  const { groupId, ana, ben, cy } = setUp();
  const id = q.createExpense(dinner(groupId, ana, ben, cy, ben));

  q.updateExpense(id, {
    ...dinner(groupId, ana, ben, cy, ana),
    amountCents: 9000,
    paidBy: ben,
    splitType: 'percent',
    values: { [ana]: 5000, [ben]: 2500, [cy]: 2500 },
  });
  q.deleteExpense(id, cy);

  const entries = listActivity(groupId);
  assert.deepEqual(
    entries.map((e) => [e.kind, e.actor_id, e.actor_name, e.summary, e.amount_before, e.amount_after]),
    [
      ['expense_deleted', cy, 'Cy', 'Cy deleted "Dinner" ($90.00)', 9000, null],
      ['expense_edited', ana, 'Ana', 'Ana edited "Dinner" (amount, payer, split)', 12000, 9000],
      ['expense_created', ben, 'Ben', 'Ben added "Dinner" ($120.00)', null, 12000],
    ]
  );
  assert.ok(entries[0].id > entries[1].id && entries[1].id > entries[2].id, 'newest first by id');
  for (const e of entries) {
    assert.equal(e.occurred_at, '2026-10-18T14:03:22Z');
    assert.equal(e.expense_id, id);
  }

  // The snapshots carry the rows on each side, splits included.
  const edit = entries[1];
  const before = JSON.parse(edit.before_json);
  const after = JSON.parse(edit.after_json);
  assert.equal(before.expense.amount_cents, 12000);
  assert.equal(before.expense.split_type, 'equal');
  assert.deepEqual(after.splits.map((s) => [s.member_id, s.amount_cents, s.weight]), [
    [ana, 4500, 5000],
    [ben, 2250, 2500],
    [cy, 2250, 2500],
  ]);
  assert.equal(JSON.parse(entries[0].before_json).expense.id, id);
});

test('an edit names only what changed, in the fixed order, using the new description', () => {
  const { groupId, ana, ben, cy } = setUp();
  const id = q.createExpense(dinner(groupId, ana, ben, cy, ana));

  q.updateExpense(id, {
    ...dinner(groupId, ana, ben, cy, ana),
    description: 'Late dinner',
    spentAt: '2026-10-11',
    category: 'fun',
  });
  q.updateExpense(id, {
    ...dinner(groupId, ana, ben, cy, ana),
    description: 'Late dinner',
    spentAt: '2026-10-11',
    category: 'fun',
    participants: [ana, ben],
  });

  assert.deepEqual(
    listActivity(groupId, { kind: 'expense_edited' }).map((e) => e.summary),
    ['Ana edited "Late dinner" (split)', 'Ana edited "Late dinner" (description, date, category)']
  );
});

test('an edit that changes nothing, or is rejected, writes no entry', () => {
  const { groupId, ana, ben, cy } = setUp();
  const id = q.createExpense(dinner(groupId, ana, ben, cy, ana));
  const row = () => db.prepare('SELECT * FROM expenses WHERE id = ?').get(id);
  const before = row();

  assert.deepEqual(q.updateExpense(id, dinner(groupId, ana, ben, cy, ana)), {
    amountCents: 12000,
    detached: false,
  });
  // Same people in another order is the same split.
  q.updateExpense(id, { ...dinner(groupId, ana, ben, cy, ana), participants: [cy, ben, ana] });
  assert.throws(() =>
    q.updateExpense(id, {
      ...dinner(groupId, ana, ben, cy, ana),
      splitType: 'percent',
      values: { [ana]: 5000, [ben]: 2500, [cy]: 2000 },
    })
  );

  assert.deepEqual(row(), before);
  assert.deepEqual(listActivity(groupId).map((e) => e.kind), ['expense_created']);
});

test('recording and deleting a payment each write one entry', () => {
  const { groupId, ana, ben, cy } = setUp();
  const id = q.createSettlement({ groupId, fromMemberId: ben, toMemberId: cy, amountCents: 4000, actorId: ana });
  q.deleteSettlement(id, ana);

  assert.deepEqual(
    listActivity(groupId).map((e) => [e.kind, e.summary, e.amount_before, e.amount_after, e.settlement_id]),
    [
      ['settlement_deleted', 'Ana deleted a payment of $40.00 from Ben to Cy', 4000, null, id],
      ['settlement_created', 'Ana recorded a payment of $40.00 from Ben to Cy', null, 4000, id],
    ]
  );
});

test('amounts are the booked group-currency figure, never the foreign original', () => {
  const { groupId, ana, ben, cy } = setUp();
  const id = q.createExpense({ ...dinner(groupId, ana, ben, cy, ana), amountCents: 10000, currency: 'EUR' });
  const booked = db.prepare('SELECT amount_cents FROM expenses WHERE id = ?').get(id).amount_cents;
  assert.notEqual(booked, 10000);

  const [entry] = listActivity(groupId);
  assert.equal(entry.amount_after, booked);
  assert.equal(entry.summary, `Ana added "Dinner" (${require('../.test-build/money.js').formatCents(booked, 'USD')})`);
});

test('what Tally posts by itself is logged with no actor', () => {
  const { groupId, ana, ben } = setUp();
  sq.createRecurring({
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

  const entries = listActivity(groupId);
  assert.equal(entries.length, 2);
  for (const e of entries) {
    assert.equal(e.kind, 'expense_created');
    assert.equal(e.actor_id, null);
    assert.equal(e.summary, 'Tally added "Rent" ($1,000.00)');
  }
  assert.equal(listActivity(groupId, { actor: 'tally' }).length, 2);
  assert.equal(listActivity(groupId, { actor: ana }).length, 0);
});

test('a posted plan instalment logs its payment and its interest as Tally', () => {
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
    startDate: '2026-01-01',
  });
  sq.postDueItems(groupId);

  const entries = listActivity(groupId);
  assert.deepEqual(entries.map((e) => [e.kind, e.actor_id]).sort(), [
    ['expense_created', null],
    ['settlement_created', null],
  ]);
  const payment = entries.find((e) => e.kind === 'settlement_created');
  assert.match(payment.summary, /^Tally recorded a payment of \$[\d,]+\.\d{2} from Ben to Ana$/);
  assert.match(entries.find((e) => e.kind === 'expense_created').summary, /^Tally added "Interest/);
});

test('filters by person and kind, and deleting the group removes its entries', () => {
  const { groupId, ana, ben, cy } = setUp();
  q.createExpense(dinner(groupId, ana, ben, cy, ana));
  q.createSettlement({ groupId, fromMemberId: ben, toMemberId: ana, amountCents: 4000, actorId: ben });

  assert.deepEqual(listActivity(groupId, { actor: ben }).map((e) => e.kind), ['settlement_created']);
  assert.deepEqual(listActivity(groupId, { kind: 'expense_created' }).map((e) => e.actor_id), [ana]);
  assert.deepEqual(
    activity.activityFiltersFrom({ activity_actor: 'tally', activity_kind: 'bogus' }),
    { actor: 'tally', kind: undefined }
  );

  q.deleteGroup(groupId);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM activity WHERE group_id = ?').get(groupId).n, 0);
});

test('since takes a bare date (start of the UTC day) or a UTC timestamp, nothing else', () => {
  assert.equal(activity.parseSince('2026-10-01'), '2026-10-01T00:00:00Z');
  assert.equal(activity.parseSince('2026-10-18T14:03:22Z'), '2026-10-18T14:03:22Z');
  assert.equal(activity.parseSince('2026-10-18T14:03:22.000Z'), '2026-10-18T14:03:22Z');
  assert.equal(activity.parseSince('2026-10-18T14:03:22.5Z'), '2026-10-18T14:03:23Z');
  for (const bad of ['yesterday', '2026-02-30', '2026-10-18T14:03:22', '2026-10-18T25:00:00Z', '2026-10-18 14:03:22Z', '']) {
    assert.equal(activity.parseSince(bad), null, bad);
  }
});

test('the API filters reject anything malformed with the documented messages', () => {
  const parse = (qs) => activity.parseActivityParams(new URLSearchParams(qs));
  assert.deepEqual(parse('kind=expense_edited&since=2026-10-01&actor=12'), {
    filters: { kind: 'expense_edited', since: '2026-10-01T00:00:00Z', actor: 12 },
  });
  assert.deepEqual(parse('actor=tally'), { filters: { actor: 'tally' } });
  assert.deepEqual(parse('kind=edited'), {
    error:
      'kind must be one of: expense_created, expense_edited, expense_deleted, expense_restored, expense_reverted, settlement_created, settlement_deleted (got "edited").',
  });
  assert.deepEqual(parse('since=yesterday'), {
    error: 'since must be an ISO date or UTC timestamp (got "yesterday").',
  });
  assert.deepEqual(parse('actor=bob'), { error: 'actor must be a member id or tally (got "bob").' });
});

test('since keeps entries at or after the instant', () => {
  const { groupId, ana, ben, cy } = setUp();
  process.env.TALLY_NOW = '2026-10-17T23:59:59Z';
  q.createExpense(dinner(groupId, ana, ben, cy, ana));
  process.env.TALLY_NOW = '2026-10-18T14:03:22Z';
  q.createExpense({ ...dinner(groupId, ana, ben, cy, ben), description: 'Lunch' });

  const since = (v) => listActivity(groupId, { since: activity.parseSince(v) }).map((e) => e.actor_name);
  assert.deepEqual(since('2026-10-18'), ['Ben']);
  assert.deepEqual(since('2026-10-17'), ['Ben', 'Ana']);
  assert.deepEqual(since('2026-10-18T14:03:22Z'), ['Ben'], 'at counts');
  assert.deepEqual(since('2026-10-18T14:03:23Z'), []);
});

/* ------------------------------------------------------------- API and CSV -- */

test('entries come back newest first by id when their timestamps are equal', () => {
  const { groupId, ana, ben, cy } = setUp();
  for (const description of ['One', 'Two', 'Three']) {
    q.createExpense({ ...dinner(groupId, ana, ben, cy, ana), description });
  }
  const entries = listActivity(groupId);
  assert.equal(new Set(entries.map((e) => e.occurred_at)).size, 1);
  assert.deepEqual(entries.map((e) => e.summary.match(/"(\w+)"/)[1]), ['Three', 'Two', 'One']);
});

test('the JSON entry carries the documented fields and no snapshots', () => {
  const { groupId, ana, ben, cy } = setUp();
  const id = q.createExpense(dinner(groupId, ana, ben, cy, ana));
  q.updateExpense(id, { ...dinner(groupId, ana, ben, cy, ben), amountCents: 9000 });
  const [edit, create] = listActivity(groupId);

  assert.deepEqual(activity.activityJson(edit, true), {
    id: edit.id,
    kind: 'expense_edited',
    at: '2026-10-18T14:03:22Z',
    actor: { id: ben, name: 'Ben' },
    summary: 'Ben edited "Dinner" (amount)',
    amount_before: 12000,
    amount_after: 9000,
    expense_id: id,
    settlement_id: null,
    undoable: true,
    undone_by: null,
  });
  sq.createRecurring({
    groupId,
    description: 'Rent',
    amountCents: 100000,
    currency: 'USD',
    paidBy: ana,
    category: 'rent',
    splitType: 'equal',
    anchorDay: 1,
    intervalMonths: 1,
    startDate: '2026-10-01',
    participants: [ana, ben],
  });
  sq.postDueItems(groupId);
  assert.equal(activity.activityJson(listActivity(groupId)[0], false).actor, null, 'Tally');
  assert.equal(activity.activityJson(create, false).amount_before, null);
});

test('the activity CSV: header, BOM, CRLF, minor units as decimals, and the formula guard', () => {
  const { toCsv } = require('../.test-build/csv.js');
  const groupId = q.createGroup({
    name: 'Guarded',
    currency: 'USD',
    memberNames: ['=HYPERLINK("http://x")', 'Ben'],
  });
  const [evil, ben] = q.listMembers(groupId).map((m) => m.id);
  const base = {
    groupId,
    description: '+1 for Ben',
    amountCents: 12000,
    paidBy: ben,
    splitType: 'equal',
    participants: [evil, ben],
  };
  q.createExpense({ ...base, actorId: ben });
  q.createExpense({ ...base, actorId: evil });

  const csv = toCsv(...Object.values(activity.activityCsvTable(listActivity(groupId), 'USD')));
  assert.ok(csv.startsWith('﻿'), 'BOM');
  const lines = csv.slice(1).split('\r\n');
  assert.equal(lines.pop(), '', 'every line ends in CRLF');
  assert.ok(!lines.some((l) => l.includes('\n')), 'no bare LF');
  assert.equal(
    lines[0],
    'id,at,kind,actor,summary,amount_before,amount_after,currency,expense_id,settlement_id,undone_by'
  );

  const [evilRow, benRow] = lines.slice(1);
  assert.match(evilRow, /^\d+,2026-10-18T14:03:22Z,expense_created,"'=HYPERLINK\(""http:\/\/x""\)",/);
  assert.ok(evilRow.includes(`"'=HYPERLINK(""http://x"") added ""+1 for Ben"" ($120.00)"`), 'summary guarded too');
  assert.match(benRow, /,Ben,"Ben added ""\+1 for Ben"" \(\$120\.00\)",,120\.00,USD,\d+,,$/);
});
