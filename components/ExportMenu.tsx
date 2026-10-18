'use client';

import { useEffect, useRef, useState } from 'react';

const DATASETS = [
  {
    id: 'expenses',
    label: 'Expenses',
    hint: 'One row per person per expense',
  },
  {
    id: 'balances',
    label: 'Balances',
    hint: 'Snapshot as of the end date',
  },
  {
    id: 'payments',
    label: 'Payments',
    hint: 'Settlements between people',
  },
  {
    id: 'activity',
    label: 'Activity',
    hint: 'Who added, edited, deleted or undid what',
  },
];

export default function ExportMenu({
  groupId,
  query,
  filtered,
}: {
  groupId: number;
  /** The page's current query string — the export reuses it verbatim. */
  query: string;
  filtered: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const href = (dataset: string) => {
    const page = new URLSearchParams(query);
    if (dataset === 'activity') {
      // The log follows the Activity tab's own filters, not the ledger's.
      const params = new URLSearchParams({ dataset });
      const actor = page.get('activity_actor');
      const kind = page.get('activity_kind');
      if (actor) params.set('actor', actor);
      if (kind) params.set('kind', kind);
      return `/api/groups/${groupId}/export?${params.toString()}`;
    }
    page.set('dataset', dataset);
    return `/api/groups/${groupId}/export?${page.toString()}`;
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="btn-ghost px-3 py-2 text-xs"
      >
        <span aria-hidden>↓</span> Export CSV
      </button>

      {open && (
        <div
          role="menu"
          className="card absolute right-0 top-full z-30 mt-2 w-64 animate-scale-in p-1.5"
        >
          {DATASETS.map((d) => (
            <a
              key={d.id}
              role="menuitem"
              href={href(d.id)}
              download
              onClick={() => setOpen(false)}
              className="block rounded-lg px-3 py-2 transition hover:bg-white/[0.06]"
            >
              <span className="block text-sm font-medium text-white">{d.label}</span>
              <span className="block text-[11px] text-slate-500">{d.hint}</span>
            </a>
          ))}

          <p className="border-t border-white/[0.06] px-3 py-2 text-[11px] leading-relaxed text-slate-500">
            {filtered
              ? 'Exports exactly the rows your filters select.'
              : 'No filters set — exports everything.'}
          </p>
        </div>
      )}
    </div>
  );
}
