import { Icon } from "@iconify/react";
import { RELATIONS, type AddressRelation } from "../../../lib/addressRelations";
import { Tooltip } from "../../primitives/Tooltip";

/**
 * The filter bar above the address table: one toggle per kind, with the count
 * of rows on this page that carry it. A kind no row carries is disabled, so
 * the bar also reads as a summary of the page at a glance.
 */
export function RelationFilter({
  counts,
  hidden,
  onToggle,
  shown,
  total,
}: {
  counts: Record<AddressRelation, number>;
  hidden: ReadonlySet<AddressRelation>;
  onToggle: (kind: AddressRelation) => void;
  shown: number;
  total: number;
}) {
  return (
    <div
      className="flex items-center gap-inline flex-wrap px-2 py-2 sm:px-4 bs-b-muted"
      role="group"
      aria-label="Filter by how this address takes part"
    >
      <span className="text-xs theme-text-secondary">How this address takes part:</span>
      {RELATIONS.map((r) => {
        const count = counts[r.kind];
        const disabled = count === 0;
        const on = !disabled && !hidden.has(r.kind);
        return (
          <Tooltip key={r.kind} label={<span className="block max-w-72">{r.description}</span>}>
            <button
              type="button"
              disabled={disabled}
              aria-pressed={on}
              onClick={() => onToggle(r.kind)}
              className={`inline-flex items-center gap-tight text-xs px-2 py-1 bs-muted ${
                disabled
                  ? "opacity-30 cursor-not-allowed theme-text-muted"
                  : on
                    ? "cursor-pointer theme-accent theme-accent-bg"
                    : "cursor-pointer theme-text-muted"
              }`}
            >
              <Icon icon={r.icon} className="w-3.5 h-3.5" />
              <span>{r.label}</span>
              <span className="num">{count}</span>
            </button>
          </Tooltip>
        );
      })}
      {shown !== total && (
        <span className="text-xs theme-text-muted">
          Showing {shown} of {total} on this page
        </span>
      )}
    </div>
  );
}
