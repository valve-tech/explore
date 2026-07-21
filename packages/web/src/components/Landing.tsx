/**
 * Landing hub at `/`. A bento hero — brand + search over a live, flowing pulse
 * line — sits above a row of ticking chain stats (latest block, base fee, mempool),
 * with the feature catalogue grouped by intent below and the recent rail last.
 * The search recognizes a pasted tx / address / block / selector and jumps
 * straight to it. The chain selector next to the search input scopes results
 * to a specific chain or runs across every registered chain.
 */

import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Icon } from "@iconify/react";
import { NAV_GROUPS, type NavItem } from "../lib/navGroups";
import { classifyInput, routeForInput } from "../lib/entityInput";
import { resolveEntity } from "../api/resolve";
import { fetchLatestSummary } from "../api/latest";
import { fetchPending } from "../api/mempool";
import { formatGwei } from "../lib/format/tokenAmount";
import { RecentRail } from "./RecentRail";
import { ChainSelector, ChainGlyph } from "./ChainSelector";
import { ExploreLogo } from "./AppShell/ExploreLogo";
import {
  ALL_CHAINS,
  DEFAULT_CHAIN_ID,
  chainById,
  type ChainSelection,
} from "../lib/chains";

export default function Landing() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [hint, setHint] = useState(false);
  const [busy, setBusy] = useState(false);
  const [chain, setChain] = useState<ChainSelection>(ALL_CHAINS);

  const submit = () => {
    void run();
  };

  // A specific chain selected → route straight there. "All chains" (the
  // default) locates a pasted tx/address across every registered chain first,
  // then routes to the chain it lives on — so a hash on chain 1 doesn't
  // silently open the default chain and read as "not found". Blocks/selectors
  // aren't chain-located; they route bare (default chain).
  const run = async () => {
    const kind = classifyInput(query);
    if (!kind) {
      if (query.trim() !== "") setHint(true);
      return;
    }
    setHint(false);
    if (chain !== ALL_CHAINS) {
      navigate(routeForInput(query, chain)!);
      return;
    }
    if (kind === "tx" || kind === "address") {
      setBusy(true);
      try {
        const { matches } = await resolveEntity(query.trim());
        // matches are ascending by chainId; pick the first (a tx has exactly
        // one). Found nowhere → route bare so the default view shows not-found.
        navigate(routeForInput(query, matches[0]?.chainId ?? ALL_CHAINS)!);
      } catch {
        navigate(routeForInput(query, ALL_CHAINS)!);
      } finally {
        setBusy(false);
      }
      return;
    }
    navigate(routeForInput(query, ALL_CHAINS)!);
  };

  return (
    <div className="max-w-6xl mx-auto space-y-section py-2">
      {/* Full-width hero (brand + search), with live chain stats in a row below */}
      <div className="space-y-row">
        <HeroTile
          query={query}
          setQuery={(v) => {
            setQuery(v);
            if (hint) setHint(false);
          }}
          onSubmit={submit}
          hint={hint}
          busy={busy}
          chain={chain}
          onChainChange={setChain}
        />
        <LiveStats chain={chain} />
      </div>

      {/* Feature catalogue, grouped by intent */}
      {NAV_GROUPS.map((group) => (
        <section key={group.label} className="space-y-row">
          <div className="flex items-baseline gap-row">
            <h2 className="text-sm font-semibold uppercase tracking-widest theme-text">
              {group.label}
            </h2>
            <span className="text-xs theme-text-muted">
              {group.hint}
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-row">
            {group.items.map((item) => (
              <FeatureCard key={item.to} item={item} />
            ))}
          </div>
        </section>
      ))}

      <section className="space-y-row max-w-md">
        <h2 className="text-sm font-semibold uppercase tracking-widest theme-text">
          Jump back in
        </h2>
        <RecentRail />
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Hero                                                               */
/* ------------------------------------------------------------------ */

function HeroTile({
  query,
  setQuery,
  onSubmit,
  hint,
  busy,
  chain,
  onChainChange,
}: {
  query: string;
  setQuery: (v: string) => void;
  onSubmit: () => void;
  hint: boolean;
  busy: boolean;
  chain: ChainSelection;
  onChainChange: (next: ChainSelection) => void;
}) {
  return (
    <div
      className="card relative flex flex-col justify-between p-4"
      style={{ minHeight: 240 }}
    >
      {/* Decorations live in their own clipped layer so the card itself doesn't
          need overflow-hidden — which was clipping the ChainSelector dropdown
          that opens below the search row. */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {/* breathing accent glow, top-right */}
        <div
          className="glow-pulse absolute"
          style={{
            top: -90,
            right: -90,
            width: 260,
            height: 260,
            background:
              "radial-gradient(circle, var(--color-accent) 0%, transparent 70%)",
          }}
        />
        {/* flowing pulse line, bottom edge */}
        <PulseLine />
      </div>

      <div className="relative space-y-tight">
        <div className="flex items-center gap-inline">
          <ExploreLogo className="w-8 h-8 theme-text" />
          <span className="text-[10px] uppercase tracking-widest font-semibold px-2 py-0.5 theme-accent-bg theme-accent">
            by Valve City · multichain
          </span>
        </div>
        <h1 className="text-3xl font-semibold theme-text">
          Explore
        </h1>
        <p className="text-sm max-w-xl theme-text-secondary">
          Multichain trace, simulate, debug — the explorer your terminal
          deserves. Block exploration, fork simulation, opcode-level
          debugging, and verification across the L1s and L2s worth caring
          about.
        </p>
      </div>

      <div className="relative space-y-tight pt-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
          className="flex items-stretch gap-inline"
        >
          <ChainSelector value={chain} onChange={onChainChange} variant="full" />
          <div
            className="flex-1 flex items-center gap-inline px-3 h-11 theme-input-bg bs-in"
          >
            <Icon
              icon="heroicons:magnifying-glass"
              className="w-4 h-4 shrink-0 theme-text-muted"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Paste a tx hash, address, block, or 4byte selector…"
              className="bare-input flex-1 bg-transparent outline-none text-sm font-mono theme-text"
            />
            <kbd className="hidden sm:block text-[10px] px-1.5 py-0.5 font-mono shrink-0 theme-tertiary-bg theme-text-secondary">
              ⌘K
            </kbd>
          </div>
          <button
            type="submit"
            disabled={busy}
            className="px-5 text-sm font-medium shrink-0 theme-accent-solid text-white disabled:opacity-60"
          >
            {busy ? "…" : "Go"}
          </button>
        </form>
        {hint && (
          <p className="text-xs theme-warning">
            Unrecognized — paste a tx hash (66 chars), address (42), block
            number, or 4byte selector.
          </p>
        )}
      </div>
    </div>
  );
}

function PulseLine() {
  // A heartbeat path tiled every 120px; the SVG is wider than the tile and
  // translates by exactly one tile, so .ekg-flow loops seamlessly.
  const seg = 120;
  const reps = 18;
  let d = "M0 28";
  for (let i = 0; i < reps; i++) {
    const x = i * seg;
    d += ` H${x + 36} l7 -18 l6 32 l7 -14 H${x + seg}`;
  }
  return (
    <div className="pointer-events-none absolute left-0 right-0 bottom-0 h-14 overflow-hidden">
      <svg
        className="ekg-flow"
        width={reps * seg}
        height={56}
        viewBox={`0 0 ${reps * seg} 56`}
        fill="none"
        style={{ opacity: 0.18 }}
      >
        <path d={d} stroke="var(--color-accent)" strokeWidth={2} fill="none" />
      </svg>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Live stats                                                         */
/* ------------------------------------------------------------------ */

function LiveStats({ chain }: { chain: ChainSelection }) {
  // "All chains" has no single live source yet, so the stats default to
  // PulseChain; picking a specific chain focuses the stats on it.
  const chainId = chain === ALL_CHAINS ? DEFAULT_CHAIN_ID : chain;
  const chainInfo = chainById(chainId);

  const summary = useQuery({
    queryKey: ["landing", "summary", chainId],
    queryFn: () => fetchLatestSummary(chainId),
    refetchInterval: 5_000,
    staleTime: 0,
  });
  const mempool = useQuery({
    queryKey: ["landing", "mempool", chainId],
    queryFn: () => fetchPending(chainId),
    refetchInterval: 5_000,
    staleTime: 0,
  });

  const block = summary.data?.latestBlock;
  const baseFee = summary.data?.gasPrice.baseFeePerGas;

  return (
    <div className="space-y-row">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-semibold theme-text-muted">
        <ChainGlyph chainId={chainId} />
        {chainInfo?.name ?? `Chain ${chainId}`}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-row">
      <StatTile
        icon="heroicons:cube"
        label="Latest block"
        value={block ? `#${commas(block.number)}` : "—"}
        sub={block ? `${block.transactionCount} txs` : "loading…"}
        live
        to="/explorer"
      />
      <StatTile
        icon="heroicons:fire"
        label="Base fee"
        value={baseFee ? gwei(baseFee) : "—"}
        sub="gwei"
        to="/explorer"
      />
      <StatTile
        icon="heroicons:queue-list"
        label="Mempool"
        value={mempool.data ? commasNum(mempool.data.pendingCount) : "—"}
        sub="pending"
        live
        to="/mempool"
      />
      </div>
    </div>
  );
}

function StatTile({
  icon,
  label,
  value,
  sub,
  to,
  live = false,
}: {
  icon: string;
  label: string;
  value: string;
  sub: string;
  to: string;
  live?: boolean;
}) {
  return (
    <Link
      to={to}
      className="card p-2 sm:p-4 flex flex-col justify-between transition-opacity hover:opacity-90"
      style={{ textDecoration: "none", minHeight: 72 }}
    >
      <div className="flex items-center gap-tight text-[10px] uppercase tracking-widest theme-text-muted">
        <Icon icon={icon} className="w-3 h-3" />
        {label}
        {live && (
          <span className="glow-pulse ml-auto w-1.5 h-1.5 theme-success-bg" />
        )}
      </div>
      <div className="font-mono text-2xl font-semibold tabular-nums mt-1 theme-text">
        {value}
      </div>
      <div className="text-[11px] theme-text-muted">
        {sub}
      </div>
    </Link>
  );
}

/* ------------------------------------------------------------------ */
/* Feature card                                                       */
/* ------------------------------------------------------------------ */

function FeatureCard({ item }: { item: NavItem }) {
  return (
    <Link
      to={item.to}
      className="group card p-2 sm:p-4 flex items-start gap-row transition-all hover:-translate-y-px"
      style={{ textDecoration: "none" }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow =
          "0 0 0 1px var(--color-border-default), inset 2px 0 0 0 var(--color-accent)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = "";
      }}
    >
      <span className="shrink-0 flex items-center justify-center w-9 h-9 theme-accent-bg theme-accent">
        <Icon icon={item.icon} className="w-5 h-5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-tight">
          <span className="text-sm font-semibold theme-text">
            {item.label}
          </span>
          <Icon
            icon="heroicons:arrow-right"
            className="w-3.5 h-3.5 opacity-0 -translate-x-1 transition-all group-hover:opacity-100 group-hover:translate-x-0 theme-accent"
          />
        </div>
        <div className="text-xs mt-0.5 theme-text-muted">
          {item.desc}
        </div>
      </div>
    </Link>
  );
}

/* ------------------------------------------------------------------ */
/* Bits                                                               */
/* ------------------------------------------------------------------ */

function commas(decimal: string): string {
  return decimal.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function commasNum(n: number): string {
  return n.toLocaleString();
}

function gwei(wei: string): string {
  // Exact wei→gwei (formatUnits + grouping), no Number()/1e9.
  return formatGwei(wei, 2) ?? "—";
}

