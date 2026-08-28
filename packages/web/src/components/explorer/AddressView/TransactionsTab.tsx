import type { AddressTransaction } from "../../../api/explorer";
import { Dropdown } from "../../primitives/Dropdown";
import { TxTable } from "./TxTable";
import {
  ADDRESS_PAGE_SIZES,
  coercePageSize,
  totalPages,
  type AddressPageSize,
} from "./pageSize";

export type AddressNavTarget = {
  type: "tx" | "address" | "block" | "contract";
  value: string;
};

interface Props {
  ownerAddress: string;
  txs: AddressTransaction[];
  page: number;
  /** Full appearance count for the address, across all pages. */
  total: number;
  /** Rows per page. The size lived here as a const and in the hook as another,
   *  so changing one silently broke the other's "has more" test. One owner. */
  pageSize: AddressPageSize;
  onLoadPage: (newPage: number) => void;
  onPageSize: (size: AddressPageSize) => void;
  onNavigate: (target: AddressNavTarget) => void;
}

export function TransactionsTab({
  ownerAddress,
  txs,
  page,
  total,
  pageSize,
  onLoadPage,
  onPageSize,
  onNavigate,
}: Props) {
  return (
    <div
      className="rounded-lg bs overflow-hidden theme-card-bg"
    >
      {txs.length === 0 ? (
        <div
          className="p-4 text-center text-sm theme-text-muted"
        >
          No transactions found
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <TxTable
              txs={txs}
              ownerAddress={ownerAddress}
              onNavigate={onNavigate}
            />
          </div>
          <Pagination
            page={page}
            pages={totalPages(total, pageSize)}
            pageSize={pageSize}
            hasMore={page * pageSize < total}
            onLoadPage={onLoadPage}
            onPageSize={onPageSize}
          />
        </>
      )}
    </div>
  );
}

/**
 * The footer states WHERE you are, not just that there is more.
 *
 * "Page 1" on its own reads as the whole history when the first page of a busy
 * contract covers six hours. "Page 1 of 3,882" says plainly that the rows on
 * screen are a thin slice, and the size control is how a reader takes a
 * thicker one.
 */
function Pagination({
  page,
  pages,
  pageSize,
  hasMore,
  onLoadPage,
  onPageSize,
}: {
  page: number;
  pages: number;
  pageSize: AddressPageSize;
  hasMore: boolean;
  onLoadPage: (p: number) => void;
  onPageSize: (size: AddressPageSize) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-2.5 bs-t-muted">
      <PageButton
        enabled={page > 1}
        onClick={() => onLoadPage(page - 1)}
        label="Previous"
      />
      <div className="flex items-center gap-2">
        <span className="num text-xs theme-text-secondary">
          Page {page.toLocaleString()} of {pages.toLocaleString()}
        </span>
        <Dropdown
          value={String(pageSize)}
          options={ADDRESS_PAGE_SIZES.map((n) => ({
            value: String(n),
            label: `${n} rows`,
          }))}
          onChange={(v) => onPageSize(coercePageSize(v))}
          ariaLabel="Rows per page"
          align="right"
        />
      </div>
      <PageButton
        enabled={hasMore}
        onClick={() => onLoadPage(page + 1)}
        label="Next"
      />
    </div>
  );
}

function PageButton({
  enabled,
  onClick,
  label,
}: {
  enabled: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={!enabled}
      className="text-xs font-medium px-3 py-1.5 rounded transition-colors cursor-pointer"
      style={{
        backgroundColor: enabled
          ? "var(--color-bg-secondary)"
          : "transparent",
        color: enabled
          ? "var(--color-text-primary)"
          : "var(--color-text-muted)",
        cursor: enabled ? "pointer" : "not-allowed",
      }}
    >
      {label}
    </button>
  );
}
