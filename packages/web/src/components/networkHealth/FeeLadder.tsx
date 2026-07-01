import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useBlockLadder } from "../../hooks/useNetworkHealth";
import type { BlockLadder, LadderTx } from "../../api/networkHealth";
import { formatAmountDisplay } from "../../lib/format/tokenAmount";
import { chainSymbol } from "../../lib/chains";
import { useActiveChainId } from "../../lib/activeChain";
import { pct, shareOf } from "./format";

/**
 * Per-block fee ladder.
 *
 * A constant grey block on top = the base fee BURNED (same for every tx). Below
 * it each tx hangs DOWN as a stalactite whose depth is its tip on a LOG scale —
 * so the whole range shows without clamping. Bar color = tx type (legacy amber /
 * modern purple); a red diagonal hatch marks the txns displaced from fee order —
 * exactly the set behind the block's "% out of fee order". Bar width ∝ gasUsed.
 */

const BURN_COLOR = "var(--color-text-muted)"; // neutral — constant, not the signal
const OOO_COLOR = "var(--color-danger)"; // out of fee order vs the previous tx
// Tx type — same convention as the rest of the page (heatmap, composition bars).
const TYPE_COLORS: Record<LadderTx["type"], string> = {
  legacy: "var(--color-warning)", // type 0/1
  modern: "var(--color-accent)", // type ≥2
};

const W = 1000;
const H = 280;
const PAD_L = 10;
const PAD_R = 10;
const PAD_T = 14;
const PAD_B = 26;
const PLOT_H = H - PAD_T - PAD_B;
const BASELINE = PAD_T + PLOT_H;
const BURN_HEADER_H = 26; // fixed header for the (constant) burned base fee

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

/**
 * Corner-anchor a tooltip from a cursor position given as fractions of the plot
 * [0,1]. It anchors to the cursor's own side so the card grows into the plot,
 * never off-screen: past the horizontal midpoint it hangs from the right edge,
 * past the vertical midpoint from the bottom. Monotonic in both axes — moving
 * the cursor right moves the card right. (The bug this replaces read the hovered
 * bar's local `offsetX`, which reset at every bar boundary, so the card jumped
 * backwards as the cursor swept across.)
 */
export function tooltipPosition(cursor: { x: number; y: number }): {
  left?: string;
  right?: string;
  top?: string;
  bottom?: string;
} {
  const flipX = cursor.x > 0.5;
  const flipY = cursor.y > 0.5;
  return {
    left: flipX ? undefined : `${cursor.x * 100}%`,
    right: flipX ? `${(1 - cursor.x) * 100}%` : undefined,
    top: flipY ? undefined : `${cursor.y * 100}%`,
    bottom: flipY ? `${(1 - cursor.y) * 100}%` : undefined,
  };
}

/** Gwei with thousands separators and scale-appropriate precision. */
function fmtGwei(n: number): string {
  const d = n >= 100 ? 0 : n >= 1 ? 2 : 4;
  return n.toLocaleString(undefined, { maximumFractionDigits: d });
}

/** Signed gwei, e.g. "+0.30" / "−1.40". */
function signedGwei(n: number): string {
  return (n >= 0 ? "+" : "−") + fmtGwei(Math.abs(n));
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
  const items: Array<{ color: string; label: string; hatch?: boolean }> = [
    { color: TYPE_COLORS.legacy, label: "legacy tip (0/1)" },
    { color: TYPE_COLORS.modern, label: "modern tip (≥2)" },
    { color: OOO_COLOR, label: "out of order", hatch: true },
    { color: BURN_COLOR, label: "burned (base fee)" },
  ];
  return (
    <div className="flex flex-wrap gap-row text-xs theme-text-muted">
      {items.map(({ color, label, hatch }) => (
        <span key={label} className="flex items-center gap-tight">
          <span
            className="inline-block h-2 w-2"
            style={
              // Match the bar marker: red diagonal stripes, not a solid chip.
              hatch
                ? {
                    backgroundImage: `repeating-linear-gradient(45deg, ${color} 0, ${color} 2px, transparent 2px, transparent 4px)`,
                  }
                : { backgroundColor: color }
            }
          />
          {label}
        </span>
      ))}
    </div>
  );
}

