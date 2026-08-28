import { useState, useEffect } from "react";
import { fetchBlock, type BlockDetails } from "../../api/explorer";
import { useActiveChainId } from "../../lib/activeChain";
import { chainSymbol } from "../../lib/chains";
import TxRowActions from "./TxRowActions";
import { formatPLS } from "./format";
import { formatGwei } from "../../lib/format/tokenAmount";
import { ExplorerLink } from "./ExplorerLink";
import { TxGasInfo } from "./TxGasInfo";
import { formatTimestamp } from "./BlockView/formatters";
import { AddToWorkspaceButton } from "../workspace/AddToWorkspaceButton";
import { MiddleTruncate } from "../primitives/MiddleTruncate";
import { DataTable, type Column } from "../primitives/DataTable";

type BlockTx = BlockDetails["transactions"][number];

interface BlockViewProps {
  numberOrHash: string;
  onNavigate: (target: { type: "tx" | "address" | "block"; value: string }) => void;
}


function InfoRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start gap-tight sm:gap-4 py-2.5 bs-b-muted last:shadow-none">
      <span
        className="text-xs font-medium shrink-0 sm:w-40 theme-text-secondary"
      >
        {label}
      </span>
      <div className="text-sm flex-1 min-w-0">{children}</div>
    </div>
  );
}

