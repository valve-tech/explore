import type { TransactionDetails } from "../../../api/explorer";
import { SectionCard, type AddressNavigate } from "./primitives";
import { formatPLS } from "./format";
import { useActiveChainId } from "../../../lib/activeChain";
import { chainSymbol } from "../../../lib/chains";
import { AddressCell } from "./AddressCell";
import { DataTable, type Column } from "../../primitives/DataTable";

type InternalTransaction = TransactionDetails["internalTransactions"][number];

export function InternalTxSection({
  internalTransactions,
  onNavigate,
}: {
  internalTransactions: TransactionDetails["internalTransactions"];
  onNavigate: AddressNavigate;
}) {
  const symbol = chainSymbol(useActiveChainId());

  const columns: Column<InternalTransaction>[] = [
    {
      key: "type",
      header: "Type",
      cell: (itx) => (
        <span className="text-[10px] font-mono font-medium px-1.5 py-0.5 rounded theme-primary-bg theme-text-secondary">
          {itx.type}
        </span>
      ),
    },
    {
      key: "from",
      header: "From",
      cell: (itx) => <AddressCell address={itx.from} onNavigate={onNavigate} />,
    },
    {
      key: "to",
      header: "To",
      primary: true,
      cell: (itx) => <AddressCell address={itx.to} onNavigate={onNavigate} />,
    },
    {
      key: "value",
      header: "Value",
      cell: (itx) => (
        <span className="font-mono theme-text">{formatPLS(itx.valuePLS, symbol)}</span>
      ),
    },
    {
      key: "gasUsed",
      header: "Gas Used",
      cell: (itx) => (
        <span className="font-mono theme-text-secondary">
          {Number(itx.gasUsed).toLocaleString()}
        </span>
      ),
    },
  ];

  return (
    <SectionCard
      title="Internal Transactions"
      count={internalTransactions.length}
      defaultOpen={false}
    >
      <div className="pt-3">
        <div className="rounded-md bs-muted overflow-hidden">
          <DataTable
            columns={columns}
            rows={internalTransactions}
            rowKey={(_itx, i) => i}
            emptyLabel="No internal transactions"
          />
        </div>
      </div>
    </SectionCard>
  );
}
