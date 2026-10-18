# Tally — group expense splitter

A Next.js + SQLite app for splitting shared costs. Log who paid for what, and Tally
works out who owes whom and the fewest payments needed to square up.

## Getting started

```bash
npm install
npm run seed     # optional — loads three demo groups
npm run dev      # http://localhost:3000
npm test         # compiles lib/ into .test-build and runs tests/*.test.cjs
```

The SQLite file is created and migrated automatically at `data/splitter.db` on
first run (override with `DATABASE_PATH`). It's gitignored. The tests never
touch it: each test file gets its own throwaway database, built by the same
migrations.

Two more settings:

- `TALLY_NOW` pins the clock the activity log uses, as an ISO 8601 UTC
  timestamp such as `2026-10-18T14:03:22Z`. Unset, entries carry the real time.
  The tests set it so timestamps are known in advance.
- The `tally_actor_{groupId}` cookie (`tally_actor_3` for group 3) holds the
  member id the group page's **Acting as** picker chose, for a year. Every
  change in that group is credited to that member, and the API routes read the
  same cookie, so `Cookie: tally_actor_3=12` acts as member 12. Missing, or naming
  someone no longer in the group, it falls back to the member with the lowest id.

## What's here

- **Groups** — name, icon, description, currency, and a roster of people.
- **Expenses** — who paid, how much, category, date, and four split modes:
  - `equal` — everyone selected pays the same share
  - `exact` — type each person's amount; must add up to the total
  - `percent` — type each person's percentage; must add up to exactly 100%
  - `shares` — weighted (e.g. 2 shares for a couple, 1 each for everyone else)
- **Multi-currency** — enter an expense in any currency in the rate table; it's
  converted into the group's currency when you save it.
- **Balances** — each person's net position across all expenses and payments.
- **Settle up** — simplified into the fewest transfers, each recordable in a click.
- **Recurring expenses** — rent and bills that post themselves on the same day
  each month, falling back to the last day in short months.
- **Payment plans** — when someone can't settle in one go, spread a debt over
  months with optional interest and interest-free grace periods.
- **Filter and export** — filter the ledger by date range, category, person,
  split type, currency, or origin, then download exactly those rows as CSV.
  Four datasets: expenses, balances, payments, and the activity log
  (`dataset=activity`, filtered by `kind`, `since` and `actor`).
- **Budgets** — a monthly limit per category, set once and carried forward.
  The group page shows each category's spend against it for any month, and
  `GET /api/groups/:id/budgets?month=YYYY-MM` returns the same figures as JSON.
- **Edit** — every field of an expense can be changed in place: description,
  amount, payer, date, category, currency, the people in the split and the split
  mode with its per-person values. The id and entry date survive, and the same
  validation as adding an expense applies. Also over HTTP:
  `PUT /api/groups/:id/expenses/:expenseId`.
- **Activity** — a per-group log of every expense added, edited, deleted,
  restored or reverted and every payment recorded or deleted, credited to whoever
  was picked under **Acting as**, or to Tally for what it posted by itself. The
  Activity tab filters it by person and kind; `GET /api/groups/:id/activity`
  returns it as JSON with `kind`, `since` and `actor` filters.
- **Undo** — a deleted expense can be restored and an edit reverted, straight
  from the Activity tab or with `POST /api/groups/:id/activity/:entryId/undo`.
  Only the latest change to an expense can be undone, and each undo is logged too.

## Layout

