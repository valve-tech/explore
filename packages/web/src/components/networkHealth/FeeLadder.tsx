import { useBlockLadder } from "../../hooks/useNetworkHealth";
import type { LadderTx } from "../../api/networkHealth";
import { pct } from "./format";

/**
 * Per-block fee ladder: each tx as a bar at its block position (x), height =
 * tip on a log scale (y), colored by ordering situation. A healthy fee market
 * is a smooth descending staircase of grey "ordered" bars; queue-jumps show as
 * red bars (and zero-tip MEV txns as red markers in the zero lane near the top).
 */

const COLORS: Record<LadderTx["status"], string> = {
  ordered: "var(--color-text-muted)",
  jumped: "var(--color-danger)",
  nonce: "var(--color-warning)",
};

const W = 1000;
const H = 280;
const PAD_L = 10;
const PAD_R = 10;
const PAD_T = 14;
const PAD_B = 26;
const PLOT_H = H - PAD_T - PAD_B;
const BASELINE = PAD_T + PLOT_H;
const ZERO_LANE = BASELINE + 8;

function safeGwei(wei: string): number {
  try {
    return Number(BigInt(wei)) / 1e9;
  } catch {
    return 0;
  }
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

  const txs = data.txs;
  const n = txs.length;
  const plotW = W - PAD_L - PAD_R;
  const baseFeeGwei = safeGwei(data.baseFeePerGas);

  // Log y-range spans the tips and the base fee, so the base-fee line is always
  // on-chart.
  const rangeVals = txs.map((t) => t.tipGwei).filter((g) => g > 0);
  if (baseFeeGwei > 0) rangeVals.push(baseFeeGwei);
  const maxG = rangeVals.length ? Math.max(...rangeVals) : 1;
  const minG = rangeVals.length ? Math.min(...rangeVals) : 1;
  let logMax = Math.log10(maxG);
  let logMin = Math.log10(minG);
  if (logMax - logMin < 0.5) {
    logMax += 0.5;
    logMin -= 0.5;
  }
  const span = logMax - logMin;
  const yFor = (g: number) => PAD_T + (1 - (Math.log10(g) - logMin) / span) * PLOT_H;

  // Bar width ∝ gasUsed: x is cumulative block gas, so a tx's width is its
  // share of block space. Falls back to equal widths if gas totals are zero.
  const gas = txs.map((t) => {
    try {
      return BigInt(t.gasUsed);
    } catch {
      return 0n;
    }
  });
  const totalGas = gas.reduce((a, b) => a + b, 0n);
  const cumX: number[] = [];
  let cum = 0n;
  for (let i = 0; i < n; i += 1) {
    cumX.push(
      totalGas > 0n
        ? PAD_L + (Number((cum * 1_000_000n) / totalGas) / 1_000_000) * plotW
        : PAD_L + (i / n) * plotW,
    );
    cum += gas[i]!;
  }
  cumX.push(totalGas > 0n ? PAD_L + plotW : PAD_L + plotW); // right edge

  const counts = txs.reduce(
    (acc, t) => ({ ...acc, [t.status]: acc[t.status] + 1 }),
    { ordered: 0, jumped: 0, nonce: 0 } as Record<LadderTx["status"], number>,
  );

  return (
    <div className="space-y-stack p-4">
      <div className="flex flex-wrap items-center justify-between gap-row">
        <div className="text-xs theme-text-secondary">
          block #{data.number} · {n} txs ·{" "}
          <span className="theme-text">{pct(data.priorityInversionRate)}</span> out of
          fee order
        </div>
        <Legend counts={counts} />
      </div>

      <div className="text-xs theme-text-muted">
        y = tip per gas (log) ={" "}
        <code className="theme-mono">effectiveGasPrice − baseFee</code> · bar
        width = gas used · dashed line = base fee · ordered by tip, not type
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: "auto" }}>
        {/* baseline */}
        <line x1={PAD_L} y1={BASELINE} x2={W - PAD_R} y2={BASELINE} stroke="var(--color-border-muted)" strokeWidth={1} />
        {txs.map((t, i) => {
          const x = cumX[i]!;
          const w = Math.max(0.5, cumX[i + 1]! - x - 0.3);
          const fill = COLORS[t.status];
          const gasLabel = Number(gas[i]!).toLocaleString();
          const title = `#${t.position} · ${t.status} · ${t.type} · ${t.tipGwei.toFixed(3)} gwei tip · ${gasLabel} gas · ${t.sender.slice(0, 6)}…`;
          if (t.tipGwei <= 0) {
            // zero-tip marker in the lane below the baseline
            return (
              <rect key={i} x={x} y={ZERO_LANE} width={w} height={4} fill={fill}>
                <title>{title} (zero tip)</title>
              </rect>
            );
          }
          const y = yFor(t.tipGwei);
          return (
            <rect key={i} x={x} y={y} width={w} height={BASELINE - y} fill={fill}>
              <title>{title}</title>
            </rect>
          );
        })}
        {/* base-fee reference line — bars above it out-tip the burn, below it burn more */}
        {baseFeeGwei > 0 && (
          <>
            <line
              x1={PAD_L}
              x2={W - PAD_R}
              y1={yFor(baseFeeGwei)}
              y2={yFor(baseFeeGwei)}
              stroke="var(--color-accent)"
              strokeWidth={1}
              strokeDasharray="4 3"
            />
            <text
              x={W - PAD_R}
              y={yFor(baseFeeGwei) - 3}
              fontSize={11}
              textAnchor="end"
              fill="var(--color-accent)"
            >
              base fee {baseFeeGwei >= 100 ? baseFeeGwei.toFixed(0) : baseFeeGwei.toFixed(2)} gwei
            </text>
          </>
        )}
        {/* y-axis range hints */}
        <text x={PAD_L} y={PAD_T + 4} fontSize={11} fill="var(--color-text-muted)">
          {maxG.toFixed(maxG >= 100 ? 0 : 2)} gwei
        </text>
        {/* x-axis labels */}
        <text x={PAD_L} y={H - 6} fontSize={11} fill="var(--color-text-muted)">
          top of block
        </text>
        <text x={W - PAD_R} y={H - 6} fontSize={11} textAnchor="end" fill="var(--color-text-muted)">
          bottom
        </text>
      </svg>
    </div>
  );
}

function Legend({ counts }: { counts: Record<LadderTx["status"], number> }) {
  const items: Array<[LadderTx["status"], string]> = [
    ["ordered", "in fee order"],
    ["jumped", "queue-jumped"],
    ["nonce", "nonce-forced"],
  ];
  return (
    <div className="flex gap-row text-xs theme-text-muted">
      {items.map(([status, label]) => (
        <span key={status} className="flex items-center gap-tight">
          <span className="inline-block h-2 w-2" style={{ backgroundColor: COLORS[status] }} />
          {label} ({counts[status]})
        </span>
      ))}
    </div>
  );
}
