/**
 * Explorer home view — the landing surface inside /explorer when no
 * specific tx/address/block has been selected.
 *
 * Three data sources, all backed by Bundle 1 of EXPLORER_API_SPEC:
 *  - stats row → /api/latest/summary
 *  - recent blocks → /api/blocks
 *  - recent txs → /api/txs/recent
 *
 * All queries refetch on a 5s interval. The server already memoizes for
 * 3s, so this stays cheap.
 */

import { useQuery } from "@tanstack/react-query";
import { Icon } from "@iconify/react";
import { formatEther, formatUnits } from "viem";
import {
  fetchLatestSummary,
  fetchRecentBlocks,
  fetchRecentTxs,
  type BlockHeader,
  type RecentTx,
} from "../../api/latest";
import TxRowActions from "./TxRowActions";
import { ExplorerLink } from "./ExplorerLink";
import { TxGasInfo } from "./TxGasInfo";
import { GasOracleWidget } from "./GasOracleWidget";
import { subscriptSmallString, groupDecimalString } from "./format";
import { useActiveChainId } from "../../lib/activeChain";
import { chainSymbol } from "../../lib/chains";
import { shortHash } from "../../lib/format/hash";

const REFETCH_MS = 5_000;

interface Props {
  onNavigate: (target: {
    type: "tx" | "address" | "block";
    value: string;
  }) => void;
}

export default function ExplorerHome({ onNavigate }: Props) {
  const chainId = useActiveChainId();

  const summary = useQuery({
    queryKey: ["explorer", "latest", "summary", chainId],
    queryFn: () => fetchLatestSummary(chainId),
    refetchInterval: REFETCH_MS,
    staleTime: 0,
  });

  const blocks = useQuery({
    queryKey: ["explorer", "latest", "blocks", 10, chainId],
    queryFn: () => fetchRecentBlocks({ limit: 10, chainId }),
    refetchInterval: REFETCH_MS,
    staleTime: 0,
  });

  const txs = useQuery({
    queryKey: ["explorer", "latest", "txs", 10, chainId],
    queryFn: () => fetchRecentTxs(10, chainId),
    refetchInterval: REFETCH_MS,
    staleTime: 0,
  });

  return (
    <div className="space-y-stack">
      <StatsRow summary={summary.data} loading={summary.isPending} />

      <GasOracleWidget />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <BlocksCard
          blocks={blocks.data?.blocks ?? []}
          loading={blocks.isPending}
          onNavigate={onNavigate}
        />
        <TxsCard
          txs={txs.data?.transactions ?? []}
          loading={txs.isPending}
          onNavigate={onNavigate}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Stats row                                                          */
/* ------------------------------------------------------------------ */

function StatsRow({
  summary,
  loading,
}: {
  summary: Awaited<ReturnType<typeof fetchLatestSummary>> | undefined;
  loading: boolean;
}) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-row">
      <StatTile
        label="Latest block"
        value={summary ? `#${formatBlockNum(summary.latestBlock.number)}` : "—"}
        sub={summary ? `${summary.latestBlock.transactionCount} txs` : ""}
        loading={loading}
        icon="heroicons:cube"
      />
      <StatTile
        label="Finalized"
        value={
          summary ? `#${formatBlockNum(summary.finalizedBlock.number)}` : "—"
        }
        sub={
          summary
            ? `${summary.finalizedBlock.lagBlocks} block${summary.finalizedBlock.lagBlocks === 1 ? "" : "s"} behind`
            : ""
        }
        loading={loading}
        icon="heroicons:check-badge"
      />
      <StatTile
        label="Base fee"
        value={summary ? formatGwei(summary.gasPrice.baseFeePerGas) : "—"}
        sub="gwei"
        loading={loading}
        icon="heroicons:fire"
      />
      <StatTile
        label="Priority fee"
        value={
          summary ? formatGwei(summary.gasPrice.suggestedPriorityFee) : "—"
        }
        sub="gwei suggested"
        loading={loading}
        icon="heroicons:bolt"
      />
    </div>
  );
}