```
app/
  page.tsx              group list + hero
  groups/[id]/page.tsx  group detail
  rates/page.tsx        currency rate table
  api/groups/[id]/export/route.ts   CSV download (expenses, balances, payments, activity)
  api/groups/[id]/budgets/route.ts  budget status as JSON
  api/groups/[id]/expenses/route.ts               POST: add an expense
  api/groups/[id]/expenses/[expenseId]/route.ts   PUT: edit, DELETE: delete
  api/groups/[id]/activity/route.ts               the activity log as JSON
  api/groups/[id]/activity/[entryId]/undo/route.ts  POST: undo an entry
  actions.ts            all server actions (validation lives at this boundary)
components/             Avatar, Modal, Tabs, forms, lists, panels
lib/
  db.ts                 connection, pragmas, migration runner
  migrate.mjs           applies migrations/*.sql, tracked by `user_version`
  migrations/*.sql      append-only schema history
    006_activity.sql          the activity log
    007_activity_undo.sql     undo kinds, and links between an entry and its undo
    008_recurring_detached.sql  periods a schedule must not post again
  queries.ts            SQL reads/writes + computeSplits (server-only)
  scheduling-queries.ts recurring expenses, payment plans, catch-up posting
  money.ts              cents/basis-point parsing, formatting, split math
  currency.ts           exact conversion between currencies
  balances.ts           debt simplification
  amortize.ts           instalment schedules
  schedule.ts           the month-anchor calendar rule
  filters.ts            one filter definition, shared by page and export
  budgets.ts            budget status math (pure + the SQL it runs)
  expense-input.ts      one parser/validator for the expense form and JSON body
  activity.ts           log kinds, summaries, the clock, filters, CSV/JSON rows (pure)
  activity-queries.ts   log reads and writes, snapshots (server-only)
  actor.ts              the acting-as member from the request's cookie
  undo.ts               the undo rules and the restore/revert itself
  csv.ts                RFC 4180 writer with formula-injection guards
  dates.ts, types.ts
scripts/seed.mjs        demo data
tests/*.test.cjs        node:test suite, run with `npm test`
tests/harness.cjs       throwaway database + server-only stub for query tests
```

## Design notes

**Money is integer minor units, everywhere.** Floats only appear when parsing
input and formatting output. Splits use largest-remainder apportionment, so
leftover units are handed out one at a time and always sum to the exact total —
`$213.50` across four people becomes `53.38 / 53.38 / 53.37 / 53.37`.

**Percentages are integers too**, stored as basis points (`10000` = 100.00%).
Floats cannot answer "do these add up to 100?" — `33.33 + 33.33 + 33.34` is
`100.00000000000001` — but integers can, exactly.

**Nothing that doesn't reconcile is ever written.** `computeSplits` validates
each mode against the amount the user typed and then re-checks the allocated
total before returning. A split that doesn't add up raises an error naming the
exact shortfall; it is never silently rounded, clamped, or absorbed.

**Balances are computed, not stored.** One SQL query derives each person's net
from expenses paid, shares owed, and settlements. Nothing can drift out of sync.

**Conversion happens once, on the total.** An expense in yen is converted to the
group's currency as a single integer, and *that* integer is split. Converting
each person's share separately would round N times and leave the shares not
quite adding up — those stray units would become balances that never settle.
Conversion uses BigInt, because `amount × rate` leaves the 2^53 safe-integer
range at realistic amounts. The converted figure is stored permanently, so
editing a rate affects new entries only and never moves a settled balance.

**An edit converts at the expense's own rate.** Each expense stores the
`rate_e8` it was booked at, and an edit that keeps the currency applies that
rate to the new amount rather than today's table: a hotel booked at €100 when
the euro was 0.92 and edited to €200 after it moved to 0.80 books $217.39, not
$250.00. Otherwise fixing a typo in a description could quietly revalue an
expense from months ago and move balances nobody touched. An edit that changes
neither the amount nor the currency leaves the booked figure exactly as it was.
Only changing the currency itself converts fresh, as a new expense would.

**Debt simplification** isolates independent zero-sum groups before running
greedy matching inside each. Minimising transfers is NP-hard in general, but
this beats plain greedy whenever balances cancel: `+4, +2, −3, −2, −1` settles
in 3 payments instead of 4. It never exceeds the `n − 1` bound.

**Schedules keep their anchor day.** A recurrence on the 31st posts Jan 31,
Feb 28, Mar 31, Apr 30 — short months clamp, but the anchor doesn't drift, which
is the bug you get from repeatedly adding a month to the previous occurrence.

