import Link from 'next/link';
import { notFound } from 'next/navigation';
import Avatar from '@/components/Avatar';
import PersonStatement from '@/components/PersonStatement';
import { simplifyDebts } from '@/lib/balances';
import { formatCents } from '@/lib/money';
import {
  getIndicativeTotal,
  getPerson,
  getPersonPositions,
  listMembersOfPerson,
} from '@/lib/people-queries';
import { rollupByCurrency } from '@/lib/people';
import { getBalances, getMemberStatement } from '@/lib/queries';

export const dynamic = 'force-dynamic';

const DISPLAY_CURRENCY = 'USD';

export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const personId = Number(id);
  if (!Number.isInteger(personId)) notFound();

  const person = getPerson(personId);
  if (!person) notFound();

  const positions = getPersonPositions(personId);
  const byCurrency = rollupByCurrency(positions);
  const mixed = byCurrency.length > 1;
  const memberships = listMembersOfPerson(personId);

  // Across currencies there is no exact single figure, so the combined number
  // is converted at today's rates and labelled as indicative. Within a single
  // currency the per-currency rollup is exact and this is just the same number.
  const indicative = mixed ? getIndicativeTotal(positions, DISPLAY_CURRENCY) : null;

  // Who this person should pay, or be paid by, in each group.
  const settlements = positions.flatMap((p) => {
    const debts = simplifyDebts(getBalances(p.group_id));
    return debts
      .filter((d) => d.from_member_id === p.member_id || d.to_member_id === p.member_id)
      .map((d) => ({ ...d, group: p, owes: d.from_member_id === p.member_id }));
  });

  const statement = memberships.flatMap((m) =>
    getMemberStatement(m.id).map((row) => ({ ...row, member_id: m.id }))
  );

  return (
    <div className="animate-fade-up space-y-6">
      <nav className="text-sm text-slate-500">
        <Link href="/people" className="transition hover:text-slate-300">
          People
        </Link>
        <span className="px-2" aria-hidden>
          /
        </span>
        <span className="text-slate-300">{person.display_name}</span>
      </nav>

      <header className="card flex flex-wrap items-center gap-4 p-6">
        <Avatar name={person.display_name} size="lg" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-bold tracking-tight text-white">
            {person.display_name}
          </h1>
          <p className="mt-0.5 text-sm text-slate-500">
            {positions.length} group{positions.length === 1 ? '' : 's'}
            {person.email && ` · ${person.email}`}
          </p>
        </div>
        {positions.length > 0 && (
          <div className="flex gap-2">
            <a href={`/api/people/${personId}/export?dataset=receipt`} download className="btn-ghost text-xs">
              <span aria-hidden>↓</span> Receipt CSV
            </a>
            <a href={`/api/people/${personId}/export?dataset=positions`} download className="btn-ghost text-xs">
              <span aria-hidden>↓</span> Balances CSV
            </a>
          </div>
        )}
      </header>

      {positions.length === 0 ? (
        <div className="card grid place-items-center gap-3 px-6 py-14 text-center">
          <span className="text-3xl" aria-hidden>
            🔗
          </span>
          <p className="font-semibold text-white">Not in any group yet</p>
          <p className="text-sm text-slate-500">
            Link a group member to this person from the{' '}
            <Link href="/people" className="text-brand-400 hover:text-brand-300">
              people page
            </Link>
            .
          </p>
        </div>
      ) : (
        <>
          <section className="space-y-4">
            {byCurrency.map((c) => (
              <div key={c.currency} className="grid gap-4 sm:grid-cols-3">
                <Stat
                  label={mixed ? `Owed to them (${c.currency})` : 'Owed to them'}
                  value={formatCents(c.owed_cents, c.currency)}
                  tone="good"
                />
                <Stat
                  label={mixed ? `They owe (${c.currency})` : 'They owe'}
                  value={formatCents(c.owes_cents, c.currency)}
                  tone={c.owes_cents > 0 ? 'bad' : undefined}
                />
                <Stat
                  label="Net"
                  value={`${c.net_cents > 0 ? '+' : c.net_cents < 0 ? '−' : ''}${formatCents(
                    Math.abs(c.net_cents),
                    c.currency
                  )}`}
                  tone={c.net_cents > 0 ? 'good' : c.net_cents < 0 ? 'bad' : undefined}
                  sub={`${c.group_count} group${c.group_count === 1 ? '' : 's'}`}
                />
              </div>
            ))}

            {indicative && (
              <div className="card flex flex-wrap items-center justify-between gap-3 border-amber-500/20 bg-amber-500/[0.05] p-4">
                <span className="text-xs text-amber-300/90">
                  Across {byCurrency.length} currencies · converted at today&apos;s rates, so this
                  one figure is indicative rather than exact
                </span>
                <span className="text-lg font-bold tabular-nums text-white">
                  {indicative.net_cents >= 0 ? '+' : '−'}
                  {formatCents(Math.abs(indicative.net_cents), DISPLAY_CURRENCY)}
                </span>
              </div>
            )}
          </section>

          <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
            <PersonStatement rows={statement} />

            <aside className="space-y-4">
              <div className="card p-5">
                <h2 className="mb-1 font-semibold text-white">By group</h2>
                <p className="mb-4 text-xs text-slate-500">
                  Each group settles on its own — these never net against each other.
                </p>
                <ul className="space-y-2">
                  {positions.map((p) => (
                    <li key={p.group_id}>
                      <Link
                        href={`/groups/${p.group_id}`}
                        className="flex items-center gap-3 rounded-xl border border-white/[0.06]
                                   bg-white/[0.02] p-3 transition hover:bg-white/[0.05]"
                      >
                        <span className="text-lg" aria-hidden>
                          {p.emoji}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-slate-200">
                            {p.group_name}
                          </span>
                          <span className="block text-[11px] text-slate-500">
                            as {p.member_name}
                          </span>
                        </span>
                        <span
                          className={`text-sm font-bold tabular-nums ${
                            p.net_cents > 0
                              ? 'text-brand-400'
                              : p.net_cents < 0
                                ? 'text-rose-400'
                                : 'text-slate-500'
                          }`}
                        >
                          {p.net_cents === 0
                            ? 'settled'
                            : `${p.net_cents > 0 ? '+' : '−'}${formatCents(
                                Math.abs(p.net_cents),
                                p.currency
                              )}`}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="card p-5">
                <h2 className="mb-1 font-semibold text-white">To square up</h2>
                <p className="mb-4 text-xs text-slate-500">
                  Payments involving {person.display_name}, per group.
                </p>
                {settlements.length === 0 ? (
                  <p className="rounded-xl border border-brand-500/20 bg-brand-500/[0.07] px-4 py-5 text-center text-sm text-brand-300">
                    All square everywhere 🎉
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {settlements.map((s, i) => (
                      <li
                        key={`${s.group.group_id}-${i}`}
                        className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3"
                      >
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="text-slate-400">
                            {s.owes ? (
                              <>
                                pays{' '}
                                <span className="font-medium text-slate-200">{s.to_name}</span>
                              </>
                            ) : (
                              <>
                                <span className="font-medium text-slate-200">{s.from_name}</span>{' '}
                                pays them
                              </>
                            )}
                          </span>
                          <span
                            className={`font-bold tabular-nums ${
                              s.owes ? 'text-rose-400' : 'text-brand-400'
                            }`}
                          >
                            {formatCents(s.amount_cents, s.group.currency)}
                          </span>
                        </div>
                        <p className="mt-1 text-[11px] text-slate-500">
                          {s.group.emoji} {s.group.group_name}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'good' | 'bad';
}) {
  const color = tone === 'good' ? 'text-brand-400' : tone === 'bad' ? 'text-rose-400' : 'text-white';
  return (
    <div className="card p-5">
      <p className="text-xs uppercase tracking-wider text-slate-500">{label}</p>
      <p className={`mt-1.5 text-2xl font-bold tracking-tight tabular-nums ${color}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}