function StatTile({
  label,
  value,
  sub,
  loading,
  icon,
}: {
  label: string;
  value: string;
  sub: string;
  loading: boolean;
  icon: string;
}) {
  return (
    <div
      className="card p-3 theme-card-bg"
    >
      <div
        className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest mb-1 theme-text-muted"
      >
        <Icon icon={icon} className="w-3 h-3" />
        {label}
      </div>
      <div
        className="text-base font-mono font-semibold tabular-nums"
        style={{
          color: loading
            ? "var(--color-text-muted)"
            : "var(--color-text-primary)",
        }}
      >
        {loading ? "loading…" : value}
      </div>
      {sub !== "" && (
        <div
          className="text-[10px] mt-0.5 theme-text-muted"
        >
          {sub}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Recent blocks card                                                 */
/* ------------------------------------------------------------------ */

function BlocksCard({
  blocks,
  loading,
  onNavigate,
}: {
  blocks: BlockHeader[];
  loading: boolean;
  onNavigate: Props["onNavigate"];
}) {
  return (
    <div
      className="card theme-card-bg"
    >
      <CardHeader title="Latest blocks" icon="heroicons:cube" />
      {loading && blocks.length === 0 ? (
        <Skeleton rows={6} />
      ) : (
        <ul>
          {blocks.map((b) => (
            <li key={b.hash} className="bs-b-muted">
            <ExplorerLink
              target={{ type: "block", value: b.number }}
              onNavigate={onNavigate}
              className="flex items-center justify-between px-4 py-2.5 cursor-pointer hover:opacity-80 transition-opacity"
            >
              <div className="min-w-0">
                <div
                  className="text-sm font-mono font-medium theme-accent"
                >
                  #{formatBlockNum(b.number)}
                </div>
                <div
                  className="text-[11px] mt-0.5 theme-text-muted"
                >
                  {ago(b.timestamp)} · {b.transactionCount} txs
                </div>
              </div>
              <div
                className="text-[11px] font-mono tabular-nums text-right theme-text-secondary"
              >
                <div>{gasPctLabel(b.gasUsed, b.gasLimit)}</div>
                <div
                  className="text-[10px] theme-text-muted"
                >
                  gas used
                </div>
              </div>
            </ExplorerLink>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Recent transactions card                                           */
/* ------------------------------------------------------------------ */

function TxsCard({
  txs,
  loading,
  onNavigate,
}: {
  txs: RecentTx[];
  loading: boolean;
  onNavigate: Props["onNavigate"];
}) {
  const symbol = chainSymbol(useActiveChainId());
  return (
    <div
      className="card theme-card-bg"
    >
      <CardHeader title="Latest transactions" icon="heroicons:arrow-path" />
      {loading && txs.length === 0 ? (
        <Skeleton rows={6} />
      ) : (
        <ul>
          {txs.map((t) => (
            <li
              key={t.hash}
              className="bs-b-muted flex items-center justify-between gap-row px-4 py-2.5 hover:opacity-80 transition-opacity relative"
            >
            <ExplorerLink
              target={{ type: "tx", value: t.hash }}
              onNavigate={onNavigate}
              className="flex items-center justify-between gap-row flex-1 min-w-0 cursor-pointer"
            >
              <div className="min-w-0 flex-1">
                <div
                  className="text-xs font-mono truncate theme-accent"
                >
                  {shortHash(t.hash)}
                </div>
                <div
                  className="text-[11px] mt-0.5 truncate theme-text-muted"
                >
                  {t.methodName ? `${t.methodName}()` : t.methodId || "transfer"}
                </div>
                <div className="mt-0.5">
                  <TxGasInfo
                    type={t.type}
                    gasPrice={t.gasPrice}
                    maxFeePerGas={t.maxFeePerGas}
                    maxPriorityFeePerGas={t.maxPriorityFeePerGas}
                  />
                </div>
              </div>
              <div
                className="text-[11px] font-mono tabular-nums text-right shrink-0 theme-text-secondary"
              >
                <div>{formatPls(t.value)} {symbol}</div>
                <div
                  className="text-[10px] theme-text-muted"
                >
                  {ago(t.timestamp)}
                </div>
              </div>
            </ExplorerLink>
              <TxRowActions hash={t.hash} contractAddress={t.to} compact />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Small reusable bits                                                */
/* ------------------------------------------------------------------ */

function CardHeader({ title, icon }: { title: string; icon: string }) {
  return (
    <div
      className="bs-b-muted flex items-center gap-inline px-4 py-2.5 theme-text-secondary"
    >
      <Icon icon={icon} className="w-4 h-4" />
      <h3 className="text-xs font-semibold uppercase tracking-widest">
        {title}
      </h3>
    </div>
  );
}

function Skeleton({ rows }: { rows: number }) {
  return (
    <div className="p-4 space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="h-8 theme-tertiary-bg"
          style={{ opacity: 0.4 }}
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Formatters                                                         */
/* ------------------------------------------------------------------ */

function formatBlockNum(decimal: string): string {
  // Add thousands separator on the decimal block number.
  return decimal.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function formatGwei(weiDecimal: string): string {
  // wei → gwei (decimals 9), exact: scale + group, no float.
  try {
    const gwei = formatUnits(BigInt(weiDecimal), 9);
    return subscriptSmallString(gwei) ?? groupDecimalString(gwei, 2);
  } catch {
    return weiDecimal;
  }
}

const ONE_MILLION_PLS = 1_000_000n * 10n ** 18n;

function formatPls(weiDecimal: string): string {
  try {
    const wei = BigInt(weiDecimal);
    if (wei === 0n) return "0";
    // Compact millions: scale by 10^24 (1e6 PLS) and group to 2 decimals.
    if (wei > ONE_MILLION_PLS) {
      return `${groupDecimalString(formatUnits(wei, 24), 2)}M`;
    }
    const pls = formatEther(wei);
    return subscriptSmallString(pls) ?? groupDecimalString(pls, 4);
  } catch {
    return weiDecimal;
  }
}

function gasPctLabel(used: string, limit: string): string {
  try {
    const u = BigInt(used);
    const l = BigInt(limit);
    if (l === 0n) return "—";
    return `${(u * 100n) / l}%`; // integer percent, exact in bigint
  } catch {
    return "—";
  }
}

function ago(unixSeconds: number): string {
  const delta = Math.max(0, Math.floor(Date.now() / 1000) - unixSeconds);
  if (delta < 5) return "just now";
  if (delta < 60) return `${delta}s ago`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
  return `${Math.floor(delta / 86400)}d ago`;
}