**Due items are materialised on page load**, not by a cron, so a laptop that was
closed for two months catches up when you open the group. That makes idempotency
essential rather than optional: it's enforced by a unique index on
`(recurring_id, period)` and by claiming each instalment row inside a
transaction, so concurrent requests cannot double-post.

**Payment plans reduce to existing primitives.** Each instalment posts a
settlement for the payment plus, when interest is due, an expense paid by the
creditor and split onto the debtor. The net effect is exactly the principal
portion, so the balance query doesn't need to know plans exist and the zero-sum
invariant holds for free. Interest is charged on the declining balance and the
final instalment absorbs the rounding, so principal lands on exactly zero.

**Export is filtered by the same code the page is.** `lib/filters.ts` parses one
filter object out of the URL, and both the group page and the CSV route use it,
so a download can never be a different set of rows than the one on screen.
Malformed parameters return a 400 rather than being ignored — silently dropping
a bad `from=` would hand back the whole ledger when you asked for one month.

**Exported balances are a point-in-time snapshot**, labelled with an `as_of`
column, and still sum to exactly zero because expenses and settlements are
bounded by the same date. On screen, balances and settle-up deliberately stay
*current* even when the ledger is filtered, with a note saying so — showing
March's debts beside a "Record payment" button would invite someone to pay a
number that stopped being true months ago.

**The CSV writer defends against two things.** Excel and Sheets execute any cell
beginning `=`, `+`, `-`, or `@`, and descriptions and member names are user
input — so risky cells get an apostrophe prefix. The trap is that negative
numbers also start with `-`: a careless guard turns every balance into text that
won't sum, so numeric-looking cells are left alone. Files carry a UTF-8 BOM and
CRLF endings so Excel reads accents and emoji correctly.

**A budget carries forward until it's replaced.** Each row says "from this
month on", and the budget for a month is the latest row on or before it — so
lowering next month's food budget leaves October measured against October's
number. Removing a budget writes an empty row rather than deleting history.
Only the current month and later can be changed; past months are read-only.

**Budgets count what the group bought.** Spend is every expense dated in the
month, in the group's currency, recurring rent included. Payment-plan interest
is posted as an expense so balances work, but it's the price of a loan between
members, so it's left out — as are settlements, which move money already spent.
Recurring charges count once they post, so early in a month "under" means
"under so far". The JSON route posts due items first, exactly as the page does,
so the two never disagree. Amounts are integer minor units and the percentage
is basis points; "near" starts at 80% and "over" means strictly above 100%.

**A log entry is written in the same transaction as its change.** The insert,
update or delete and the activity row commit together or not at all, so there is
never a change the log doesn't know about, or an entry for a change that rolled
back. Each entry also stores the full row (and an expense's splits) on both
sides of the change, which is what makes undo a straight restore rather than a
reconstruction. An edit that changes nothing writes nothing, entry included.

**Undo only acts on the latest change.** An edit or a delete can be undone only
while it's the most recent change to that expense that hasn't itself been
undone. Undoing an older edit underneath a newer one would silently throw the
newer one away, and restoring a deleted expense's last version over a later edit
would do the same. Refusing with the entry to undo first keeps every step
reversible in order: undo #15, and #12 becomes undoable again. Undo entries
can't be undone themselves; the change they reversed can simply be made again.

**Editing a recurring posting makes it a one-off.** Once someone has changed
this month's rent by hand, it no longer says what the schedule says, so it stops
reporting as recurring. But its month stays claimed: the schedule records the
period as taken (`recurring_detached`) and never posts it again, even if the
edited rent is later deleted, so there can't be two rents for one month. The
other months post as normal, and undoing the edit relinks it. Plan interest is
different: it's part of terms both people agreed to, so it can't be edited at all.

**Tests** (`npm test`) compile `lib/` through `tsconfig.test.json` into
`.test-build` and run `tests/*.test.cjs` with `node:test`. They cover the budget
helpers and queries, editing, the activity log, undo, how edits interact with
budgets, schedules, plans and stored rates, and the activity filters and CSV,
each against a real throwaway SQLite database built from the actual migrations.
