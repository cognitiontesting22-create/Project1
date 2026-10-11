const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const {
  PERSON_POSITIONS_SQL,
  rollupByCurrency,
  summarise,
  indicativeTotal,
  normaliseName,
} = require('../.test-build/people.js');

const pos = (groupId, currency, net, name = `Group ${groupId}`) => ({
  group_id: groupId,
  group_name: name,
  emoji: '💸',
  currency,
  member_id: groupId * 10,
  member_name: 'Alex',
  net_cents: net,
});

/* ----------------------------------------------------- pure aggregation -- */

test('separates what a person is owed from what they owe', () => {
  const [usd] = rollupByCurrency([pos(1, 'USD', 5000), pos(2, 'USD', -2000), pos(3, 'USD', 750)]);
  assert.equal(usd.owed_cents, 5750, 'the two positive positions');
  assert.equal(usd.owes_cents, 2000, 'reported positive, as a magnitude');
  assert.equal(usd.net_cents, 3750);
  assert.equal(usd.group_count, 3);
});

test('never adds different currencies together', () => {
  const rollup = rollupByCurrency([pos(1, 'USD', 5000), pos(2, 'EUR', -3000), pos(3, 'USD', 1000)]);
  assert.equal(rollup.length, 2);

  const byCurrency = Object.fromEntries(rollup.map((r) => [r.currency, r]));
  assert.equal(byCurrency.USD.net_cents, 6000);
  assert.equal(byCurrency.EUR.net_cents, -3000);
  assert.equal(byCurrency.USD.group_count, 2);
  assert.equal(byCurrency.EUR.group_count, 1);
});

test('flags mixed currency so the UI knows not to show one number', () => {
  assert.equal(summarise([pos(1, 'USD', 100), pos(2, 'USD', -50)]).mixedCurrency, false);
  assert.equal(summarise([pos(1, 'USD', 100), pos(2, 'JPY', -50)]).mixedCurrency, true);
  assert.equal(summarise([]).mixedCurrency, false);
});

test('a settled group still counts as a group, with a zero position', () => {
  const [usd] = rollupByCurrency([pos(1, 'USD', 0), pos(2, 'USD', 0)]);
  assert.equal(usd.group_count, 2);
  assert.equal(usd.owed_cents, 0);
  assert.equal(usd.owes_cents, 0);
});

test('someone in no groups rolls up to nothing rather than crashing', () => {
  assert.deepEqual(rollupByCurrency([]), []);
  assert.deepEqual(summarise([]).byCurrency, []);
});

test('the indicative total converts each position before combining', () => {
  // 1 EUR = 1.09 USD for the purposes of this test.
  const convert = (cents, currency) =>
    currency === 'EUR' ? Math.round(cents * 1.09) : cents;

  const total = indicativeTotal([pos(1, 'USD', 5000), pos(2, 'EUR', -2000)], convert);
  assert.equal(total.owed_cents, 5000);
  assert.equal(total.owes_cents, 2180, '-20.00 EUR becomes -21.80 USD');
  assert.equal(total.net_cents, 2820);
});

test('the indicative total nets to zero when positions cancel', () => {
  const total = indicativeTotal([pos(1, 'USD', 4200), pos(2, 'USD', -4200)], (c) => c);
  assert.equal(total.net_cents, 0);
  assert.equal(total.owed_cents, 4200);
  assert.equal(total.owes_cents, 4200);
});

