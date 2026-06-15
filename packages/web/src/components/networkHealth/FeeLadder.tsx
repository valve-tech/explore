import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useBlockLadder } from "../../hooks/useNetworkHealth";
import type { BlockLadder, LadderTx } from "../../api/networkHealth";
import { formatAmountDisplay } from "../../lib/format/tokenAmount";
import { chainSymbol } from "../../lib/chains";
import { useActiveChainId } from "../../lib/activeChain";
import { pct, shareOf } from "./format";

/**
 * Per-block fee ladder — a single unified linear stacked graph.
 *
 * Each tx is one vertical bar growing UP from the baseline. The bottom segment
 * (green) is the tip the validator KEEPS (height ∝ tipGwei); the top segment
 * (red) is the base fee BURNED (height ∝ baseFeeGwei, constant for every tx).
 * Total bar height = the user's effective gas price (cost/gas). Bar width is
 * proportional to gasUsed, so x is cumulative block gas.
 *
 * Linear y means a single big-tip outlier compresses everyone else — that's the
 * accepted tradeoff; we show the full range honestly rather than log-warping it.
 */

const BURN_COLOR = "var(--color-danger)";
const KEEP_COLOR = "var(--color-success)";

const W = 1000;
const H = 280;
const PAD_L = 10;
const PAD_R = 10;
const PAD_T = 14;
const PAD_B = 26;
const PLOT_H = H - PAD_T - PAD_B;
const BASELINE = PAD_T + PLOT_H;

function safeGwei(wei: string): number {
  try {
    return Number(BigInt(wei)) / 1e9;
  } catch {
    return 0;
  }
}

/** Cumulative-gas x positions (length n+1): bar i spans [cumX[i], cumX[i+1]]. */
function gasLayout(gas: bigint[], plotW: number): number[] {
  const total = gas.reduce((a, b) => a + b, 0n);
  const out: number[] = [];
  let cum = 0n;
  for (let i = 0; i < gas.length; i += 1) {
    out.push(
      total > 0n
        ? PAD_L + (Number((cum * 1_000_000n) / total) / 1_000_000) * plotW
        : PAD_L + (i / gas.length) * plotW,
    );
    cum += gas[i]!;
  }
  out.push(PAD_L + plotW);
  return out;
}