function StackedLadder({ data }: { data: BlockLadder }) {
  const navigate = useNavigate();
  const symbol = chainSymbol(useActiveChainId());
  const [hovered, setHovered] = useState<number | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const txs = data.txs;
  const n = txs.length;
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
  let baseFeeWei = 0n;
  try {
    baseFeeWei = BigInt(data.baseFeePerGas);
  } catch {
    baseFeeWei = 0n;
  }
  const gasLabel = Number(totalGas).toLocaleString();
  const blockBurnLabel = formatAmountDisplay((baseFeeWei * totalGas).toString(), 18, {
    maxFractionDigits: 4,
    symbol,
  });
  const tips = txs.map((t) => Math.max(0, t.tipGwei));

  // Log scale for tip depth — full range, no clamping / cut-off.
  const pos = tips.filter((t) => t > 0);
  const maxT = pos.length ? Math.max(...pos) : 1;
  const minT = pos.length ? Math.min(...pos) : 1;
  let logMax = Math.log10(maxT);
  let logMin = Math.log10(minT);
  if (logMax - logMin < 0.5) {
    logMax += 0.25;
    logMin -= 0.25;
  }
  const lineY = PAD_T + BURN_HEADER_H;
  const tipRegion = BASELINE - lineY;
  const depthOf = (tip: number) =>
    tip > 0 ? ((Math.log10(tip) - logMin) / (logMax - logMin)) * tipRegion : 0;

  return (
    <>
      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          style={{ height: "auto" }}
          onMouseMove={(e) => {
            // Fraction of the SVG box [0,1], measured against currentTarget (the
            // svg itself) — NOT nativeEvent.offsetX, which is relative to the
            // hovered child <rect> and resets at every bar, jerking the tooltip
            // backwards as the cursor moves right.
            const r = e.currentTarget.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) return;
            setCursor({
              x: (e.clientX - r.left) / r.width,
              y: (e.clientY - r.top) / r.height,
            });
          }}
          onMouseLeave={() => setHovered(null)}
        >
          <defs>
            {/* Out-of-order marker: bold red diagonal stripes with transparent
                gaps, so the tx-type color (amber/purple) still reads through. */}
            <pattern
              id="ooo-hatch"
              width={6}
              height={6}
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <line x1={0} y1={0} x2={0} y2={6} stroke={OOO_COLOR} strokeWidth={2.5} />
            </pattern>
          </defs>
          {/* burned base fee — one constant grey block on top */}
          <rect x={PAD_L} y={PAD_T} width={plotW} height={BURN_HEADER_H} fill={BURN_COLOR} />
          <line x1={PAD_L} y1={lineY} x2={W - PAD_R} y2={lineY} stroke="var(--color-border-default)" strokeWidth={1} />
          <line x1={PAD_L} y1={BASELINE} x2={W - PAD_R} y2={BASELINE} stroke="var(--color-border-muted)" strokeWidth={1} />
          {txs.map((t, i) => {
            const x = cumX[i]!;
            const w = Math.max(0.5, cumX[i + 1]! - x - 0.3);
            const depth = t.tipGwei > 0 ? Math.max(1.5, depthOf(t.tipGwei)) : 0;
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
                {depth > 0 && (
                  <>
                    {/* base color = tx type (legacy amber / modern purple) */}
                    <rect x={x} y={lineY} width={w} height={depth} fill={TYPE_COLORS[t.type]} />
                    {/* red hatch over the ones displaced from fee order (the same
                        set that makes up the block's "% out of order") */}
                    {t.outOfOrder && (
                      <rect x={x} y={lineY} width={w} height={depth} fill="url(#ooo-hatch)" />
                    )}
                  </>
                )}
                {/* full-height hit target so every bar (incl. zero-tip) is hoverable */}
                <rect x={x} y={PAD_T} width={w} height={BASELINE - PAD_T} fill="transparent" />
              </g>
            );
          })}
          <text x={PAD_L + 4} y={PAD_T + 17} fontSize={11} fill="var(--color-bg-primary)">
            base fee {fmtGwei(baseFeeGwei)} gwei
          </text>
          <text x={W - PAD_R - 2} y={PAD_T + 17} fontSize={11} textAnchor="end" fill="var(--color-bg-primary)">
            {gasLabel} gas used · {blockBurnLabel} burned
          </text>
          <text x={W - PAD_R} y={lineY + 12} fontSize={11} textAnchor="end" fill="var(--color-text-muted)">
            tips (log) {fmtGwei(maxT)} → {fmtGwei(minT)} gwei
          </text>
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
            baseFeeWei={baseFeeWei}
            symbol={symbol}
            deltaPrev={hovered > 0 ? tips[hovered]! - tips[hovered - 1]! : null}
            deltaNext={hovered < n - 1 ? tips[hovered]! - tips[hovered + 1]! : null}
            cursor={cursor}
          />
        )}
      </div>
      <div className="text-xs theme-text-muted">
        grey block = base fee burned (constant) · stalactites = tip kept (log
        scale, full range), colored by type (legacy amber / modern purple) · red
        hatch = displaced from fee order · width = gas
      </div>
    </>
  );
}

