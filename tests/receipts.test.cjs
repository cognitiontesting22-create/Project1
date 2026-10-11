const test = require('node:test');
const assert = require('node:assert/strict');
const { allocateReceipt, receiptTotal, tipFromPercent } = require('../.test-build/receipts.js');

/** Shorthand: an item costing `cents`, had by `members`. */
const item = (id, cents, members, description = `item ${id}`) => ({
  id,
  description,
  amountCents: cents,
  memberIds: members,
});

const sum = (ns) => ns.reduce((a, b) => a + b, 0);
const totalOf = (alloc) => sum(alloc.members.map((m) => m.total_cents));

test('divides each item between only the people who had it', () => {
  const alloc = allocateReceipt({
    items: [item('steak', 3200, [1]), item('soup', 900, [2]), item('wine', 4800, [1, 2])],
    taxCents: 0,
    tipCents: 0,
  });

  const byId = Object.fromEntries(alloc.members.map((m) => [m.member_id, m]));
  assert.equal(byId[1].items_cents, 3200 + 2400, 'steak plus half the wine');
  assert.equal(byId[2].items_cents, 900 + 2400, 'soup plus half the wine');
  assert.equal(totalOf(alloc), 8900);
});

test("spreads tax and tip in proportion to each person's items", () => {
  // Subtotals 7500 / 2500 — a clean 3:1 split, so the proportion is checkable
  // by hand: tax 1000 -> 750/250, tip 2000 -> 1500/500.
  const alloc = allocateReceipt({
    items: [item('a', 7500, [1]), item('b', 2500, [2])],
    taxCents: 1000,
    tipCents: 2000,
  });

  const byId = Object.fromEntries(alloc.members.map((m) => [m.member_id, m]));
  assert.equal(byId[1].tax_cents, 750);
  assert.equal(byId[2].tax_cents, 250);
  assert.equal(byId[1].tip_cents, 1500);
  assert.equal(byId[2].tip_cents, 500);
  assert.equal(byId[1].total_cents, 7500 + 750 + 1500);
  assert.equal(byId[2].total_cents, 2500 + 250 + 500);
});

test('someone who ordered nothing pays no tax or tip', () => {
  const alloc = allocateReceipt({
    items: [item('a', 5000, [1]), item('b', 5000, [2])],
    taxCents: 800,
    tipCents: 1200,
  });
  // Member 3 never appears on an item, so never appears in the allocation.
  assert.deepEqual(
    alloc.members.map((m) => m.member_id).sort(),
    [1, 2]
  );
});

test('shares add up to the bill exactly when the split is not clean', () => {
  // 10.00 across 3 people, tax and tip that do not divide evenly either.
  const alloc = allocateReceipt({
    items: [item('shared', 1000, [1, 2, 3])],
    taxCents: 100,
    tipCents: 1,
  });

  assert.equal(totalOf(alloc), 1101, 'no cent is created or lost');
  assert.equal(sum(alloc.members.map((m) => m.items_cents)), 1000);
  assert.equal(sum(alloc.members.map((m) => m.tax_cents)), 100);
  assert.equal(sum(alloc.members.map((m) => m.tip_cents)), 1);
  // The single leftover tip cent lands on exactly one person.
  assert.deepEqual(alloc.members.map((m) => m.tip_cents).sort(), [0, 0, 1]);
});

test('item shares always reconcile to the item amount', () => {
  const alloc = allocateReceipt({
    items: [item('x', 1000, [1, 2, 3]), item('y', 7, [1, 2]), item('z', 1, [1, 2, 3])],
    taxCents: 0,
    tipCents: 0,
  });

  for (const id of ['x', 'y', 'z']) {
    const shares = alloc.itemShares.filter((s) => s.item_id === id);
    const expected = { x: 1000, y: 7, z: 1 }[id];
    assert.equal(sum(shares.map((s) => s.amount_cents)), expected, `item ${id} reconciles`);
  }
});

test('a one-cent item assigned to three people still reconciles', () => {
  const alloc = allocateReceipt({ items: [item('tiny', 1, [1, 2, 3])], taxCents: 0, tipCents: 0 });
  assert.equal(totalOf(alloc), 1);
  assert.deepEqual(alloc.members.map((m) => m.items_cents).sort(), [0, 0, 1]);
});

test('zero tax and zero tip are fine', () => {
  const alloc = allocateReceipt({ items: [item('a', 1234, [1, 2])], taxCents: 0, tipCents: 0 });
  assert.equal(totalOf(alloc), 1234);
  assert.ok(alloc.members.every((m) => m.tax_cents === 0 && m.tip_cents === 0));
});

