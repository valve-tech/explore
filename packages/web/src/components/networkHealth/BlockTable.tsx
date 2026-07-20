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
import { pct, shareOf, timeAgo } from "./format";

const COLS = 6;

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
 * Per-block breakdown, newest first. Click a row to expand its fee ladder —
 * the per-tx tip-by-position graph with queue-jumps highlighted.
 */
export function BlockTable({ blocks }: { blocks: BlockStats[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm theme-mono">
        <thead>
          <tr className="text-xs uppercase tracking-wide theme-text-muted">
            <Th>Block</Th>
            <Th>Age</Th>
            <Th right>Txns</Th>
            <Th right>Base fee</Th>
            <Th>Gas used (width) · legacy / modern · burned</Th>
            <Th right>Out of order</Th>
          </tr>
        </thead>
        <tbody>
          {blocks.map((b) => (
            <BlockRow
              key={b.number}
              block={b}
              expanded={expanded === b.number}
              onToggle={() =>
                setExpanded((cur) => (cur === b.number ? null : b.number))
              }
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BlockRow({
  block,
  expanded,
  onToggle,
}: {
  block: BlockStats;
  expanded: boolean;
  onToggle: () => void;
}) {
  // Gas composition is meaningful for every block (unlike queue-jumps, which
  // most blocks don't have) — so the bar always renders. Modern slice carries a
  // burn hatch: how much of modern txs' fees were destroyed as base fee.
  const legacyBurned = shareOf(block.burnedByType.legacy, block.paidByType.legacy);
  const modernBurned = shareOf(block.burnedByType.modern, block.paidByType.modern);
  const compTip = `legacy ${pct(block.legacyGasShare, 0)} gas (${pct(
    legacyBurned,
    0,
  )} burned) · modern ${pct(1 - block.legacyGasShare, 0)} gas (${pct(
    modernBurned,
    0,
  )} burned)`;
  const chainId = useActiveChainId();
  const q = chainId === DEFAULT_CHAIN_ID ? "" : `?chainid=${chainId}`;
  // Bar LENGTH = block fullness (gasUsed / gasLimit), so a fuller block draws a
  // wider bar; the legacy/modern split lives within that filled length.
  const fullness = blockFullness(block.gasUsed, block.gasLimit);
  const gasTip = `${pct(fullness, 0)} full · ${compTip}`;
  return (
    <>
      <tr
        className="bs-t-muted cursor-pointer hover:bg-[color:var(--color-bg-tertiary)]"
        onClick={onToggle}
      >
        <Td>
          <span className="inline-flex items-center gap-tight">
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
        </Td>
        <Td muted><Age ts={block.timestamp} /></Td>
        <Td right>{block.txCount}</Td>
        <Td right>{formatGwei(block.baseFeePerGas) ?? "—"}</Td>
        <Td>
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
        </Td>
        <Td right>
          <InversionCell rate={block.priorityInversionRate} />
        </Td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={COLS} className="bs-t-muted">
            <FeeLadder blockNumber={block.number} />
          </td>
        </tr>
      )}
    </>
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

function Th({
  children,
  right,
}: {
  children?: React.ReactNode;
  right?: boolean;
}) {
  return (
    <th className={`p-2 font-normal ${right ? "text-right" : "text-left"}`}>
      {children}
    </th>
  );
}

function Td({
  children,
  right,
  muted,
}: {
  children: React.ReactNode;
  right?: boolean;
  muted?: boolean;
}) {
  return (
    <td
      className={`p-2 ${right ? "text-right" : "text-left"} ${
        muted ? "theme-text-secondary" : "theme-text"
      }`}
    >
      {children}
    </td>
  );
}
