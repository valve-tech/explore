/**
 * Watches pinned transactions through their lifecycle and shows how long each
 * took. A row polls the tx lookup: a hit means it's mined (success/reverted);
 * a miss means it isn't on-chain yet — still pending if the mempool shows it,
 * or dropped once it's absent from a *complete* mempool view past a grace
 * window. The elapsed clock freezes the moment status leaves "pending".
 */

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Icon } from "@iconify/react";
import { fetchTransaction } from "../../api/explorer";
import { ExplorerLink } from "../explorer/ExplorerLink";
import { truncateAddr } from "../explorer/format";
import { Badge } from "../primitives/Badge";
import { EmptyState } from "../primitives/EmptyState";
import { Tooltip } from "../primitives/Tooltip";
import { useTrackedTxs } from "../../hooks/useTrackedTxs";
import {
  resolveTracked,
  untrackTx,
  clearResolved,
  type TrackedTx,
} from "../../lib/trackedTxs";

/** Don't call a tx "dropped" until it's been gone this long from the pool. */
const DROP_GRACE_MS = 90_000;

type NavFn = (t: { type: string; value: string }) => void;

function fmtDur(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m < 60) return `${m}:${String(sec).padStart(2, "0")}`;
  const h = Math.floor(m / 60);
  return `${h}:${String(m % 60).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

export function TrackedTxPanel({
  pendingHashes,
  mempoolComplete,
  onNavigate,
}: {
  pendingHashes: Set<string>;
  mempoolComplete: boolean;
  onNavigate: NavFn;
}) {
  const tracked = useTrackedTxs();

  // One ticking clock for the whole panel, only while something is pending.
  const [, setTick] = useState(0);
  const anyPending = tracked.some((t) => t.status === "pending");
  useEffect(() => {
    if (!anyPending) return;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [anyPending]);

  if (tracked.length === 0) return null;
  const hasResolved = tracked.some((t) => t.status !== "pending");

  return (
    <div className="card overflow-hidden">
      <div className="bs-b-muted flex items-center justify-between px-3 py-2.5">
        <div className="flex items-center gap-inline">
          <Icon
            icon="heroicons:map-pin"
            className="w-4 h-4 theme-accent"
          />
          <h3
            className="text-xs font-semibold uppercase tracking-widest theme-text-secondary"
          >
            Tracked transactions
          </h3>
          <span className="text-[11px] theme-text-muted">
            {tracked.length}
          </span>
        </div>
        {hasResolved && (
          <button
            onClick={clearResolved}
            className="text-[11px] transition-colors hover:opacity-100 theme-text-muted"
            style={{ backgroundColor: "transparent" }}
          >
            Clear resolved
          </button>
        )}
      </div>

      {tracked.map((t) => (
        <TrackedRow
          key={t.hash}
          tx={t}
          pendingHashes={pendingHashes}
          mempoolComplete={mempoolComplete}
          onNavigate={onNavigate}
        />
      ))}
    </div>
  );
}

function TrackedRow({
  tx,
  pendingHashes,
  mempoolComplete,
  onNavigate,
}: {
  tx: TrackedTx;
  pendingHashes: Set<string>;
  mempoolComplete: boolean;
  onNavigate: NavFn;
}) {
  // Poll the tx lookup while pending; stop once resolved. A throw = not mined.
  const { data, isError } = useQuery({
    queryKey: ["tracked-tx", tx.hash],
    queryFn: () => fetchTransaction(tx.hash),
    retry: false,
    refetchInterval: tx.status === "pending" ? 6_000 : false,
    staleTime: 0,
  });

  useEffect(() => {
    // Mined = the lookup resolved with a real outcome. A pending tx now also
    // resolves (status "pending", blockNumber "pending" sentinel), so check the
    // status explicitly — `data.blockNumber` alone is truthy for pending too.
    if (data && data.status !== "pending" && data.blockNumber) {
      resolveTracked(tx.hash, {
        status: "mined",
        blockNumber: data.blockNumber,
        execStatus: data.status,
      });
      return;
    }
    // Not on-chain yet — the lookup threw, returned nothing, or still reports
    // pending. Only call it dropped from a complete mempool view.
    if (
      (isError || data === undefined || data?.status === "pending") &&
      tx.status === "pending"
    ) {
      const gone = !pendingHashes.has(tx.hash.toLowerCase());
      const expired = Date.now() - tx.firstSeen > DROP_GRACE_MS;
      if (mempoolComplete && gone && expired) {
        resolveTracked(tx.hash, { status: "dropped" });
      }
    }
  }, [data, isError, pendingHashes, mempoolComplete, tx.hash, tx.firstSeen, tx.status]);

  const elapsedMs = (tx.resolvedAt ?? Date.now()) - tx.firstSeen;

  return (
    <div className="bs-b-muted flex items-center gap-row px-3 py-2.5">
      <StatusBadge tx={tx} />

      <ExplorerLink
        target={{ type: "tx", value: tx.hash }}
        onNavigate={onNavigate}
        className="font-mono text-xs hover:underline cursor-pointer min-w-0 theme-accent"
        title={tx.hash}
      >
        {truncateAddr(tx.hash)}
      </ExplorerLink>

      {tx.status === "mined" && tx.blockNumber && (
        <ExplorerLink
          target={{ type: "block", value: tx.blockNumber }}
          onNavigate={onNavigate}
          className="text-[11px] font-mono hover:underline cursor-pointer shrink-0 theme-text-muted"
        >
          block #{Number(tx.blockNumber).toLocaleString()}
        </ExplorerLink>
      )}

      <span className="flex-1" />

      <Tooltip
        label={tx.status === "pending" ? "elapsed since pinned" : "time to resolve"}
        className="shrink-0"
      >
        <span
          className={`text-xs font-mono tabular-nums ${tx.status === "pending" ? "theme-warning" : "theme-text-secondary"}`}
        >
          {tx.status === "pending" ? "" : "took "}
          {fmtDur(elapsedMs)}
        </span>
      </Tooltip>

      <Tooltip label="Stop tracking" className="shrink-0">
        <button
          onClick={() => untrackTx(tx.hash)}
          aria-label="Stop tracking"
          className="flex items-center justify-center w-6 h-6 transition-colors theme-text-muted"
          style={{ backgroundColor: "transparent" }}
        >
          <Icon icon="heroicons:x-mark" className="w-3.5 h-3.5" />
        </button>
      </Tooltip>
    </div>
  );
}

function StatusBadge({ tx }: { tx: TrackedTx }) {
  if (tx.status === "pending") {
    return (
      <Badge variant="warn" className="shrink-0">
        <Icon icon="heroicons:clock" className="w-3 h-3" />
        Pending
      </Badge>
    );
  }
  if (tx.status === "dropped") {
    return (
      <Badge variant="neutral" className="shrink-0">
        <Icon icon="heroicons:no-symbol" className="w-3 h-3" />
        Dropped
      </Badge>
    );
  }
  // mined
  if (tx.execStatus === "reverted") {
    return (
      <Badge variant="bad" className="shrink-0">
        <Icon icon="heroicons:x-circle" className="w-3 h-3" />
        Reverted
      </Badge>
    );
  }
  return (
    <Badge variant="ok" className="shrink-0">
      <Icon icon="heroicons:check-circle" className="w-3 h-3" />
      Mined
    </Badge>
  );
}

/** Exported for reuse: a zero-state when nothing is tracked (optional usage). */
export function NoTrackedTxs() {
  return (
    <EmptyState
      icon="heroicons:map-pin"
      title="No tracked transactions"
      subtitle="Pin a pending tx to watch it through to mined or dropped."
    />
  );
}
