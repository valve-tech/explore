import { useState, useEffect } from "react";
import { Icon } from "@iconify/react";
import { fetchTransaction, type TransactionDetails } from "../../api/explorer";
import { useActiveChainId } from "../../lib/activeChain";
import { useTxDecode } from "../../hooks/useTxDecode";
import type { NavTarget } from "./TxDetail/primitives";
import { OverviewSection } from "./TxDetail/OverviewSection";
import { DecodedInputSection } from "./TxDetail/DecodedInputSection";
import { EventsSection } from "./TxDetail/EventsSection";
import { InternalTxSection } from "./TxDetail/InternalTxSection";
import { TokenTransfersSection } from "./TxDetail/TokenTransfersSection";
import { RawDataSection } from "./TxDetail/RawDataSection";
import { EntityActionBar } from "../EntityActionBar";
import { AddToWorkspaceButton } from "../workspace/AddToWorkspaceButton";

interface TxDetailProps {
  hash: string;
  onNavigate: (target: NavTarget) => void;
}

export default function TxDetail({ hash, onNavigate }: TxDetailProps) {
  const [tx, setTx] = useState<TransactionDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const chainId = useActiveChainId();

  const decode = useTxDecode(hash, chainId);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setTx(null);

    // Core only — decode arrives via useTxDecode so the page never waits on a
    // verified-source upstream to paint.
    fetchTransaction(hash, chainId, { decode: false })
      .then((data) => {
        if (!cancelled) setTx(data);
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
  }, [hash, chainId]);

  if (loading) {
    return (
      <div
        className="rounded-lg bs p-8 flex flex-col items-center justify-center min-h-[300px] theme-card-bg"
      >
        <div className="spinner mb-3" />
        <span
          className="text-sm theme-text-secondary"
        >
          Loading transaction...
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg p-4 theme-card-bg">
        <div className="flex items-start gap-row">
          <Icon
            icon="heroicons:exclamation-circle"
            className="w-5 h-5 mt-0.5 shrink-0 theme-danger"
          />
          <div>
            <h3 className="text-sm font-semibold mb-1 theme-danger">
              Error
            </h3>
            <p className="text-sm theme-mono theme-text-secondary">
              {error}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!tx) return null;

  const isPending = tx.status === "pending";

  return (
    <div className="space-y-stack">
      <div className="card p-3 flex items-center gap-inline flex-wrap">
        <EntityActionBar
          kind="tx"
          value={hash}
          contractAddress={tx.to}
          omit={["explorer"]}
        />
        <AddToWorkspaceButton kind="tx" value={hash} />
      </div>
      {isPending && (
        <div
          className="card p-3 flex items-start gap-row text-sm"
          style={{ color: "var(--color-warning)" }}
        >
          <Icon
            icon="heroicons:clock"
            className="w-5 h-5 mt-0.5 shrink-0"
          />
          <div className="theme-text-secondary">
            This transaction is <span className="font-semibold theme-text">pending</span> — it's
            in the mempool and not yet mined. Gas used, logs, token transfers,
            and internal calls appear once it's included in a block. Reload to
            check again.
          </div>
        </div>
      )}
      <OverviewSection tx={tx} onNavigate={onNavigate} />
      {(() => {
        // Overlay: prefer freshly-fetched decode, fall back to whatever the
        // core payload carried (populated only in BYO mode).
        const decodedInput = decode.decodedInput ?? tx.decodedInput;
        const decodedLogs =
          decode.decodedLogs.length > 0 ? decode.decodedLogs : tx.decodedLogs;
        return (
          <>
            {decodedInput && <DecodedInputSection decoded={decodedInput} />}
            {(decodedLogs.length > 0 || tx.rawLogs.length > 0) && (
              <EventsSection
                decodedLogs={decodedLogs}
                rawLogs={tx.rawLogs}
                onNavigate={onNavigate}
                decodeState={decode.state}
              />
            )}
          </>
        );
      })()}
      {tx.internalTransactions.length > 0 && (
        <InternalTxSection
          internalTransactions={tx.internalTransactions}
          onNavigate={onNavigate}
        />
      )}
      {tx.tokenTransfers.length > 0 && (
        <TokenTransfersSection
          tokenTransfers={tx.tokenTransfers}
          onNavigate={onNavigate}
        />
      )}
      <RawDataSection input={tx.input} />
    </div>
  );
}
