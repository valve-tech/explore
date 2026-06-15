/**
 * Network-health analysis — pure compute.
 *
 * No RPC, no clock, no I/O — `(BlockInput, AnalysisConfig) → BlockMetrics` and
 * `BlockMetrics[] → window aggregate`. This is the correctness core and is
 * exercised directly by tests/unit/networkHealth/compute.test.ts.
 */

import {
  POSITION_BUCKETS,
  type AnalysisConfig,
  type BlockInput,
  type BlockMetrics,
  type BlockStatsWire,
  type TxInput,
  type TypeSplit,
  type WindowAggregateWire,
} from "./types.js";

type Bucket = "legacy" | "modern";

function bucketOf(type: number): Bucket {
  return type <= 1 ? "legacy" : "modern";
}

function zeroBig(): TypeSplit<bigint> {
  return { legacy: 0n, modern: 0n };
}

function zeroHist(): TypeSplit<bigint[]> {
  return {
    legacy: new Array<bigint>(POSITION_BUCKETS).fill(0n),
    modern: new Array<bigint>(POSITION_BUCKETS).fill(0n),
  };
}

/**
 * Validator revenue per gas — the axis a rational producer orders by. Under
 * burn that's the tip (effectiveGasPrice − baseFee, floored at 0); otherwise
 * the validator keeps the whole price.
 */
function revenuePerGas(tx: TxInput, base: bigint, burns: boolean): bigint {
  if (!burns) return tx.effectiveGasPrice;
  return tx.effectiveGasPrice > base ? tx.effectiveGasPrice - base : 0n;
}

export function computeBlock(
  block: BlockInput,
  config: AnalysisConfig,
): BlockMetrics {
  const base = block.baseFeePerGas;
  const burns = config.burnsBaseFee;
  // Receipts aren't guaranteed ordered; sort by index so position + adjacency
  // are correct.
  const txs = [...block.txs].sort(
    (a, b) => a.transactionIndex - b.transactionIndex,
  );
  const n = txs.length;

  const gasByType = zeroBig();
  const countByType: TypeSplit<number> = { legacy: 0, modern: 0 };
  const burnedByType = zeroBig();
  const tipsByType = zeroBig();
  const paidByType = zeroBig();
  const posBpsGasByType = zeroBig();
  const posHistGasByType = zeroHist();
  const overPrioritizedGasByType = zeroBig();

  const revenue = new Array<bigint>(n);

  for (let i = 0; i < n; i += 1) {
    const tx = txs[i]!;
    const b = bucketOf(tx.type);
    const gas = tx.gasUsed;
    const cost = tx.effectiveGasPrice;
    const rev = revenuePerGas(tx, base, burns);
    revenue[i] = rev;

    gasByType[b] += gas;
    countByType[b] += 1;
    paidByType[b] += cost * gas;
    tipsByType[b] += rev * gas;
    burnedByType[b] += (burns ? base : 0n) * gas;

    // Normalized position (0 = top). Single-tx blocks are position 0.
    const idx = tx.transactionIndex;
    const posBps = n > 1 ? (BigInt(idx) * 10000n) / BigInt(n - 1) : 0n;
    posBpsGasByType[b] += posBps * gas;

    const bucketIdx =
      n > 1
        ? Math.min(
            POSITION_BUCKETS - 1,
            Math.floor((idx / (n - 1)) * POSITION_BUCKETS),
          )
        : 0;
    posHistGasByType[b][bucketIdx]! += gas;
  }

  // Adjacent inversions, excluding same-sender pairs (nonce ordering forces
  // those regardless of fee). Within a block baseFee is constant, so revenue
  // (tip) order and cost (price) order are identical — one metric covers both.
  let priorityInversions = 0;
  let priorityPairs = 0;
  for (let i = 0; i + 1 < n; i += 1) {
    const a = txs[i]!;
    const c = txs[i + 1]!;
    if (a.from === c.from) continue;
    priorityPairs += 1;
    if (revenue[i + 1]! > revenue[i]!) priorityInversions += 1;
  }

  // Over-prioritized gas: a tx placed earlier than its revenue rank justifies.
  // Rank by revenue desc, stable tie-break by original index.
  const order = txs.map((_, i) => i);
  order.sort((x, y) => {
    if (revenue[y]! !== revenue[x]!) return revenue[y]! > revenue[x]! ? 1 : -1;
    return x - y;
  });
  const expectedRank = new Array<number>(n);
  order.forEach((origIdx, rank) => {
    expectedRank[origIdx] = rank;
  });
  for (let i = 0; i < n; i += 1) {
    if (i < expectedRank[i]!) {
      overPrioritizedGasByType[bucketOf(txs[i]!.type)] += txs[i]!.gasUsed;
    }
  }

  return {
    number: block.number,
    timestamp: block.timestamp,
    baseFeePerGas: base,
    gasUsed: block.gasUsed,
    gasLimit: block.gasLimit,
    txCount: n,
    gasByType,
    countByType,
    burnedByType,
    tipsByType,
    paidByType,
    posBpsGasByType,
    posHistGasByType,
    priorityInversions,
    priorityPairs,
    overPrioritizedGasByType,
  };
}

// ---------------------------------------------------------------------------
// Serialization helpers
// ---------------------------------------------------------------------------

/** Bigint ratio → number in [0,1], scaled for sub-integer precision. */
function ratio(num: bigint, den: bigint): number {
  if (den === 0n) return 0;
  return Number((num * 1_000_000n) / den) / 1_000_000;
}