function short(addr: string | null): string {
  if (!addr) return "—";
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

export function FeeLadder({ blockNumber }: { blockNumber: string }) {
  const { data, isPending, isError, error } = useBlockLadder(blockNumber);

  if (isPending) {
    return (
      <div className="flex items-center justify-center p-4 gap-inline">
        <div className="spinner" />
        <span className="text-xs theme-text-secondary">Loading block {blockNumber}…</span>
      </div>
    );
  }
  if (isError) {
    return (
      <div className="p-4 text-xs theme-danger">
        Couldn't load block: {error instanceof Error ? error.message : "error"}
      </div>
    );
  }
  if (data.txs.length === 0) {
    return <div className="p-4 text-xs theme-text-muted">No transactions in this block.</div>;
  }

  return (
    <div className="space-y-stack p-4">
      <div className="flex flex-wrap items-center justify-between gap-row">
        <div className="text-xs theme-text-secondary">
          block #{data.number} · {data.txs.length} txs ·{" "}
          <span className="theme-text">{pct(data.priorityInversionRate)}</span> out of
          fee order
        </div>
        <Legend />
      </div>
      <StackedLadder data={data} />
      <div className="text-xs theme-text-muted">
        y = effectiveGasPrice (linear) · bottom = tip kept · top = base fee burned ·
        width = gas · total height = user cost
      </div>
    </div>
  );
}

function Legend() {
  return (
    <div className="flex gap-row text-xs theme-text-muted">
      <span className="flex items-center gap-tight">
        <span className="inline-block h-2 w-2" style={{ backgroundColor: KEEP_COLOR }} />
        kept (tip → validator)
      </span>
      <span className="flex items-center gap-tight">
        <span className="inline-block h-2 w-2" style={{ backgroundColor: BURN_COLOR }} />
        burned (base fee)
      </span>
    </div>
  );
}

function StackedLadder({ data }: { data: BlockLadder }) {
  const navigate = useNavigate();
  const symbol = chainSymbol(useActiveChainId());
  const [hovered, setHovered] = useState<number | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const txs = data.txs;
  const plotW = W - PAD_L - PAD_R;
  const gas = txs.map((t) => {
    try {
      return BigInt(t.gasUsed);
    } catch {
      return 0n;
    }
  });
  const totalGas = gas.reduce((a, b) => a + b, 0n);
  const cumX = gasLayout(gas, plotW);
  const baseFeeGwei = safeGwei(data.baseFeePerGas);

  // Linear scale across the tallest stacked bar (cost = base fee + tip).
  const maxTip = Math.max(0, ...txs.map((t) => t.tipGwei));
  const maxCost = baseFeeGwei + maxTip || 1;
  const yPerGwei = PLOT_H / maxCost;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ height: "auto" }}
        onMouseMove={(e) =>
          setCursor({ x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY })
        }
        onMouseLeave={() => setHovered(null)}
      >
        <line
          x1={PAD_L}
          y1={BASELINE}
          x2={W - PAD_R}
          y2={BASELINE}
          stroke="var(--color-border-muted)"
          strokeWidth={1}
        />
        {txs.map((t, i) => {
          const x = cumX[i]!;
          const w = Math.max(0.5, cumX[i + 1]! - x - 0.3);
          const tipH = t.tipGwei > 0 ? t.tipGwei * yPerGwei : 0;
          const burnH = baseFeeGwei > 0 ? baseFeeGwei * yPerGwei : 0;
          const tipY = BASELINE - tipH;
          const burnY = tipY - burnH;
          return (
            <g
              key={i}
              className="cursor-pointer"
              onMouseEnter={() => setHovered(i)}
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/tx/${t.hash}`);
              }}
            >
              {/* burned base fee (top, constant) */}
              {burnH > 0 && (
                <rect x={x} y={burnY} width={w} height={burnH} fill={BURN_COLOR} />
              )}
              {/* tip kept by validator (bottom) */}
              {tipH > 0 && (
                <rect x={x} y={tipY} width={w} height={tipH} fill={KEEP_COLOR} />
              )}
              {/* invisible full-height hit target so zero-tip bars are hoverable */}
              <rect
                x={x}
                y={PAD_T}
                width={w}
                height={BASELINE - PAD_T}
                fill="transparent"
              />
            </g>
          );
        })}
        <text x={PAD_L} y={PAD_T + 4} fontSize={11} fill="var(--color-text-muted)">
          {maxCost.toFixed(maxCost >= 100 ? 0 : 2)} gwei
        </text>
        <text x={PAD_L} y={H - 6} fontSize={11} fill="var(--color-text-muted)">
          top of block
        </text>
        <text
          x={W - PAD_R}
          y={H - 6}
          fontSize={11}
          textAnchor="end"
          fill="var(--color-text-muted)"
        >
          bottom
        </text>
      </svg>

      {hovered !== null && (
        <TxTooltip
          tx={txs[hovered]!}
          gas={gas[hovered]!}
          totalGas={totalGas}
          baseFeeGwei={baseFeeGwei}
          symbol={symbol}
          cursor={cursor}
        />
      )}
    </div>
  );
}

function TxTooltip({
  tx,
  gas,
  totalGas,
  baseFeeGwei,
  symbol,
  cursor,
}: {
  tx: LadderTx;
  gas: bigint;
  totalGas: bigint;
  baseFeeGwei: number;
  symbol: string;
  cursor: { x: number; y: number };
}) {
  // cursor.x/.y are in the svg's own pixel space, which the relative wrapper
  // matches (svg is w-full). Clamp the card left when near the right edge so it
  // never overflows; flip above-cursor when near the bottom.
  const flipX = cursor.x > W / 2;
  const gasShare = shareOf(gas.toString(), totalGas.toString());
  const cost = baseFeeGwei + tx.tipGwei;

  return (
    <div
      className="card p-2 text-xs space-y-tight pointer-events-none absolute z-50"
      style={{
        left: flipX ? undefined : `${(cursor.x / W) * 100}%`,
        right: flipX ? `${((W - cursor.x) / W) * 100}%` : undefined,
        top: cursor.y > H / 2 ? undefined : `${(cursor.y / H) * 100}%`,
        bottom: cursor.y > H / 2 ? `${((H - cursor.y) / H) * 100}%` : undefined,
        maxWidth: 280,
      }}
    >
      <div className="theme-mono theme-accent">{short(tx.hash)}</div>
      <div className="theme-text-secondary">
        <span className="theme-mono">{short(tx.sender)}</span>
        {" → "}
        <span className="theme-mono">
          {tx.to === null ? "contract creation" : short(tx.to)}
        </span>
      </div>
      <div className="theme-text-secondary">
        value{" "}
        <span className="theme-mono theme-text">
          {formatAmountDisplay(tx.value, 18, { maxFractionDigits: 4, symbol })}
        </span>
      </div>
      <div className="theme-text-secondary">
        method <span className="theme-mono theme-text">{tx.methodId || "transfer"}</span>
      </div>
      <div className="theme-text-secondary">
        gas{" "}
        <span className="theme-mono theme-text">
          {Number(gas).toLocaleString()} ({pct(gasShare)} of block)
        </span>
      </div>
      <div className="theme-text-secondary">
        tip <span className="theme-mono" style={{ color: KEEP_COLOR }}>{tx.tipGwei} gwei</span>
        {" · "}
        burned <span className="theme-mono" style={{ color: BURN_COLOR }}>{baseFeeGwei} gwei</span>
        {" · "}
        cost <span className="theme-mono theme-text">{cost} gwei</span>
      </div>
      <div className="theme-text-muted">{tx.status}</div>
    </div>
  );
}
