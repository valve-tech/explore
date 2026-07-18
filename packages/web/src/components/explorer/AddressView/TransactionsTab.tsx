import type { AddressTransaction } from "../../../api/explorer";
import { TxTable } from "./TxTable";

export type AddressNavTarget = {
  type: "tx" | "address" | "block" | "contract";
  value: string;
};

const PAGE_SIZE = 25;

interface Props {
  ownerAddress: string;
  txs: AddressTransaction[];
  page: number;
  /** Full appearance count for the address, across all pages. */
  total: number;
  onLoadPage: (newPage: number) => void;
  onNavigate: (target: AddressNavTarget) => void;
}

export function TransactionsTab({
  ownerAddress,
  txs,
  page,
  total,
  onLoadPage,
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
            hasMore={page * PAGE_SIZE < total}
            onLoadPage={onLoadPage}
          />
        </>
      )}
    </div>
  );
}

function Pagination({
  page,
  hasMore,
  onLoadPage,
}: {
  page: number;
  hasMore: boolean;
  onLoadPage: (p: number) => void;
}) {
  return (
    <div
      className="flex items-center justify-between px-3 py-2.5 bs-t-muted"
      style={{}}
    >
      <PageButton
        enabled={page > 1}
        onClick={() => onLoadPage(page - 1)}
        label="Previous"
      />
      <span
        className="text-xs theme-text-secondary"
      >
        Page {page}
      </span>
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
