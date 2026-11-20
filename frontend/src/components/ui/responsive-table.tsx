import type { ReactNode } from 'react';
import { cn } from './cn';

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** Shown as the card title on phones (use for the identifying column). */
  primary?: boolean;
  /** Hide this column in the phone card view. */
  hideOnMobile?: boolean;
  align?: 'left' | 'right';
  className?: string;
}

export interface ResponsiveTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** Accessible name for the table (rendered as a visually hidden caption). */
  caption: string;
  empty?: ReactNode;
  /** Optional action area shown on each row/card (e.g. a link). */
  rowAction?: (row: T) => ReactNode;
  className?: string;
}

/**
 * A real <table> from `md` up; below that each row becomes a card with
 * label/value pairs, so nothing scrolls sideways on a phone.
 */
export function ResponsiveTable<T>({ columns, rows, rowKey, caption, empty, rowAction, className }: ResponsiveTableProps<T>) {
  if (rows.length === 0 && empty) return <>{empty}</>;
  const primary = columns.find((c) => c.primary) ?? columns[0];
  const rest = columns.filter((c) => c !== primary && !c.hideOnMobile);

  return (
    <div data-ui className={className}>
      {/* Phones: cards */}
      <ul className="flex flex-col gap-2 md:hidden" aria-label={caption}>
        {rows.map((r) => (
          <li key={rowKey(r)} className="rounded-xl border border-line bg-surface p-4 shadow-card">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 font-semibold text-ink">{primary.cell(r)}</div>
              {rowAction && <div className="shrink-0">{rowAction(r)}</div>}
            </div>
            {rest.length > 0 && (
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                {rest.map((c) => (
                  <div key={c.key} className="min-w-0">
                    <dt className="text-xs text-ink-muted">{c.header}</dt>
                    <dd className="truncate text-ink">{c.cell(r)}</dd>
                  </div>
                ))}
              </dl>
            )}
          </li>
        ))}
      </ul>

      {/* Tablet and desktop: table */}
      <div className="hidden overflow-x-auto rounded-xl border border-line bg-surface shadow-card md:block">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead className="bg-surface-muted">
            <tr>
              {columns.map((c) => (
                <th key={c.key} scope="col"
                  className={cn('px-4 py-3 text-xs font-semibold uppercase tracking-wider text-ink-muted', c.align === 'right' ? 'text-right' : 'text-left')}>
                  {c.header}
                </th>
              ))}
              {rowAction && <th scope="col" className="px-4 py-3"><span className="sr-only">Actions</span></th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={rowKey(r)} className="border-t border-line hover:bg-canvas">
                {columns.map((c) => (
                  <td key={c.key} className={cn('px-4 py-3 text-ink', c.align === 'right' && 'text-right', c.className)}>{c.cell(r)}</td>
                ))}
                {rowAction && <td className="px-4 py-3 text-right">{rowAction(r)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
