import Link from 'next/link';
import { AvatarStack } from '@/components/Avatar';
import CreateGroupButton from '@/components/CreateGroupButton';
import { formatCompact } from '@/lib/money';
import { listGroups, listRates } from '@/lib/queries';

export const dynamic = 'force-dynamic';

export default function HomePage() {
  const groups = listGroups();
  const currencies = listRates().map((r) => r.currency);
  const totalTracked = groups.reduce((sum, g) => sum + g.total_cents, 0);
  const totalPeople = groups.reduce((sum, g) => sum + g.member_count, 0);

  return (
    <div className="animate-fade-up space-y-10">
      <section className="card relative overflow-hidden p-8 sm:p-10">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full
                     bg-brand-500/20 blur-3xl"
        />
        <div className="relative max-w-2xl">
          <span className="chip mb-4">
            <span className="h-1.5 w-1.5 rounded-full bg-brand-400" /> Next.js · SQLite
          </span>
          <h1 className="text-balance text-4xl font-bold tracking-tight text-white sm:text-5xl">
            Split expenses without the{' '}
            <span className="bg-gradient-to-r from-brand-300 to-grape-400 bg-clip-text text-transparent">
              awkward math
            </span>
          </h1>
          <p className="mt-4 text-pretty text-base leading-relaxed text-slate-400">
            Log what everyone paid, let Tally work out who owes whom, and settle up in the
            fewest possible payments.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <CreateGroupButton currencies={currencies} />
            {groups.length > 0 && (
              <Link href={`/groups/${groups[0].id}`} className="btn-ghost">
                Open {groups[0].emoji} {groups[0].name}
              </Link>
            )}
          </div>
        </div>
      </section>

      {groups.length > 0 && (
        <section className="grid gap-4 sm:grid-cols-3">
          <Stat label="Groups" value={String(groups.length)} />
          <Stat label="People" value={String(totalPeople)} />
          <Stat label="Total tracked" value={formatCompact(totalTracked)} accent />
        </section>
      )}

      <section>
        <div className="mb-4 flex items-end justify-between">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-white">Your groups</h2>
            <p className="text-sm text-slate-500">
              {groups.length === 0
                ? 'Nothing here yet.'
                : `${groups.length} group${groups.length === 1 ? '' : 's'}`}
            </p>
          </div>
          {groups.length > 0 && <CreateGroupButton variant="ghost" currencies={currencies} />}
        </div>

        {groups.length === 0 ? (
          <div className="card grid place-items-center gap-4 px-6 py-16 text-center">
            <span className="grid h-16 w-16 place-items-center rounded-2xl bg-white/[0.04] text-3xl">
              🧾
            </span>
            <div>
              <p className="font-semibold text-white">No groups yet</p>
              <p className="mt-1 text-sm text-slate-500">
                Create one for your trip, apartment, or dinner club to get started.
              </p>
            </div>
            <CreateGroupButton currencies={currencies} />
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {groups.map((g) => (
              <Link key={g.id} href={`/groups/${g.id}`} className="card card-hover group p-5">
                <div className="flex items-start justify-between gap-3">
                  <span
                    className="grid h-12 w-12 shrink-0 place-items-center rounded-xl
                               bg-white/[0.05] text-2xl transition group-hover:scale-105"
                  >
                    {g.emoji}
                  </span>
                  <span className="chip">{g.currency}</span>
                </div>

                <h3 className="mt-4 truncate font-semibold text-white">{g.name}</h3>
                <p className="mt-0.5 line-clamp-1 text-sm text-slate-500">
                  {g.description || `${g.expense_count} expense${g.expense_count === 1 ? '' : 's'}`}
                </p>

                <div className="mt-5 flex items-center justify-between border-t border-white/[0.06] pt-4">
                  <AvatarStack names={g.member_names} />
                  <span className="text-right">
                    <span className="block text-sm font-bold text-white">
                      {formatCompact(g.total_cents, g.currency)}
                    </span>
                    <span className="block text-[11px] text-slate-500">total spent</span>
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="card p-5">
      <p className="text-xs uppercase tracking-wider text-slate-500">{label}</p>
      <p
        className={`mt-1.5 text-2xl font-bold tracking-tight ${
          accent ? 'text-brand-400' : 'text-white'
        }`}
      >
        {value}
      </p>
    </div>
  );
}
