import Link from 'next/link';
import Avatar from '@/components/Avatar';
import LinkMembersPanel from '@/components/LinkMembersPanel';
import { listPeople, listUnlinkedMembers } from '@/lib/people-queries';

export const dynamic = 'force-dynamic';

export default function PeoplePage() {
  const people = listPeople();
  const unlinked = listUnlinkedMembers();

  return (
    <div className="animate-fade-up space-y-6">
      <nav className="text-sm text-slate-500">
        <Link href="/" className="transition hover:text-slate-300">Groups</Link>
        <span className="px-2" aria-hidden>/</span>
        <span className="text-slate-300">People</span>
      </nav>

      <header>
        <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">People</h1>
        <p className="mt-2 max-w-2xl text-pretty text-sm leading-relaxed text-slate-400">
          Group members are per-group. Linking them to a person is what lets Tally add up what
          someone owes and is owed across every group they&apos;re in.
        </p>
      </header>

      {people.length === 0 ? (
        <div className="card grid place-items-center gap-3 px-6 py-14 text-center">
          <span className="text-3xl" aria-hidden>👤</span>
          <p className="font-semibold text-white">Nobody here yet</p>
          <p className="text-sm text-slate-500">Create a group and its members will appear.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {people.map((p) => {
            const aliases = (p.aliases ?? '').split(',').map((a) => a.trim()).filter(Boolean);
            const otherNames = aliases.filter(
              (a) => a.toLowerCase() !== p.display_name.toLowerCase()
            );
            return (
              <Link key={p.id} href={`/people/${p.id}`} className="card card-hover group p-5">
                <div className="flex items-center gap-3">
                  <Avatar name={p.display_name} size="lg" />
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-white">{p.display_name}</span>
                    <span className="block text-xs text-slate-500">
                      {p.group_count} group{p.group_count === 1 ? '' : 's'}
                    </span>
                  </span>
                </div>
                {otherNames.length > 0 && (
                  <p className="mt-3 truncate text-[11px] text-slate-500">
                    also appears as {otherNames.join(', ')}
                  </p>
                )}
              </Link>
            );
          })}
        </div>
      )}

      {unlinked.length > 0 && <LinkMembersPanel members={unlinked} people={people} />}
    </div>
  );
}
