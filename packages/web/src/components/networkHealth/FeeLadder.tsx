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

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]!;
}

/** Gwei with thousands separators and scale-appropriate precision. */
function fmtGwei(n: number): string {
  const d = n >= 100 ? 0 : n >= 1 ? 2 : 4;
  return n.toLocaleString(undefined, { maximumFractionDigits: d });
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

  // Percentile-clamped scale so a few huge tips don't compress everyone else.
  // Burn is a constant block on top; tips hang DOWN from its lower edge.
  const tips = txs.map((t) => Math.max(0, t.tipGwei));
  const posTips = tips.filter((t) => t > 0);
  const clampTip = posTips.length ? percentile(posTips, 0.95) : 0;
  const scale = PLOT_H / (baseFeeGwei + clampTip || 1);
  const burnH = baseFeeGwei > 0 ? baseFeeGwei * scale : 0;
  const lineY = PAD_T + burnH;

  return (
    <>
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
        {/* burned base fee — one solid block on top, constant for every tx */}
        {burnH > 0 && (
          <rect x={PAD_L} y={PAD_T} width={plotW} height={burnH} fill={BURN_COLOR} />
        )}
        {/* fixed line: bottom of the burn block; tips hang below it */}
        <line x1={PAD_L} y1={lineY} x2={W - PAD_R} y2={lineY} stroke="var(--color-border-default)" strokeWidth={1} />
        <line x1={PAD_L} y1={BASELINE} x2={W - PAD_R} y2={BASELINE} stroke="var(--color-border-muted)" strokeWidth={1} />
        {txs.map((t, i) => {
          const x = cumX[i]!;
          const w = Math.max(0.5, cumX[i + 1]! - x - 0.3);
          const clipped = t.tipGwei > clampTip;
          const depth = Math.min(t.tipGwei, clampTip) * scale;
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
              {/* tip kept by the validator — a stalactite hanging from the line */}
              {depth > 0 && (
                <rect x={x} y={lineY} width={w} height={depth} fill={KEEP_COLOR} />
              )}
              {/* outlier: tip exceeds the 95th-pct scale, clipped at the baseline */}
              {clipped && (
                <rect x={x} y={BASELINE - 2} width={w} height={2} fill="var(--color-accent)" />
              )}
              {/* full-height hit target so every bar (incl. zero-tip) is hoverable */}
              <rect x={x} y={PAD_T} width={w} height={BASELINE - PAD_T} fill="transparent" />
            </g>
          );
        })}
        {burnH > 9 && (
          <text x={PAD_L + 4} y={PAD_T + 11} fontSize={11} fill="var(--color-bg-primary)">
            burned {fmtGwei(baseFeeGwei)} gwei
          </text>
        )}
        <text x={PAD_L} y={H - 6} fontSize={11} fill="var(--color-text-muted)">
          top of block
        </text>
        <text x={W - PAD_R} y={H - 6} fontSize={11} textAnchor="end" fill="var(--color-text-muted)">
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
      <div className="text-xs theme-text-muted">
        solid block = base fee burned (constant) · stalactites = tip kept by the
        validator, clamped at 95th pct (≤ {fmtGwei(clampTip)} gwei; accent ticks =
        outliers) · width = gas
      </div>
    </>
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
      <div className="theme-text-secondary theme-mono">
        {short(tx.sender)} → {tx.to === null ? "contract creation" : short(tx.to)}
      </div>
      <div
        className="grid gap-x-inline gap-y-tight"
        style={{ gridTemplateColumns: "auto 1fr" }}
      >
        <span className="theme-text-muted">value</span>
        <span className="theme-mono theme-text text-right">
          {formatAmountDisplay(tx.value, 18, { maxFractionDigits: 4, symbol })}
        </span>
        <span className="theme-text-muted">method</span>
        <span className="theme-mono theme-text text-right">{tx.methodId || "transfer"}</span>
        <span className="theme-text-muted">gas</span>
        <span className="theme-mono theme-text text-right">
          {Number(gas).toLocaleString()} · {pct(gasShare)}
        </span>
        <span className="theme-text-muted">tip</span>
        <span className="theme-mono text-right" style={{ color: KEEP_COLOR }}>
          {fmtGwei(tx.tipGwei)} gwei
        </span>
        <span className="theme-text-muted">burned</span>
        <span className="theme-mono text-right" style={{ color: BURN_COLOR }}>
          {fmtGwei(baseFeeGwei)} gwei
        </span>
        <span className="theme-text-muted">cost</span>
        <span className="theme-mono theme-text text-right">{fmtGwei(cost)} gwei</span>
        <span className="theme-text-muted">order</span>
        <span className="theme-text text-right">{tx.status}</span>
      </div>
    </div>
  );
}