function splitStr(s: TypeSplit<bigint>): TypeSplit<string> {
  return { legacy: s.legacy.toString(), modern: s.modern.toString() };
}

/** Gas-weighted avg normalized position (0..1), or null when the type has no gas. */
function avgPosition(posBpsGas: bigint, gas: bigint): number | null {
  if (gas === 0n) return null;
  return ratio(posBpsGas, gas) / 10000;
}

/** Per-type histogram normalized so each type's buckets sum to ~1. */
function normHist(histGas: bigint[], totalGas: bigint): number[] {
  return histGas.map((g) => ratio(g, totalGas));
}

function rate(inversions: number, pairs: number): number | null {
  return pairs === 0 ? null : inversions / pairs;
}

export function serializeBlock(m: BlockMetrics): BlockStatsWire {
  const totalGas = m.gasByType.legacy + m.gasByType.modern;
  const totalCount = m.countByType.legacy + m.countByType.modern;
  const burned = m.burnedByType.legacy + m.burnedByType.modern;
  const tips = m.tipsByType.legacy + m.tipsByType.modern;
  const paid = m.paidByType.legacy + m.paidByType.modern;
  return {
    number: m.number.toString(),
    timestamp: m.timestamp,
    baseFeePerGas: m.baseFeePerGas.toString(),
    gasUsed: m.gasUsed.toString(),
    gasLimit: m.gasLimit.toString(),
    txCount: m.txCount,
    legacyGasShare: ratio(m.gasByType.legacy, totalGas),
    legacyCountShare: totalCount === 0 ? 0 : m.countByType.legacy / totalCount,
    burned: burned.toString(),
    tips: tips.toString(),
    paid: paid.toString(),
    burnedShare: ratio(burned, paid),
    burnedByType: splitStr(m.burnedByType),
    tipsByType: splitStr(m.tipsByType),
    paidByType: splitStr(m.paidByType),
    avgPositionByType: {
      legacy: avgPosition(m.posBpsGasByType.legacy, m.gasByType.legacy),
      modern: avgPosition(m.posBpsGasByType.modern, m.gasByType.modern),
    },
    positionHistogram: {
      legacy: normHist(m.posHistGasByType.legacy, m.gasByType.legacy),
      modern: normHist(m.posHistGasByType.modern, m.gasByType.modern),
    },
    priorityInversionRate: rate(m.priorityInversions, m.priorityPairs),
    overPrioritizedGasByType: splitStr(m.overPrioritizedGasByType),
  };
}

/** Roll a window of per-block metrics into one aggregate (sums, then ratios). */
export function aggregateWindow(metrics: BlockMetrics[]): WindowAggregateWire {
  const gasByType = zeroBig();
  const countByType: TypeSplit<number> = { legacy: 0, modern: 0 };
  const burnedByType = zeroBig();
  const tipsByType = zeroBig();
  const paidByType = zeroBig();
  const posBpsGasByType = zeroBig();
  const posHistGasByType = zeroHist();
  const overPrioritizedGasByType = zeroBig();
  let priorityInversions = 0;
  let priorityPairs = 0;

  for (const m of metrics) {
    for (const k of ["legacy", "modern"] as const) {
      gasByType[k] += m.gasByType[k];
      countByType[k] += m.countByType[k];
      burnedByType[k] += m.burnedByType[k];
      tipsByType[k] += m.tipsByType[k];
      paidByType[k] += m.paidByType[k];
      posBpsGasByType[k] += m.posBpsGasByType[k];
      overPrioritizedGasByType[k] += m.overPrioritizedGasByType[k];
      for (let i = 0; i < POSITION_BUCKETS; i += 1) {
        posHistGasByType[k][i]! += m.posHistGasByType[k][i]!;
      }
    }
    priorityInversions += m.priorityInversions;
    priorityPairs += m.priorityPairs;
  }

  const totalGas = gasByType.legacy + gasByType.modern;
  const totalCount = countByType.legacy + countByType.modern;
  const burned = burnedByType.legacy + burnedByType.modern;
  const tips = tipsByType.legacy + tipsByType.modern;
  const paid = paidByType.legacy + paidByType.modern;
  // metrics arrive newest-first from the cache window; report oldest→newest.
  const oldest = metrics.length ? metrics[metrics.length - 1]! : null;
  const newest = metrics.length ? metrics[0]! : null;

  return {
    blocksAnalyzed: metrics.length,
    fromBlock: oldest ? oldest.number.toString() : null,
    toBlock: newest ? newest.number.toString() : null,
    fromTimestamp: oldest ? oldest.timestamp : null,
    toTimestamp: newest ? newest.timestamp : null,
    legacyGasShare: ratio(gasByType.legacy, totalGas),
    legacyCountShare: totalCount === 0 ? 0 : countByType.legacy / totalCount,
    burned: burned.toString(),
    tips: tips.toString(),
    paid: paid.toString(),
    burnedByType: splitStr(burnedByType),
    tipsByType: splitStr(tipsByType),
    paidByType: splitStr(paidByType),
    avgPositionByType: {
      legacy: avgPosition(posBpsGasByType.legacy, gasByType.legacy),
      modern: avgPosition(posBpsGasByType.modern, gasByType.modern),
    },
    positionHistogram: {
      legacy: normHist(posHistGasByType.legacy, gasByType.legacy),
      modern: normHist(posHistGasByType.modern, gasByType.modern),
    },
    burnedShare: ratio(burned, paid),
    priorityInversionRate: rate(priorityInversions, priorityPairs),
    overPrioritizedGasByType: splitStr(overPrioritizedGasByType),
  };
}
