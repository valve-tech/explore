import type { AddressTransaction } from "../../../api/explorer";
import { formatPLS } from "../format";
import { useActiveChainId } from "../../../lib/activeChain";
import { chainSymbol } from "../../../lib/chains";
import { formatRelativeTimestamp } from "./formatRelative";
import type { AddressNavTarget } from "./TransactionsTab";
import TxRowActions from "../TxRowActions";
import { ExplorerLink } from "../ExplorerLink";
import { TxGasInfo } from "../TxGasInfo";
import { Tooltip } from "../../primitives/Tooltip";
import { MiddleTruncate } from "../../primitives/MiddleTruncate";
import { DataTable, type Column } from "../../primitives/DataTable";

interface Props {
  txs: AddressTransaction[];
  ownerAddress: string;
  onNavigate: (target: AddressNavTarget) => void;
}

export function TxTable({ txs, ownerAddress, onNavigate }: Props) {
  const symbol = chainSymbol(useActiveChainId());

  const columns: Column<AddressTransaction>[] = [
    {
      key: "hash",
      header: "Tx Hash",
      primary: true,
      cell: (tx) => (
        <LinkButton target={{ type: "tx", value: tx.hash }} onNavigate={onNavigate}>
          <MiddleTruncate value={tx.hash} className="font-mono text-xs theme-accent" />
        </LinkButton>
      ),
    },
    {
      key: "block",
      header: "Block",
      cell: (tx) => (
        <LinkButton target={{ type: "block", value: tx.blockNumber }} onNavigate={onNavigate}>
          {Number(tx.blockNumber).toLocaleString()}
        </LinkButton>
      ),
    },
    {
      key: "age",
      header: "Age",
      cell: (tx) => (
        <span className="text-xs whitespace-nowrap theme-text-secondary">
          {formatRelativeTimestamp(tx.timeStamp)}
        </span>
      ),
    },
    {
      key: "from",
      header: "From",
      cell: (tx) => (
        <LinkButton target={{ type: "address", value: tx.from }} onNavigate={onNavigate}>
          <MiddleTruncate value={tx.from} className="font-mono text-xs theme-accent" />
        </LinkButton>
      ),
    },
    {
      key: "to",
      header: "To",
      cell: (tx) => <ToCell tx={tx} ownerAddress={ownerAddress} onNavigate={onNavigate} />,
    },
    {
      key: "value",
      header: "Value",
      cell: (tx) => (
        <span className="font-mono text-xs whitespace-nowrap theme-text">
          {formatPLS(tx.valuePLS, symbol)}
        </span>
      ),
    },
    {
      key: "gas",
      header: "Gas / Type",
      cell: (tx) => (
        <TxGasInfo
          type={tx.type}
          gasPrice={tx.gasPrice}
          maxFeePerGas={tx.maxFeePerGas}
          maxPriorityFeePerGas={tx.maxPriorityFeePerGas}
        />
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (tx) => (
        <Tooltip label={tx.isError === "0" ? "Success" : "Error"}>
          <span
            className="inline-block w-2 h-2 rounded-full"
            style={{
              backgroundColor:
                tx.isError === "0" ? "var(--color-success)" : "var(--color-danger)",
            }}
          />
        </Tooltip>
      ),
    },
    {
      key: "actions",
      header: "",
      hideLabelOnCard: true,
      cell: (tx) => {
        const isCreation = !tx.to || tx.to === "0x";
        return <TxRowActions hash={tx.hash} contractAddress={isCreation ? null : tx.to} compact />;
      },
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={txs}
      rowKey={(tx, i) => `${tx.hash}-${i}`}
      emptyLabel="No transactions"
    />
  );
}

/** The old "To" `<td>`: contract-creation label, or the IN/OUT badge + address. */
function ToCell({
  tx,
  ownerAddress,
  onNavigate,
}: {
  tx: AddressTransaction;
  ownerAddress: string;
  onNavigate: (target: AddressNavTarget) => void;
}) {
  const isContractCreation = !tx.to || tx.to === "0x";
  if (isContractCreation) {
    return (
      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wider theme-accent-bg theme-accent">
        Contract Creation
      </span>
    );
  }

  const isIn = tx.to.toLowerCase() === ownerAddress.toLowerCase();
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <DirectionBadge isIn={isIn} />
      <LinkButton target={{ type: "address", value: tx.to }} onNavigate={onNavigate}>
        <MiddleTruncate value={tx.to} className="font-mono text-xs theme-accent" />
      </LinkButton>
    </div>
  );
}

function LinkButton({
  target,
  onNavigate,
  children,
}: {
  target: AddressNavTarget;
  onNavigate: (target: AddressNavTarget) => void;
  children: React.ReactNode;
}) {
  return (
    <ExplorerLink
      target={target}
      onNavigate={onNavigate}
      // `min-w-0`: harmless everywhere this renders as a plain inline link,
      // but load-bearing in ToCell — there this anchor is a flex item of the
      // IN/OUT-badge row, and without it the anchor's automatic (content-based)
      // min-width keeps it from shrinking, so the MiddleTruncate address inside
      // never gets narrow enough to trigger its own ellipsis and instead runs
      // off the card edge with a hard clip.
      className="font-mono text-xs hover:underline cursor-pointer theme-accent min-w-0"
    >
      {children}
    </ExplorerLink>
  );
}

function DirectionBadge({ isIn }: { isIn: boolean }) {
  return (
    <span
      className="text-[9px] font-bold px-1 py-0.5 rounded"
      style={{
        backgroundColor: isIn
          ? "var(--color-success-muted)"
          : "var(--color-warning-muted)",
        color: isIn ? "var(--color-success)" : "var(--color-warning)",
      }}
    >
      {isIn ? "IN" : "OUT"}
    </span>
  );
}
