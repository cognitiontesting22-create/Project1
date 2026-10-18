'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { activeFilterCount, parseFilters } from '@/lib/filters';
import { CATEGORIES, SPLIT_LABELS, SPLIT_TYPES, type Member } from '@/lib/types';
import ExportMenu from './ExportMenu';

/**
 * Filters live entirely in the URL. That keeps a filtered view shareable, makes
 * back/forward work, and lets the export link be the same query string — so the
 * download can never be a different set of rows than the one on screen.
 */
export default function FilterBar({
  groupId,
  members,
  currencies,
  resultCount,
}: {
  groupId: number;
  members: Member[];
  /** Currencies actually used by this group's expenses. */
  currencies: string[];
  resultCount: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [expanded, setExpanded] = useState(false);

  const filters = parseFilters(new URLSearchParams(searchParams.toString()));
  const count = activeFilterCount(filters);

  const update = (mutate: (params: URLSearchParams) => void) => {
    const params = new URLSearchParams(searchParams.toString());
    mutate(params);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  const setSingle = (key: string, value: string) =>
    update((p) => (value ? p.set(key, value) : p.delete(key)));

  const toggleInList = (key: string, value: string) =>
    update((p) => {
      const current = p.getAll(key).flatMap((v) => v.split(',')).filter(Boolean);
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      p.delete(key);
      next.forEach((v) => p.append(key, v));
    });

  // The budget month, the open tab and the activity filters aren't ledger
  // filters, so clearing filters keeps them.
  const clearAll = () => {
    const kept = new URLSearchParams();
    for (const key of ['month', 'tab', 'activity_actor', 'activity_kind']) {
      const value = searchParams.get(key);
      if (value) kept.set(key, value);
    }
    const query = kept.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  const chip = (active: boolean) =>
    `chip transition ${
      active ? 'border-brand-500/60 bg-brand-500/15 text-brand-300' : 'hover:bg-white/[0.08]'
    }`;

  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="btn-ghost px-3 py-2 text-xs"
        >
          <span aria-hidden>⌕</span> Filters
          {count > 0 && (
            <span className="rounded-full bg-brand-500/20 px-1.5 py-0.5 text-[10px] font-bold text-brand-300">
              {count}
            </span>
          )}
        </button>

        <label className="flex items-center gap-1.5 text-xs text-slate-500">
          From
          <input
            type="date"
            value={filters.from ?? ''}
            onChange={(e) => setSingle('from', e.target.value)}
            aria-label="From date"
            className="input w-auto py-1.5 text-xs"
          />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-slate-500">
          to
          <input
            type="date"
            value={filters.to ?? ''}
            onChange={(e) => setSingle('to', e.target.value)}
            aria-label="To date"
            className="input w-auto py-1.5 text-xs"
          />
        </label>

        <span className="ml-auto flex items-center gap-2">
          <span className="text-xs tabular-nums text-slate-500">
            {resultCount} {resultCount === 1 ? 'expense' : 'expenses'}
          </span>
          {count > 0 && (
            <button
              type="button"
              onClick={clearAll}
              className="text-xs font-medium text-slate-400 hover:text-white"
            >
              Clear
            </button>
          )}
          <ExportMenu groupId={groupId} query={searchParams.toString()} filtered={count > 0} />
        </span>
      </div>

      {expanded && (
        <div className="mt-4 space-y-4 border-t border-white/[0.06] pt-4">
          <div>
            <span className="label">Category</span>
            <div className="flex flex-wrap gap-1.5">
              {CATEGORIES.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => toggleInList('category', c.id)}
                  aria-pressed={filters.categories.includes(c.id)}
                  className={chip(filters.categories.includes(c.id))}
                >
                  <span aria-hidden>{c.emoji}</span> {c.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <span className="label">Paid by</span>
              <div className="flex flex-wrap gap-1.5">
                {members.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => toggleInList('paidBy', String(m.id))}
                    aria-pressed={filters.paidBy.includes(m.id)}
                    className={chip(filters.paidBy.includes(m.id))}
                  >
                    {m.name}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <span className="label">
                Involving <span className="normal-case text-slate-600">(paid or has a share)</span>
              </span>
              <div className="flex flex-wrap gap-1.5">
                {members.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => toggleInList('involving', String(m.id))}
                    aria-pressed={filters.involving.includes(m.id)}
                    className={chip(filters.involving.includes(m.id))}
                  >
                    {m.name}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <span className="label">Split type</span>
              <div className="flex flex-wrap gap-1.5">
                {SPLIT_TYPES.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => toggleInList('splitType', t)}
                    aria-pressed={filters.splitTypes.includes(t)}
                    className={chip(filters.splitTypes.includes(t))}
                  >
                    {SPLIT_LABELS[t].replace(/^by /, '')}
                  </button>
                ))}
              </div>
            </div>
            {currencies.length > 1 && (
              <div>
                <span className="label">Entered in</span>
                <div className="flex flex-wrap gap-1.5">
                  {currencies.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => toggleInList('currency', c)}
                      aria-pressed={filters.currencies.includes(c)}
                      className={chip(filters.currencies.includes(c))}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <label className="flex cursor-pointer items-center gap-2.5 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={filters.manualOnly}
              onChange={(e) => setSingle('source', e.target.checked ? 'manual' : '')}
              className="h-4 w-4 accent-brand-500"
            />
            Hide auto-generated rows
            <span className="text-xs text-slate-500">
              (recurring postings and plan instalments)
            </span>
          </label>
        </div>
      )}
    </div>
  );
}