test('name normalisation unifies case and spacing, not nicknames', () => {
  assert.equal(normaliseName('  Alex   Rivera '), 'alex rivera');
  assert.equal(normaliseName('ALEX RIVERA'), normaliseName('alex rivera'));
  assert.notEqual(normaliseName('Alex'), normaliseName('Alex Rivera'));
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

/** Alex is in two groups; Sam is only in the first. */
function seed(db) {
  const group = (name, currency) =>
    Number(
      db.prepare('INSERT INTO groups (name, currency) VALUES (?, ?)').run(name, currency)
        .lastInsertRowid
    );
  const member = (groupId, name) =>
    Number(
      db.prepare('INSERT INTO members (group_id, name) VALUES (?, ?)').run(groupId, name)
        .lastInsertRowid
    );

  const trip = group('Trip', 'USD');
  const flat = group('Flat', 'USD');

  const alexTrip = member(trip, 'Alex');
  const samTrip = member(trip, 'Sam');
  const alexFlat = member(flat, 'Alex');
  const benFlat = member(flat, 'Ben');

  // One person record for Alex, linked in both groups.
  const alex = Number(
    db.prepare("INSERT INTO people (display_name) VALUES ('Alex')").run().lastInsertRowid
  );
  db.prepare('UPDATE members SET person_id = ? WHERE id IN (?, ?)').run(alex, alexTrip, alexFlat);

  const expense = (groupId, payer, cents, shares) => {
    const id = Number(
      db
        .prepare(
          `INSERT INTO expenses (group_id, description, amount_cents, paid_by,
                                 original_amount_cents, original_currency, rate_e8)
           VALUES (?, 'x', ?, ?, ?, 'USD', 100000000)`
        )
        .run(groupId, cents, payer, cents).lastInsertRowid
    );
    for (const [member, amount] of shares) {
      db.prepare(
        'INSERT INTO expense_splits (expense_id, member_id, amount_cents) VALUES (?, ?, ?)'
      ).run(id, member, amount);
    }
  };

  // Trip: Alex fronts 100.00 split evenly -> Alex +50.00, Sam -50.00
  expense(trip, alexTrip, 10000, [[alexTrip, 5000], [samTrip, 5000]]);
  // Flat: Ben fronts 60.00 split evenly -> Alex -30.00, Ben +30.00
  expense(flat, benFlat, 6000, [[alexFlat, 3000], [benFlat, 3000]]);

  return { alex, alexTrip, alexFlat, samTrip, benFlat, trip, flat };
}

test('the rollup query finds one person across two groups', () => {
  const db = buildDatabase();
  const ids = seed(db);

  const rows = db.prepare(PERSON_POSITIONS_SQL).all({ personId: ids.alex });
  assert.equal(rows.length, 2, 'one row per group Alex belongs to');

  const byGroup = Object.fromEntries(rows.map((r) => [r.group_name, r]));
  assert.equal(byGroup.Trip.net_cents, 5000, 'owed 50.00 on the trip');
  assert.equal(byGroup.Flat.net_cents, -3000, 'owes 30.00 on the flat');

  const [usd] = rollupByCurrency(rows);
  assert.equal(usd.owed_cents, 5000);
  assert.equal(usd.owes_cents, 3000);
  assert.equal(usd.net_cents, 2000);
  db.close();
});

test('settlements move a person position in the rollup', () => {
  const db = buildDatabase();
  const ids = seed(db);

  // Sam pays Alex back 50.00, clearing the trip.
  db.prepare(
    `INSERT INTO settlements (group_id, from_member_id, to_member_id, amount_cents,
                              original_amount_cents, original_currency, rate_e8)
     VALUES (?, ?, ?, 5000, 5000, 'USD', 100000000)`
  ).run(ids.trip, ids.samTrip, ids.alexTrip);

  const rows = db.prepare(PERSON_POSITIONS_SQL).all({ personId: ids.alex });
  const byGroup = Object.fromEntries(rows.map((r) => [r.group_name, r]));
  assert.equal(byGroup.Trip.net_cents, 0, 'the trip is settled');
  assert.equal(byGroup.Flat.net_cents, -3000, 'the flat is untouched');
  db.close();
});

test("a person's positions do not leak another person's money", () => {
  const db = buildDatabase();
  const ids = seed(db);

  // Sam gets their own person record.
  const sam = Number(
    db.prepare("INSERT INTO people (display_name) VALUES ('Sam')").run().lastInsertRowid
  );
  db.prepare('UPDATE members SET person_id = ? WHERE id = ?').run(sam, ids.samTrip);

  const samRows = db.prepare(PERSON_POSITIONS_SQL).all({ personId: sam });
  assert.equal(samRows.length, 1, 'Sam is only in the trip');
  assert.equal(samRows[0].net_cents, -5000);

  const alexRows = db.prepare(PERSON_POSITIONS_SQL).all({ personId: ids.alex });
  assert.equal(alexRows.length, 2, "Alex's rows are unaffected");
  db.close();
});

test('an unlinked member belongs to nobody', () => {
  const db = buildDatabase();
  const ids = seed(db);
  const rows = db.prepare(PERSON_POSITIONS_SQL).all({ personId: 999999 });
  assert.deepEqual(rows, [], 'an unknown person has no positions');
  db.close();
});

test('migration backfills one person per distinct name and links members', () => {
  const db = buildDatabase();

  // Members inserted after migration 005 are not auto-linked, so simulate the
  // pre-migration state the backfill actually runs against.
  const g1 = Number(db.prepare("INSERT INTO groups (name) VALUES ('A')").run().lastInsertRowid);
  const g2 = Number(db.prepare("INSERT INTO groups (name) VALUES ('B')").run().lastInsertRowid);
  db.prepare("INSERT INTO members (group_id, name) VALUES (?, 'Dana Lee')").run(g1);
  db.prepare("INSERT INTO members (group_id, name) VALUES (?, '  dana   lee ')").run(g2);

  // Re-run just the backfill statements from the migration.
  const norm = (col) =>
    `replace(replace(replace(lower(trim(${col})),'  ',' '),'  ',' '),'  ',' ')`;
  db.exec(`
    INSERT INTO people (display_name, email)
    SELECT MIN(name), MAX(email) FROM members
     WHERE person_id IS NULL GROUP BY ${norm('name')};
    UPDATE members SET person_id = (
      SELECT p.id FROM people p WHERE ${norm('p.display_name')} = ${norm('members.name')}
    ) WHERE person_id IS NULL;
  `);

  const dana = db
    .prepare("SELECT * FROM members WHERE lower(trim(name)) LIKE '%dana%'")
    .all();
  assert.equal(dana.length, 2);
  assert.ok(dana.every((m) => m.person_id !== null), 'every member gets linked');
  assert.equal(
    new Set(dana.map((m) => m.person_id)).size,
    1,
    "'Dana Lee' and '  dana   lee ' resolve to the same person despite spacing"
  );
  db.close();
});