export default function BlockView({
  numberOrHash,
  onNavigate,
}: BlockViewProps) {
  const [block, setBlock] = useState<BlockDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const chainId = useActiveChainId();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setBlock(null);

    fetchBlock(numberOrHash, chainId)
      .then((data) => {
        if (!cancelled) setBlock(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [numberOrHash, chainId]);

  if (loading) {
    return (
      <div
        className="rounded-lg bs p-8 flex flex-col items-center justify-center min-h-[300px] theme-card-bg"
      >
        <div className="spinner mb-3" />
        <span className="text-sm theme-text-secondary">
          Loading block...
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg p-2 sm:p-4 theme-card-bg">
        <h3 className="text-sm font-semibold mb-1 theme-danger">
          Error
        </h3>
        <p className="text-sm theme-text-secondary">
          {error}
        </p>
      </div>
    );
  }

  if (!block) return null;

  const gasPercent = block.gasLimit !== "0"
    ? ((Number(block.gasUsed) / Number(block.gasLimit)) * 100).toFixed(1)
    : "0";

  const columns: Column<BlockTx>[] = [
    {
      key: "hash",
      header: "Tx Hash",
      primary: true,
      cell: (tx) => (
        <ExplorerLink
          target={{ type: "tx", value: tx.hash }}
          onNavigate={onNavigate}
          className="font-mono text-xs hover:underline cursor-pointer theme-accent"
        >
          <MiddleTruncate value={tx.hash} className="font-mono text-xs theme-accent" />
        </ExplorerLink>
      ),
    },
    {
      key: "method",
      header: "Method",
      cell: (tx) =>
        tx.methodId && tx.methodId !== "0x" ? (
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded theme-primary-bg theme-text-secondary">
            {tx.methodId}
          </span>
        ) : (
          <span className="text-[10px] px-1.5 py-0.5 rounded theme-success-bg theme-success">
            Transfer
          </span>
        ),
    },
    {
      key: "from",
      header: "From",
      cell: (tx) =>
        tx.from ? (
          <ExplorerLink
            target={{ type: "address", value: tx.from }}
            onNavigate={onNavigate}
            className="font-mono text-xs hover:underline cursor-pointer theme-accent"
          >
            <MiddleTruncate value={tx.from} className="font-mono text-xs theme-accent" />
          </ExplorerLink>
        ) : (
          <span className="text-xs theme-text-muted">-</span>
        ),
    },
    {
      key: "to",
      header: "To",
      cell: (tx) =>
        tx.to ? (
          <ExplorerLink
            target={{ type: "address", value: tx.to }}
            onNavigate={onNavigate}
            className="font-mono text-xs hover:underline cursor-pointer theme-accent"
          >
            <MiddleTruncate value={tx.to} className="font-mono text-xs theme-accent" />
          </ExplorerLink>
        ) : (
          <span className="text-[10px] px-1.5 py-0.5 rounded theme-accent-bg theme-accent">
            Create
          </span>
        ),
    },
    {
      key: "value",
      header: "Value",
      cell: (tx) => (
        <span className="font-mono text-xs whitespace-nowrap theme-text">
          {formatPLS(tx.valuePLS, chainSymbol(chainId))}
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
          gasUsed={tx.gasUsed}
        />
      ),
    },
    {
      key: "actions",
      header: "",
      hideLabelOnCard: true,
      cell: (tx) => <TxRowActions hash={tx.hash} contractAddress={tx.to ?? null} compact />,
    },
  ];

  return (
    <div className="space-y-stack">
      {/* Block Info */}
      <div
        className="rounded-lg bs p-2 sm:p-4 theme-card-bg"
      >
        <div className="flex flex-wrap items-center gap-row mb-3 pb-3 bs-b-muted">
          <h2
            className="text-sm font-semibold theme-text"
          >
            Block
          </h2>
          <span
            className="font-mono text-sm font-semibold theme-accent"
          >
            #{Number(block.number).toLocaleString()}
          </span>
          {/* Block nav */}
          <div className="flex items-center gap-tight ml-auto">
            <AddToWorkspaceButton kind="block" value={block.number} />
            <button
              onClick={() => {
                const prevNum = Number(block.number) - 1;
                if (prevNum >= 0) onNavigate({ type: "block", value: String(prevNum) });
              }}
              disabled={Number(block.number) <= 0}
              className="text-xs px-2 py-1 rounded hover:opacity-80 cursor-pointer theme-secondary-bg theme-text-secondary"
            >
              Prev
            </button>
            <button
              onClick={() =>
                onNavigate({
                  type: "block",
                  value: String(Number(block.number) + 1),
                })
              }
              className="text-xs px-2 py-1 rounded hover:opacity-80 cursor-pointer theme-secondary-bg theme-text-secondary"
            >
              Next
            </button>
          </div>
        </div>

        <InfoRow label="Block Hash">
          <span
            className="font-mono break-all theme-text"
          >
            {block.hash}
          </span>
        </InfoRow>
        <InfoRow label="Timestamp">
          <span className="theme-text">
            {formatTimestamp(block.timestamp)}
          </span>
        </InfoRow>
        <InfoRow label="Transactions">
          <span
            className="font-mono theme-text"
          >
            {block.transactionCount}
          </span>
        </InfoRow>
        <InfoRow label="Miner / Validator">
          <ExplorerLink
            target={{ type: "address", value: block.miner }}
            onNavigate={onNavigate}
            className="font-mono text-sm hover:underline cursor-pointer theme-accent"
          >
            <MiddleTruncate value={block.miner} className="font-mono text-sm theme-accent" />
          </ExplorerLink>
        </InfoRow>
        <InfoRow label="Gas Used / Limit">
          <span className="theme-text">
            <span className="font-mono">
              {Number(block.gasUsed).toLocaleString()}
            </span>
            <span className="theme-text-muted"> / </span>
            <span className="font-mono">
              {Number(block.gasLimit).toLocaleString()}
            </span>
            <span
              className="ml-2 text-xs theme-text-secondary"
            >
              ({gasPercent}%)
            </span>
          </span>
        </InfoRow>
        {block.baseFeePerGas && (
          <InfoRow label="Base Fee">
            <span
              className="font-mono theme-text"
            >
              {formatGwei(block.baseFeePerGas, 2) ?? "—"} Gwei
            </span>
          </InfoRow>
        )}
        <InfoRow label="Size">
          <span
            className="font-mono theme-text"
          >
            {Number(block.size).toLocaleString()} bytes
          </span>
        </InfoRow>
        <InfoRow label="Parent Hash">
          <ExplorerLink
            // Parent is navigated by number (current - 1), not by hash.
            target={{
              type: "block",
              value: String(Math.max(0, Number(block.number) - 1)),
            }}
            onNavigate={onNavigate}
            className="font-mono text-sm break-all hover:underline cursor-pointer theme-accent"
          >
            {block.parentHash}
          </ExplorerLink>
        </InfoRow>
      </div>

      {/* Transactions */}
      <div
        className="rounded-lg bs overflow-hidden theme-card-bg"
      >
        <div className="px-4 py-3 bs-b-muted">
          <h3
            className="text-sm font-semibold theme-text"
          >
            Transactions
            <span
              className="ml-2 text-[10px] font-medium px-1.5 py-0.5 rounded-full theme-accent-bg theme-accent"
            >
              {block.transactionCount}
            </span>
          </h3>
        </div>

        <DataTable
          columns={columns}
          rows={block.transactions}
          rowKey={(tx, i) => `${tx.hash}-${i}`}
          emptyLabel="No transactions in this block"
        />
      </div>
    </div>
  );
}
