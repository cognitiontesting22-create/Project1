import { NextResponse } from 'next/server';
import { RATE_SCALE } from '@/lib/currency';
import { csvAmount, safeFilename, toCsv, type CsvValue } from '@/lib/csv';
import { filterParamErrors, parseFilters, type LedgerFilters } from '@/lib/filters';
import {
  getBalances,
  getGroup,
  listExpenses,
  listMembers,
  listSettlements,
} from '@/lib/queries';
import { today } from '@/lib/schedule';
import { SPLIT_LABELS, categoryMeta } from '@/lib/types';

export const dynamic = 'force-dynamic';

const DATASETS = ['expenses', 'balances', 'payments'] as const;
type Dataset = (typeof DATASETS)[number];

/** 1 unit of the original currency in group currency, for the audit column. */
function rateLabel(rateE8: number): string {
  return String(Number((rateE8 / RATE_SCALE).toFixed(8)));
}

/**
 * One row per person per expense (tidy/long). Pivot tables, SUMIF and scripts
 * all work on this shape without reshaping, and it stays stable when the
 * group's membership changes.
 */
function expensesCsv(groupId: number, filters: LedgerFilters, currency: string) {
  const rows: CsvValue[][] = [];

  for (const e of listExpenses(groupId, filters)) {
    const foreign = e.original_currency !== currency;

    for (const split of e.splits) {
      rows.push([
        e.spent_at.slice(0, 10),
        e.description,
        categoryMeta(e.category).label,
        e.paid_by_name,
        csvAmount(e.amount_cents),
        currency,
        split.name,
        csvAmount(split.amount_cents),
        // Only meaningful for percent/shares; blank keeps the column numeric.
        e.split_type === 'percent' && split.weight !== null
          ? (split.weight / 100).toFixed(2)
          : '',
        e.split_type === 'shares' && split.weight !== null
          ? (split.weight / 100).toFixed(2)
          : '',
        SPLIT_LABELS[e.split_type],
        foreign ? csvAmount(e.original_amount_cents) : '',
        foreign ? e.original_currency : '',
        foreign ? rateLabel(e.rate_e8) : '',
        e.source,
        e.period ?? '',
        e.id,
      ]);
    }
  }

  return {
    headers: [
      'date',
      'description',
      'category',
      'paid_by',
      'expense_total',
      'currency',
      'member',
      'member_share',
      'share_percent',
      'share_count',
      'split_type',
      'original_amount',
      'original_currency',
      'rate',
      'source',
      'period',
      'expense_id',
    ],
    rows,
  };
}

/**
 * Point-in-time snapshot: everything up to the end of the range, including
 * history from before it starts. Reads like a statement rather than a slice,
 * and still sums to exactly zero because each expense's payer credit and its
 * splits are bounded by the same date.
 */
function balancesCsv(groupId: number, filters: LedgerFilters, currency: string) {
  const asOf = filters.to ?? today();
  const balances = getBalances(groupId, asOf);

  const rows: CsvValue[][] = balances.map((b) => [
    b.name,
    csvAmount(b.paid_cents),
    csvAmount(b.owed_cents),
    csvAmount(b.net_cents),
    b.net_cents > 0 ? 'is owed' : b.net_cents < 0 ? 'owes' : 'settled',
    currency,
    asOf,
  ]);

  return {
    headers: ['member', 'total_paid', 'total_share', 'net_balance', 'position', 'currency', 'as_of'],
    rows,
  };
}

function paymentsCsv(groupId: number, filters: LedgerFilters, currency: string) {
  const rows: CsvValue[][] = listSettlements(groupId, filters).map((s) => {
    const foreign = s.original_currency !== currency;
    return [
      s.settled_at.slice(0, 10),
      s.from_name,
      s.to_name,
      csvAmount(s.amount_cents),
      currency,
      s.note,
      foreign ? csvAmount(s.original_amount_cents) : '',
      foreign ? s.original_currency : '',
      foreign ? rateLabel(s.rate_e8) : '',
      s.source,
      s.id,
    ];
  });

  return {
    headers: [
      'date',
      'from',
      'to',
      'amount',
      'currency',
      'note',
      'original_amount',
      'original_currency',
      'rate',
      'source',
      'payment_id',
    ],
    rows,
  };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const groupId = Number(id);
  if (!Number.isInteger(groupId)) {
    return NextResponse.json({ error: 'Unknown group.' }, { status: 404 });
  }

  const group = getGroup(groupId);
  if (!group) return NextResponse.json({ error: 'Unknown group.' }, { status: 404 });

  const url = new URL(request.url);
  const requested = url.searchParams.get('dataset') ?? 'expenses';
  if (!DATASETS.includes(requested as Dataset)) {
    return NextResponse.json(
      { error: `dataset must be one of: ${DATASETS.join(', ')}` },
      { status: 400 }
    );
  }
  const dataset = requested as Dataset;

  // Reject bad parameters instead of quietly exporting a different scope.
  const errors = filterParamErrors(url.searchParams);
  if (errors.length) {
    return NextResponse.json({ error: errors.join(' ') }, { status: 400 });
  }

  // Same parser the group page uses, so the download is always the view.
  const filters = parseFilters(url.searchParams);

  // Touching members keeps an empty group from producing a headerless file.
  listMembers(groupId);

  const build =
    dataset === 'balances' ? balancesCsv : dataset === 'payments' ? paymentsCsv : expensesCsv;
  const { headers, rows } = build(groupId, filters, group.currency);

  const suffix = filters.to ?? today();
  const filename = `${safeFilename(group.name)}-${dataset}-${suffix}.csv`;

  return new NextResponse(toCsv(headers, rows), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