function TxTooltip({
  tx,
  gas,
  totalGas,
  baseFeeGwei,
  baseFeeWei,
  symbol,
  deltaPrev,
  deltaNext,
  cursor,
}: {
  tx: LadderTx;
  gas: bigint;
  totalGas: bigint;
  baseFeeGwei: number;
  baseFeeWei: bigint;
  symbol: string;
  deltaPrev: number | null;
  deltaNext: number | null;
  cursor: { x: number; y: number };
}) {
  // cursor.x/.y are fractions of the plot [0,1]; the relative wrapper matches the
  // svg box (svg is w-full), so percentage offsets line up. tooltipPosition
  // corner-anchors the card so it grows into the plot near either edge.
  const gasShare = shareOf(gas.toString(), totalGas.toString());
  const cost = baseFeeGwei + tx.tipGwei;

  return (
    <div
      className="card p-2 text-xs space-y-tight pointer-events-none absolute z-50"
      style={{ ...tooltipPosition(cursor), maxWidth: 300 }}
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
        <span className="theme-text-muted">type</span>
        <span className="theme-mono text-right" style={{ color: TYPE_COLORS[tx.type] }}>
          {tx.type === "legacy" ? "legacy (0/1)" : "modern (≥2)"}
        </span>
        <span className="theme-text-muted">method</span>
        <span className="theme-mono theme-text text-right">{tx.methodId || "transfer"}</span>
        <span className="theme-text-muted">gas</span>
        <span className="theme-mono theme-text text-right">
          {Number(gas).toLocaleString()} · {pct(gasShare)}
        </span>
        <span className="theme-text-muted">tip</span>
        <span className="theme-mono theme-text text-right">{fmtGwei(tx.tipGwei)} gwei</span>
        <span className="theme-text-muted">burned</span>
        <span className="theme-mono text-right" style={{ color: BURN_COLOR }}>
          {fmtGwei(baseFeeGwei)} gwei
        </span>
        <span className="theme-text-muted">burn total</span>
        <span className="theme-mono text-right" style={{ color: BURN_COLOR }}>
          {formatAmountDisplay((baseFeeWei * gas).toString(), 18, {
            maxFractionDigits: 6,
            symbol,
          })}
        </span>
        <span className="theme-text-muted">cost</span>
        <span className="theme-mono theme-text text-right">{fmtGwei(cost)} gwei</span>
        <span className="theme-text-muted">vs prev</span>
        <span
          className="theme-mono text-right"
          style={{
            color:
              deltaPrev !== null && deltaPrev > 0
                ? OOO_COLOR
                : "var(--color-text-secondary)",
          }}
        >
          {deltaPrev === null ? "—" : `${signedGwei(deltaPrev)} gwei`}
        </span>
        <span className="theme-text-muted">vs next</span>
        <span className="theme-mono text-right theme-text-secondary">
          {deltaNext === null ? "—" : `${signedGwei(deltaNext)} gwei`}
        </span>
      </div>
    </div>
  );
}
