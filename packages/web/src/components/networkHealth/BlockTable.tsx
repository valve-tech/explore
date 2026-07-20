import { useState } from "react";
import { Link } from "react-router-dom";
import { Icon } from "@iconify/react";
import type { BlockStats } from "../../api/networkHealth";
import { formatGwei } from "../../lib/format/tokenAmount";
import { useNowSeconds } from "../../hooks/useNow";
import { useActiveChainId } from "../../lib/activeChain";
import { DEFAULT_CHAIN_ID } from "../../lib/chains";
import { SplitBar } from "./SplitBar";
import { FeeLadder } from "./FeeLadder";
import { Tooltip } from "../primitives/Tooltip";
import { DataTable, type Column } from "../primitives/DataTable";
import { pct, shareOf, timeAgo } from "./format";

/** Block fullness in [0,1] = gasUsed / gasLimit (raw-int ratio, not amounts). */
export function blockFullness(gasUsed: string, gasLimit: string): number {
  try {
    const used = BigInt(gasUsed);
    const limit = BigInt(gasLimit);
    return limit > 0n ? Number((used * 10000n) / limit) / 10000 : 0;
  } catch {
    return 0;
  }
}

/**
 * Per-block breakdown, newest first. Click a block's number to expand its fee
 * ladder — the per-tx tip-by-position graph with queue-jumps highlighted.
 *
 * `DataTable` owns row rendering with no per-row click hook and no way to
 * inject a full-width expandable row, so (unlike the old hand-rolled table)
 * the toggle lives on the Block cell alone rather than the whole row, and the
 * expanded ladder renders once below the table rather than nested under the
 * specific row — acceptable because only one block can be expanded at a time.
 */
export function BlockTable({ blocks }: { blocks: BlockStats[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const chainId = useActiveChainId();
  const q = chainId === DEFAULT_CHAIN_ID ? "" : `?chainid=${chainId}`;

  const columns: Column<BlockStats>[] = [
    {
      key: "block",
      header: "Block",
      primary: true,
      cell: (block) => (
        <BlockCell
          block={block}
          expanded={expanded === block.number}
          onToggle={() =>
            setExpanded((cur) => (cur === block.number ? null : block.number))
          }
          q={q}
        />
      ),
    },
    {
      key: "age",
      header: "Age",
      cell: (block) => (
        <span className="theme-text-secondary">
          <Age ts={block.timestamp} />
        </span>
      ),
    },
    {
      key: "txns",
      header: "Txns",
      cell: (block) => <div className="text-right theme-text">{block.txCount}</div>,
    },
    {
      key: "baseFee",
      header: "Base fee",
      cell: (block) => (
        <div className="text-right theme-text">
          {formatGwei(block.baseFeePerGas) ?? "—"}
        </div>
      ),
    },
    {
      key: "gasUsed",
      header: "Gas used (width) · legacy / modern · burned",
      cell: (block) => <GasCell block={block} />,
    },
    {
      key: "inversion",
      header: "Out of order",
      cell: (block) => (
        <div className="text-right">
          <InversionCell rate={block.priorityInversionRate} />
        </div>
      ),
    },
  ];

  return (
    <div className="card overflow-hidden">
      <DataTable
        columns={columns}
        rows={blocks}
        rowKey={(block) => block.number}
        className="w-full text-sm theme-mono"
        emptyLabel="No blocks in this window"
      />
      {expanded && (
        <div className="bs-t-muted">
          <FeeLadder blockNumber={expanded} />
        </div>
      )}
    </div>
  );
}

/** Block number + expand chevron + shareable-page link. Sole click target for
 *  row expansion now that DataTable owns the `<tr>` (no row-level onClick). */
function BlockCell({
  block,
  expanded,
  onToggle,
  q,
}: {
  block: BlockStats;
  expanded: boolean;
  onToggle: () => void;
  q: string;
}) {
  return (
    <span
      className="inline-flex items-center gap-tight cursor-pointer"
      onClick={onToggle}
    >
      <Icon
        icon={expanded ? "heroicons:chevron-down" : "heroicons:chevron-right"}
        className="w-4 h-4 theme-text-muted"
      />
      <span className="theme-accent">#{block.number}</span>
      <Link
        to={`/network-health/block/${block.number}${q}`}
        onClick={(e) => e.stopPropagation()}
        title="Open this block's shareable page"
        className="theme-text-muted hover:theme-text"
      >
        <Icon icon="heroicons:arrow-top-right-on-square" className="w-3.5 h-3.5" />
      </Link>
    </span>
  );
}

function GasCell({ block }: { block: BlockStats }) {
  // Gas composition is meaningful for every block (unlike queue-jumps, which
  // most blocks don't have) — so the bar always renders. Modern slice carries
  // a burn hatch: how much of modern txs' fees were destroyed as base fee.
  const legacyBurned = shareOf(block.burnedByType.legacy, block.paidByType.legacy);
  const modernBurned = shareOf(block.burnedByType.modern, block.paidByType.modern);
  const compTip = `legacy ${pct(block.legacyGasShare, 0)} gas (${pct(
    legacyBurned,
    0,
  )} burned) · modern ${pct(1 - block.legacyGasShare, 0)} gas (${pct(
    modernBurned,
    0,
  )} burned)`;
  // Bar LENGTH = block fullness (gasUsed / gasLimit), so a fuller block draws
  // a wider bar; the legacy/modern split lives within that filled length.
  const fullness = blockFullness(block.gasUsed, block.gasLimit);
  const gasTip = `${pct(fullness, 0)} full · ${compTip}`;
  return (
    <Tooltip label={gasTip}>
      <div className="min-w-32">
        <SplitBar
          legacyFraction={block.legacyGasShare}
          legacyBurnedFraction={legacyBurned}
          modernBurnedFraction={modernBurned}
          fillFraction={fullness}
        />
      </div>
    </Tooltip>
  );
}

/** Live-ticking age — subscribes to the shared 1s clock so only this cell
 *  re-renders each second, never the table or the expanded ladder. */
function Age({ ts }: { ts: number }) {
  const nowSec = useNowSeconds();
  return <>{timeAgo(ts, nowSec * 1000)}</>;
}

function InversionCell({ rate }: { rate: number | null }) {
  if (rate === null) return <span className="theme-text-muted">—</span>;
  // Above ~15% out-of-order is worth a second look; flag it warmly.
  const cls = rate > 0.15 ? "theme-warning" : "theme-text";
  return <span className={cls}>{pct(rate, 0)}</span>;
}
