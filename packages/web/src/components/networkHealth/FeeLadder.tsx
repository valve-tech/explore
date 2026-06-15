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
  const positives = txs.map((t) => t.tipGwei).filter((g) => g > 0);
  const maxG = positives.length ? Math.max(...positives) : 1;
  const minG = positives.length ? Math.min(...positives) : 1;
  let logMax = Math.log10(maxG);
  let logMin = Math.log10(minG);
  if (logMax - logMin < 0.5) {
    logMax += 0.5;
    logMin -= 0.5;
  }
  const span = logMax - logMin;
  const barW = (W - PAD_L - PAD_R) / n;

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

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: "auto" }}>
        {/* baseline */}
        <line x1={PAD_L} y1={BASELINE} x2={W - PAD_R} y2={BASELINE} stroke="var(--color-border-muted)" strokeWidth={1} />
        {txs.map((t, i) => {
          const x = PAD_L + i * barW;
          const w = Math.max(1, barW - 0.4);
          const fill = COLORS[t.status];
          const title = `#${t.position} · ${t.status} · ${t.type} · ${t.tipGwei.toFixed(3)} gwei · ${t.sender.slice(0, 6)}…`;
          if (t.tipGwei <= 0) {
            // zero-tip marker in the lane below the baseline
            return (
              <rect key={i} x={x} y={ZERO_LANE} width={w} height={4} fill={fill}>
                <title>{title} (zero tip)</title>
              </rect>
            );
          }
          const y = PAD_T + (1 - (Math.log10(t.tipGwei) - logMin) / span) * PLOT_H;
          return (
            <rect key={i} x={x} y={y} width={w} height={BASELINE - y} fill={fill}>
              <title>{title}</title>
            </rect>
          );
        })}
        {/* y-axis range hints */}
        <text x={PAD_L} y={PAD_T + 4} fontSize={11} fill="var(--color-text-muted)">
          {maxG.toFixed(maxG >= 100 ? 0 : 2)} gwei
        </text>
        <text x={PAD_L} y={BASELINE - 3} fontSize={11} fill="var(--color-text-muted)">
          {minG.toFixed(minG >= 100 ? 0 : 2)} gwei
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
