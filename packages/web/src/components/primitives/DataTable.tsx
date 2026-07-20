import type { ReactNode, ReactElement } from "react";
import { useIsMobile } from "../../hooks/useMediaQuery";

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** Below sm:, the first column flagged primary becomes the card heading. */
  primary?: boolean;
  /** Below sm:, omit the field label for this column (e.g. an action button). */
  hideLabelOnCard?: boolean;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string | number;
  className?: string;
  emptyLabel?: string;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  className,
  emptyLabel = "Nothing to show",
}: DataTableProps<T>): ReactElement {
  const isMobile = useIsMobile();

  // No rows OR no columns: render the empty label instead of crashing (card
  // mode indexes into `columns[0]` below, which is unsafe when empty).
  if (rows.length === 0 || columns.length === 0) {
    return (
      <div className="px-3 py-6 text-sm text-center theme-text-muted">
        {emptyLabel}
      </div>
    );
  }

  if (!isMobile) {
    return (
      <table className={className ?? "w-full text-sm"}>
        <thead>
          <tr className="theme-secondary-bg">
            {columns.map((c) => (
              <th
                key={c.key}
                className="text-left px-3 py-2.5 text-xs font-medium theme-text-secondary"
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={rowKey(row, i)} className="bs-t-muted hover:opacity-80">
              {columns.map((c) => (
                <td key={c.key} className="px-3 py-2">
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  const primary = columns.find((c) => c.primary) ?? columns[0]!;
  const rest = columns.filter((c) => c !== primary);

  return (
    <ul className="flex flex-col gap-row">
      {rows.map((row, i) => (
        <li key={rowKey(row, i)} className="card p-4 flex flex-col gap-tight">
          <div className="min-w-0">{primary.cell(row)}</div>
          {rest.map((c) => (
            <div
              key={c.key}
              className="flex items-center justify-between gap-inline min-w-0"
            >
              {!c.hideLabelOnCard && (
                <span className="text-xs shrink-0 theme-text-muted">
                  {c.header}
                </span>
              )}
              <span className="min-w-0 text-right">{c.cell(row)}</span>
            </div>
          ))}
        </li>
      ))}
    </ul>
  );
}
