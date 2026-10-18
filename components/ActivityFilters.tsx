'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ACTIVITY_KINDS, ACTIVITY_KIND_LABELS, SYSTEM_ACTOR_NAME, SYSTEM_ACTOR_PARAM } from '@/lib/activity';
import type { Member } from '@/lib/types';

/**
 * The filters live in the URL (activity_actor, activity_kind) so a filtered
 * view can be linked. They sit beside the ledger filters without touching them.
 */
export default function ActivityFilters({ members }: { members: Member[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const set = (key: 'activity_actor' | 'activity_kind', value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    // Keep the log open when the page comes back with the new filter.
    params.set('tab', 'activity');
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  return (
    <div className="mb-3 grid gap-2 sm:grid-cols-2">
      <label className="block">
        <span className="label">Person</span>
        <select
          className="input"
          value={searchParams.get('activity_actor') ?? ''}
          onChange={(e) => set('activity_actor', e.target.value)}
        >
          <option value="">Everyone</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
          <option value={SYSTEM_ACTOR_PARAM}>{SYSTEM_ACTOR_NAME}</option>
        </select>
      </label>
      <label className="block">
        <span className="label">Kind</span>
        <select
          className="input"
          value={searchParams.get('activity_kind') ?? ''}
          onChange={(e) => set('activity_kind', e.target.value)}
        >
          <option value="">All activity</option>
          {ACTIVITY_KINDS.map((k) => (
            <option key={k} value={k}>
              {ACTIVITY_KIND_LABELS[k]}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
