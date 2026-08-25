/**
 * Explorer home — the landing surface inside /explorer when no specific
 * tx/address/block has been selected.
 *
 * Three queries, all Bundle 1 of EXPLORER_API_SPEC:
 *   stats + heading  → /api/latest/summary
 *   recent blocks    → /api/blocks
 *   recent txs       → /api/txs/recent
 *
 * All three refetch every 5s. The server memoizes for 3s, so this is cheap.
 * The gas strip runs its own query inside `GasOracleWidget`.
 *
 * `onNavigate` is gone from the two lists. They were passing a callback down
 * to build a click handler; `EntityRow` takes an `href` and renders a real
 * `Link`, so a row is now a link you can middle-click, copy, and open in a new
 * tab — which a div with an onClick never was.
 */

import { useQuery } from "@tanstack/react-query";
import { Icon } from "@iconify/react";
import {
  fetchLatestSummary,
  fetchRecentBlocks,
  fetchRecentTxs,
} from "../../api/latest";
import { GasOracleWidget } from "./GasOracleWidget";
import { useActiveChainId } from "../../lib/activeChain";
import { chainById } from "../../lib/chains";
import { StatsRow } from "./ExplorerHome/StatsRow";
import { BlocksList } from "./ExplorerHome/BlocksList";
import { TxList } from "./ExplorerHome/TxList";
import { FeedStatus, feedHealth } from "./ExplorerHome/FeedStatus";

const REFETCH_MS = 5_000;

export default function ExplorerHome() {
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

  // Derived in render from the three queries — never stored, never a ref.
  // Reading the clock here is safe: a failing query still refetches on the
  // same 5s interval, so the age keeps advancing while the backend is down,
  // which is exactly when it matters.
  const health = feedHealth(
    [summary, blocks, txs].map((q) => ({
      isError: q.isError,
      hasData: q.data !== undefined,
      dataUpdatedAt: q.dataUpdatedAt,
    })),
    Date.now(),
  );

  const chain = chainById(chainId);

  return (
    <div className="space-y-stack">
      {/*
       * Name the chain. This page reads one chain's blocks and one chain's
       * transactions and never said which, on a product that serves four —
       * the same defect the all-chain views had, where a page described a
       * subject it declined to identify.
       */}
      <header className="flex flex-wrap items-baseline justify-between gap-inline p-2 shadow-[0_0_0_1px_var(--color-border-default)]">
        <div className="flex items-baseline gap-inline">
          <h2 className="text-sm theme-text">{chain?.name ?? `Chain ${chainId}`}</h2>
          {chain?.testnet === true && (
            <span className="text-xs uppercase tracking-wide theme-text-muted">
              testnet
            </span>
          )}
        </div>
        <FeedStatus health={health} />
      </header>

      <StatsRow summary={summary.data} loading={summary.isPending} />

      <GasOracleWidget />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-row">
        <section className="space-y-stack min-w-0">
          <SectionHeading icon="heroicons:cube" title="Latest blocks" />
          <BlocksList
            blocks={blocks.data?.blocks ?? []}
            chainId={chainId}
            loading={blocks.isPending}
          />
        </section>
        <section className="space-y-stack min-w-0">
          <SectionHeading icon="heroicons:arrow-path" title="Latest transactions" />
          <TxList
            txs={txs.data?.transactions ?? []}
            chainId={chainId}
            loading={txs.isPending}
          />
        </section>
      </div>
    </div>
  );
}

function SectionHeading({ icon, title }: { icon: string; title: string }) {
  return (
    <div className="flex items-center gap-inline theme-text-secondary">
      <Icon icon={icon} className="w-4 h-4 shrink-0" aria-hidden="true" />
      <h3 className="text-xs font-semibold uppercase tracking-widest">{title}</h3>
    </div>
  );
}
