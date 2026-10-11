import { NextResponse } from 'next/server';
import { csvAmount, safeFilename, toCsv, type CsvValue } from '@/lib/csv';
import { rollupByCurrency } from '@/lib/people';
import { getPerson, getPersonPositions, listMembersOfPerson } from '@/lib/people-queries';
import { getMemberStatement } from '@/lib/queries';
import { SPLIT_LABELS, categoryMeta } from '@/lib/types';

export const dynamic = 'force-dynamic';

const DATASETS = ['receipt', 'positions'] as const;
type Dataset = (typeof DATASETS)[number];

/**
 * One row per line item for receipts, and one row per expense otherwise, so a
 * person can see exactly what they were charged for and why.
 */
function receiptCsv(personId: number) {
  const rows: CsvValue[][] = [];

  for (const membership of listMembersOfPerson(personId)) {
    for (const row of getMemberStatement(membership.id)) {
      const isReceipt = row.split_type === 'items' && row.items.length > 0;

      if (isReceipt) {
        for (const item of row.items) {
          rows.push([
            row.spent_at.slice(0, 10),
            row.group_name,
            row.description,
            categoryMeta(row.category).label,
            'item',
            item.description,
            csvAmount(item.amount_cents),
            row.currency,
            row.paid_by_name,
            csvAmount(row.amount_cents),
            row.id,
          ]);
        }
        // Tax and tip are a single proportional line, not attached to any item.
        const extras = (row.tax_cents ?? 0) + (row.tip_cents ?? 0);
        if (extras > 0) {
          rows.push([
            row.spent_at.slice(0, 10),
            row.group_name,
            row.description,
            categoryMeta(row.category).label,
            'tax & tip',
            'Share of tax and tip, in proportion to their items',
            csvAmount(extras),
            row.currency,
            row.paid_by_name,
            csvAmount(row.amount_cents),
            row.id,
          ]);
        }
      } else {
        rows.push([
          row.spent_at.slice(0, 10),
          row.group_name,
          row.description,
          categoryMeta(row.category).label,
          'share',
          SPLIT_LABELS[row.split_type] ?? '',
          csvAmount(row.amount_cents),
          row.currency,
          row.paid_by_name,
          csvAmount(row.amount_cents),
          row.id,
        ]);
      }
    }
  }

  return {
    headers: [
      'date',
      'group',
      'expense',
      'category',
      'line_type',
      'detail',
      'line_amount',
      'currency',
      'paid_by',
      'their_total_for_expense',
      'expense_id',
    ],
    rows,
  };
}

function positionsCsv(personId: number) {
  const positions = getPersonPositions(personId);

  const rows: CsvValue[][] = positions.map((p) => [
    p.group_name,
    p.member_name,
    csvAmount(p.net_cents),
    p.net_cents > 0 ? 'is owed' : p.net_cents < 0 ? 'owes' : 'settled',
    p.currency,
  ]);

  // Per-currency subtotals, never summed across currencies.
  for (const c of rollupByCurrency(positions)) {
    rows.push([
      `TOTAL (${c.currency})`,
      `${c.group_count} group${c.group_count === 1 ? '' : 's'}`,
      csvAmount(c.net_cents),
      c.net_cents > 0 ? 'is owed' : c.net_cents < 0 ? 'owes' : 'settled',
      c.currency,
    ]);
  }

  return { headers: ['group', 'known_as', 'net_balance', 'position', 'currency'], rows };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const personId = Number(id);
  if (!Number.isInteger(personId)) {
    return NextResponse.json({ error: 'Unknown person.' }, { status: 404 });
  }

  const person = getPerson(personId);
  if (!person) return NextResponse.json({ error: 'Unknown person.' }, { status: 404 });

  const requested = new URL(request.url).searchParams.get('dataset') ?? 'receipt';
  if (!DATASETS.includes(requested as Dataset)) {
    return NextResponse.json(
      { error: `dataset must be one of: ${DATASETS.join(', ')}` },
      { status: 400 }
    );
  }

  const { headers, rows } =
    (requested as Dataset) === 'positions' ? positionsCsv(personId) : receiptCsv(personId);

  const filename = `${safeFilename(person.display_name)}-${requested}.csv`;

  return new NextResponse(toCsv(headers, rows), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
