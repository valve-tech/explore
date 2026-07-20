import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { Icon } from "@iconify/react";
import type { Workspace } from "../../lib/workspace/types";
import { fetchHoldings, type HoldingsResult } from "../../api/portfolio";
import { truncateAddr } from "../explorer/format";
import { formatAmountDisplay } from "../../lib/format/tokenAmount";
import { chainById, DEFAULT_CHAIN_ID } from "../../lib/chains";
import { TokenImage } from "../primitives/TokenImage";
import { MiddleTruncate } from "../primitives/MiddleTruncate";
import { DataTable, type Column } from "../primitives/DataTable";

/** Native coin decimals (wei → coin). */
const NATIVE_DECIMALS = 18;

/**
 * Portfolio rollup for a workspace: aggregates token holdings across every
 * address item, queried on the active chain. Token balances come from the
 * substreams-backed gateway (via /api/portfolio/holdings); each address is one
 * query, fanned out with useQueries.
 *
 * No USD in v1 — so this is amounts only: a combined per-token table (summed
 * across addresses) + per-address native balance, NOT a cross-asset
 * allocation chart (that needs prices — the XYK price layer). When the chain's
 * gateway isn't live yet, every result is `indexed: false` and we say so plainly.
 */

interface AggToken {
  /** lowercase token contract address — key + logo + dedupe. */
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  /** summed raw balance across addresses. */
  total: bigint;
  /** count of addresses holding a nonzero amount. */
  holders: number;
}

export function PortfolioPanel({
  workspace,
  chainId = DEFAULT_CHAIN_ID,
}: {
  workspace: Workspace;
  /** Chain to query holdings on — the active chain from the route. */
  chainId?: number;
}) {
  const addresses = useMemo(
    () =>
      workspace.items
        .filter((it) => it.kind === "address")
        .map((it) => it.value.toLowerCase()),
    [workspace.items],
  );

  const results = useQueries({
    queries: addresses.map((address) => ({
      queryKey: ["portfolio-holdings", chainId, address],
      queryFn: () => fetchHoldings(address, chainId),
      staleTime: 60 * 1000,
    })),
  });

  if (addresses.length === 0) return null;

  const loading = results.some((r) => r.isLoading);
  const loaded = results.filter((r) => r.data).map((r) => r.data as HoldingsResult);
  const anyIndexed = loaded.some((r) => r.indexed);
  const chainName = chainById(chainId)?.name ?? `chain ${chainId}`;

  const aggregated = aggregate(loaded);

  return (
    <div className="card p-4 mb-4">
      <div className="flex items-center gap-inline mb-3">
        <Icon icon="heroicons:wallet" className="w-4 h-4 theme-accent" />
        <h2 className="text-sm font-semibold theme-text">Portfolio</h2>
        <span className="text-[11px] theme-text-muted">
          {addresses.length} {addresses.length === 1 ? "address" : "addresses"} · {chainName}
        </span>
      </div>

      {loading && loaded.length === 0 ? (
        <div className="text-xs theme-text-muted">Loading holdings…</div>
      ) : !anyIndexed ? (
        <div className="text-xs theme-text-muted leading-relaxed">
          Token holdings aren&apos;t indexed for this chain yet — showing native
          balances only. (Awaiting the substreams gateway.)
          <NativeList results={loaded} addresses={addresses} />
        </div>
      ) : aggregated.length === 0 ? (
        <div className="text-xs theme-text-muted">
          No token holdings across these addresses.
          <NativeList results={loaded} addresses={addresses} />
        </div>
      ) : (
        <>
          <HoldingsTable rows={aggregated} chainId={chainId} />
          <NativeList results={loaded} addresses={addresses} />
        </>
      )}
    </div>
  );
}

function aggregate(results: HoldingsResult[]): AggToken[] {
  const byToken = new Map<string, AggToken>();
  for (const res of results) {
    for (const h of res.holdings) {
      const key = h.tokenAddress.toLowerCase();
      const existing = byToken.get(key);
      const amount = safeBig(h.balance);
      if (existing) {
        existing.total += amount;
        existing.holders += 1;
      } else {
        byToken.set(key, {
          address: key,
          // Falsy (empty string) when the token has no symbol — HoldingsTable
          // falls back to a searchable MiddleTruncate of the contract address
          // at render time, rather than pre-truncating it here with a
          // JS-sliced string that can never be found by its full value.
          symbol: h.symbol,
          name: h.name,
          decimals: h.decimals,
          total: amount,
          holders: 1,
        });
      }
    }
  }
  // Order by human amount descending, compared EXACTLY in bigint across
  // differing decimals (a/10^da vs b/10^db ⇔ a·10^db vs b·10^da). No float.
  return [...byToken.values()].sort((a, b) => {
    const left = a.total * 10n ** BigInt(b.decimals);
    const right = b.total * 10n ** BigInt(a.decimals);
    return left < right ? 1 : left > right ? -1 : 0;
  });
}

function HoldingsTable({ rows, chainId }: { rows: AggToken[]; chainId: number }) {
  const columns: Column<AggToken>[] = [
    {
      key: "token",
      header: "Token",
      primary: true,
      cell: (t) => (
        <span className="flex items-center gap-inline">
          <TokenImage address={t.address} chainId={chainId} symbol={t.symbol} size={16} />
          <span className="font-medium">
            {t.symbol || (
              <MiddleTruncate value={t.address} className="font-mono text-xs theme-text-secondary" />
            )}
          </span>
          {t.name && <span className="theme-text-muted">{t.name}</span>}
        </span>
      ),
    },
    {
      key: "total",
      header: "Total held",
      cell: (t) => (
        <div className="text-right font-mono">
          {formatAmountDisplay(t.total, t.decimals, { maxFractionDigits: 4 })}
        </div>
      ),
    },
    {
      key: "holders",
      header: "Addresses",
      cell: (t) => <div className="text-right theme-text-secondary">{t.holders}</div>,
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(t) => t.address}
      className="w-full text-xs"
      emptyLabel="No token holdings"
    />
  );
}

function NativeList({
  results,
  addresses,
}: {
  results: HoldingsResult[];
  addresses: string[];
}) {
  const byAddr = new Map(results.map((r) => [r.address.toLowerCase(), r]));
  return (
    <ul className="mt-3 space-y-1">
      {addresses.map((addr) => {
        const r = byAddr.get(addr);
        const native = r?.native;
        return (
          <li key={addr} className="flex items-center justify-between text-[11px]">
            <span className="font-mono theme-text-secondary">{truncateAddr(addr)}</span>
            <span className="font-mono theme-text-muted">
              {native
                ? formatAmountDisplay(native.balance, NATIVE_DECIMALS, {
                    maxFractionDigits: 4,
                    symbol: native.symbol,
                  })
                : "—"}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

// --- pure helpers ---

function safeBig(s: string): bigint {
  try {
    return BigInt(s);
  } catch {
    return 0n;
  }
}
