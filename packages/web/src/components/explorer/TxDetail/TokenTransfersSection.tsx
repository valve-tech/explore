import type { TransactionDetails } from "../../../api/explorer";
import { formatAmountDisplay } from "../../../lib/format/tokenAmount";
import { SectionCard, type AddressNavigate } from "./primitives";
import { AddressCell } from "./AddressCell";
import { DataTable, type Column } from "../../primitives/DataTable";

type TokenTransfer = TransactionDetails["tokenTransfers"][number];

/** Parse a string decimals count into a number, or null when absent/garbage.
 *  (Parsing the small decimals COUNT is fine — only AMOUNTS must stay bigint.) */
function parseDecimals(decimalStr: string): number | null {
  return /^\d+$/.test(decimalStr) ? Number(decimalStr) : null;
}

export function TokenTransfersSection({
  tokenTransfers,
  onNavigate,
}: {
  tokenTransfers: TransactionDetails["tokenTransfers"];
  onNavigate: AddressNavigate;
}) {
  const columns: Column<TokenTransfer>[] = [
    {
      key: "token",
      header: "Token",
      primary: true,
      cell: (tt) => (
        <div className="flex items-center gap-1.5">
          <span className="theme-text">{tt.tokenName || "Unknown"}</span>
          <span className="text-[10px] font-medium theme-text-muted">
            {tt.tokenSymbol}
          </span>
        </div>
      ),
    },
    {
      key: "from",
      header: "From",
      cell: (tt) => <AddressCell address={tt.from} onNavigate={onNavigate} />,
    },
    {
      key: "to",
      header: "To",
      cell: (tt) => <AddressCell address={tt.to} onNavigate={onNavigate} />,
    },
    {
      key: "amount",
      header: "Amount",
      cell: (tt) => (
        <span className="font-mono theme-text">
          {formatAmountDisplay(tt.value, parseDecimals(tt.tokenDecimal), {
            symbol: tt.tokenSymbol,
          })}
        </span>
      ),
    },
  ];

  return (
    <SectionCard
      title="Token Transfers"
      count={tokenTransfers.length}
      defaultOpen={false}
    >
      <div className="pt-3">
        <div className="rounded-md bs-muted overflow-hidden">
          <DataTable
            columns={columns}
            rows={tokenTransfers}
            rowKey={(tt, i) => `${tt.hash}-${i}`}
            emptyLabel="No token transfers"
          />
        </div>
      </div>
    </SectionCard>
  );
}