test('allocation is deterministic regardless of how members are ordered', () => {
  const a = allocateReceipt({ items: [item('x', 1000, [3, 1, 2])], taxCents: 100, tipCents: 7 });
  const b = allocateReceipt({ items: [item('x', 1000, [3, 1, 2])], taxCents: 100, tipCents: 7 });
  assert.deepEqual(a.members, b.members);
});

test('rejects an item nobody is assigned to', () => {
  assert.throws(
    () => allocateReceipt({ items: [item('orphan', 500, [], 'Bottle of wine')], taxCents: 0, tipCents: 0 }),
    /Assign "Bottle of wine" to at least one person/
  );
});

test('rejects duplicate assignment, negative money, and empty receipts', () => {
  assert.throws(
    () => allocateReceipt({ items: [item('x', 500, [1, 1])], taxCents: 0, tipCents: 0 }),
    /same person twice/
  );
  assert.throws(
    () => allocateReceipt({ items: [item('x', 500, [1])], taxCents: -1, tipCents: 0 }),
    /Tax can't be negative/
  );
  assert.throws(
    () => allocateReceipt({ items: [item('x', -500, [1])], taxCents: 0, tipCents: 0 }),
    /can't be negative/
  );
  assert.throws(
    () => allocateReceipt({ items: [], taxCents: 100, tipCents: 0 }),
    /at least one item/
  );
  assert.throws(
    () => allocateReceipt({ items: [item('x', 10.5, [1])], taxCents: 0, tipCents: 0 }),
    /whole number of cents/
  );
});

test('receiptTotal matches what the allocation reconciles to', () => {
  const input = {
    items: [item('a', 1999, [1]), item('b', 450, [2, 3])],
    taxCents: 211,
    tipCents: 500,
  };
  assert.equal(receiptTotal(input), 1999 + 450 + 211 + 500);
  assert.equal(totalOf(allocateReceipt(input)), receiptTotal(input));
});

test('tip percentage is taken on the pre-tax subtotal', () => {
  assert.equal(tipFromPercent(10000, 1800), 1800, '18% of $100.00');
  assert.equal(tipFromPercent(3333, 2000), 667, 'rounds to the nearest cent');
  assert.equal(tipFromPercent(0, 2000), 0);
});

test('exhaustive: every shape reconciles to the penny', () => {
  const amounts = [1, 2, 3, 7, 99, 100, 1234, 99999];
  const parties = [[1], [1, 2], [1, 2, 3], [1, 2, 3, 4, 5], [1, 2, 3, 4, 5, 6, 7]];
  const extras = [0, 1, 2, 37, 999, 100000];
  let checked = 0;

  for (const amount of amounts) {
    for (const members of parties) {
      for (const tax of extras) {
        for (const tip of extras) {
          const alloc = allocateReceipt({
            items: [item('a', amount, members), item('b', amount + 1, members.slice(0, 1))],
            taxCents: tax,
            tipCents: tip,
          });
          const expected = amount + (amount + 1) + tax + tip;
          assert.equal(totalOf(alloc), expected);
          assert.equal(sum(alloc.members.map((m) => m.tax_cents)), tax);
          assert.equal(sum(alloc.members.map((m) => m.tip_cents)), tip);
          assert.ok(alloc.members.every((m) => m.tax_cents >= 0 && m.tip_cents >= 0));
          checked++;
        }
      }
    }
  }
  assert.ok(checked >= 1000, `covered ${checked} combinations`);
});

test('a realistic dinner reconciles and is proportional', () => {
  // Three friends. Ana had the expensive main, Ben and Cleo shared a starter.
  const alloc = allocateReceipt({
    items: [
      item(1, 2850, [1], 'Ribeye'),
      item(2, 1600, [2], 'Pasta'),
      item(3, 1400, [3], 'Risotto'),
      item(4, 900, [2, 3], 'Burrata'),
      item(5, 4200, [1, 2, 3], 'Wine'),
    ],
    taxCents: 918,
    tipCents: 2000,
  });

  const byId = Object.fromEntries(alloc.members.map((m) => [m.member_id, m]));
  assert.equal(alloc.subtotal_cents, 2850 + 1600 + 1400 + 900 + 4200);
  assert.equal(totalOf(alloc), alloc.subtotal_cents + 918 + 2000);

  // Ana ordered the most, so carries the most tax and tip.
  assert.ok(byId[1].items_cents > byId[2].items_cents);
  assert.ok(byId[1].tax_cents >= byId[2].tax_cents);
  assert.ok(byId[1].tip_cents >= byId[2].tip_cents);

  // And each person's own columns add up.
  for (const m of alloc.members) {
    assert.equal(m.total_cents, m.items_cents + m.tax_cents + m.tip_cents);
  }
});
