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
  type BlockLadderWire,
  type BlockMetrics,
  type BlockStatsWire,
  type LadderTx,
  type MinerStatsWire,
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

/**
 * Fee-order comparisons use revenue-per-gas rounded to this many significant
 * figures, so sub-part-per-billion wobble (e.g. tips that differ by 1–2 wei out
 * of ~1e13 — visually the same gwei) counts as the SAME fee tier and never reads
 * as "out of order". Coarse enough to erase noise, fine enough to keep any
 * economically-meaningful gap.
 */
const FEE_TIER_SIG_FIGS = 9;

/** Round a positive wei value to `sig` significant figures. Monotonic. */
function roundSigFigs(v: bigint, sig: number): bigint {
  if (v <= 0n) return 0n;
  const digits = v.toString().length;
  if (digits <= sig) return v;
  const scale = 10n ** BigInt(digits - sig);
  return ((v + scale / 2n) / scale) * scale; // round-half-up, then restore scale
}

/**
 * Gas that sits out of fee order, by MINIMAL DISPLACEMENT: sort the block into
 * fee order (revenue-per-gas desc, tiered — see FEE_TIER_SIG_FIGS), then find
 * the largest set of txns already in that order and count only the REST.
 *
 * Concretely: out-of-order gas = total gas − the maximum-gas subsequence whose
 * fee tiers are non-increasing in block position (a max-weight increasing
 * subsequence over fee rank). So moving ONE tx from the front to the back marks
 * only that one tx — not everyone it leapfrogged (the bug this replaces counted
 * every tx that had any later, higher-paying tx, so a single displaced whale
 * inflated the rate). Gas-weighted, so a big displaced tx counts more.
 *
 * `comparableGas` is the block's total tx gas when ≥2 distinct senders make the
 * ordering assessable, else 0 → the rate is null ("n/a"). Nonce is not modelled
 * explicitly: a sender's forced low→high sequence shows as a genuine
 * displacement of the offending tx, which matches how it reads on the ladder.
 *
 * Also returns `displaced[i]` — the per-tx out-of-order flag (the txns NOT in
 * the kept subsequence), so the ladder marks exactly the set that makes up the
 * rate. O(n log n): sort for fee rank + a Fenwick prefix-max (tracking the
 * argmax) for the subsequence + a backtrack to recover membership. Inputs are
 * index-aligned in block-position order.
 */
function analyzeFeeOrder(
  senders: string[],
  rev: bigint[],
  gas: bigint[],
): { outOfOrderGas: bigint; comparableGas: bigint; displaced: boolean[] } {
  const n = rev.length;
  let totalGas = 0n;
  for (let i = 0; i < n; i += 1) totalGas += gas[i]!;
  const comparableGas = new Set(senders).size >= 2 ? totalGas : 0n;
  if (n === 0) return { outOfOrderGas: 0n, comparableGas, displaced: [] };

  // Fee rank: 0 = highest tier. Ties (same tier) break by block position, so
  // equal-fee txns keep block order and never read as out of order.
  const tier = rev.map((r) => roundSigFigs(r, FEE_TIER_SIG_FIGS));
  const rank = new Array<number>(n);
  [...Array(n).keys()]
    .sort((a, b) => (tier[a]! === tier[b]! ? a - b : tier[a]! > tier[b]! ? -1 : 1))
    .forEach((idx, pos) => {
      rank[idx] = pos;
    });

  // Max-weight (gas) strictly-increasing-by-rank subsequence over block order,
  // via a Fenwick tree of prefix maxima keyed by rank+1, tracking the argmax so
  // the winning chain can be reconstructed.
  const treeVal = new Array<bigint>(n + 1).fill(0n);
  const treeArg = new Array<number>(n + 1).fill(-1);
  const prefixMax = (idx: number): { val: bigint; k: number } => {
    let val = 0n;
    let k = -1;
    for (let i = idx; i > 0; i -= i & -i) {
      if (treeVal[i]! > val) {
        val = treeVal[i]!;
        k = treeArg[i]!;
      }
    }
    return { val, k };
  };
  const update = (idx: number, val: bigint, k: number): void => {
    for (let i = idx; i <= n; i += i & -i) {
      if (treeVal[i]! < val) {
        treeVal[i] = val;
        treeArg[i] = k;
      }
    }
  };
  const dpVal = new Array<bigint>(n);
  const parent = new Array<number>(n).fill(-1);
  let bestEnd = -1;
  let bestVal = 0n;
  for (let k = 0; k < n; k += 1) {
    const r = rank[k]!; // ranks 0..r-1 → Fenwick indices 1..r
    const pm = prefixMax(r);
    dpVal[k] = pm.val + gas[k]!;
    parent[k] = pm.k;
    update(r + 1, dpVal[k]!, k);
    if (dpVal[k]! > bestVal) {
      bestVal = dpVal[k]!;
      bestEnd = k;
    }
  }

  // Everything not on the winning (kept) chain is displaced.
  const displaced = new Array<boolean>(n).fill(true);
  for (let k = bestEnd; k !== -1; k = parent[k]!) displaced[k] = false;

  return { outOfOrderGas: totalGas - bestVal, comparableGas, displaced };
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

  // Out-of-order: gas of txns displaced from fee order (see analyzeFeeOrder).
  const { outOfOrderGas: oooGas, comparableGas } = analyzeFeeOrder(
    txs.map((t) => t.from),
    revenue,
    txs.map((t) => t.gasUsed),
  );

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
    miner: (block.miner || "").toLowerCase(),
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
    outOfOrderGas: oooGas,
    comparableGas,
    overPrioritizedGasByType,
  };
}

// ---------------------------------------------------------------------------
// Serialization helpers
// ---------------------------------------------------------------------------

/** Per-block distribution (avg / median / min / max) of a wei quantity. */
function perBlockDist(values: bigint[]): {
  avg: string;
  median: string;
  min: string;
  max: string;
} {
  if (values.length === 0) return { avg: "0", median: "0", min: "0", max: "0" };
  const sorted = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const n = sorted.length;
  const sum = sorted.reduce((a, b) => a + b, 0n);
  const median =
    n % 2 === 1
      ? sorted[(n - 1) / 2]!
      : (sorted[n / 2 - 1]! + sorted[n / 2]!) / 2n;
  return {
    avg: (sum / BigInt(n)).toString(),
    median: median.toString(),
    min: sorted[0]!.toString(),
    max: sorted[n - 1]!.toString(),
  };
}

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

/** Gas-weighted inversion rate in [0,1], or null when no comparable pairs. */
function rate(inverted: bigint, pairs: bigint): number | null {
  return pairs === 0n ? null : Number((inverted * 1_000_000n) / pairs) / 1e6;
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
    priorityInversionRate: rate(m.outOfOrderGas, m.comparableGas),
    overPrioritizedGasByType: splitStr(m.overPrioritizedGasByType),
  };
}

/**
 * Per-block fee ladder: each tx in position order with its tip and its
 * out-of-order flag, for the color-coded graph. The flag + the block's rate
 * come from the SAME minimal-displacement pass (analyzeFeeOrder), so the marked
 * bars are exactly the txns that make up the "% out of fee order" figure.
 */
export function computeLadder(
  block: BlockInput,
  config: AnalysisConfig,
): BlockLadderWire {
  const base = block.baseFeePerGas;
  const txs = [...block.txs].sort(
    (a, b) => a.transactionIndex - b.transactionIndex,
  );
  const n = txs.length;
  const rev = txs.map((t) => revenuePerGas(t, base, config.burnsBaseFee));

  const { outOfOrderGas: oooGas, comparableGas, displaced } = analyzeFeeOrder(
    txs.map((t) => t.from),
    rev,
    txs.map((t) => t.gasUsed),
  );

  const ladder: LadderTx[] = txs.map((t, i) => ({
    position: i,
    sender: t.from,
    type: t.type <= 1 ? "legacy" : "modern",
    tip: rev[i]!.toString(),
    tipGwei: Number(rev[i]!) / 1e9,
    gasUsed: t.gasUsed.toString(),
    outOfOrder: displaced[i]!,
    hash: t.hash ?? "",
    to: t.to ?? null,
    value: (t.value ?? 0n).toString(),
    methodId: t.methodId ?? "",
  }));

  return {
    number: block.number.toString(),
    timestamp: block.timestamp,
    baseFeePerGas: base.toString(),
    txCount: n,
    burnsBaseFee: config.burnsBaseFee,
    priorityInversionRate: rate(oooGas, comparableGas),
    txs: ladder,
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
  let outOfOrderGasSum = 0n;
  let comparableGasSum = 0n;

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
    outOfOrderGasSum += m.outOfOrderGas;
    comparableGasSum += m.comparableGas;
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
    priorityInversionRate: rate(outOfOrderGasSum, comparableGasSum),
    overPrioritizedGasByType: splitStr(overPrioritizedGasByType),
    paidPerBlock: perBlockDist(
      metrics.map((m) => m.paidByType.legacy + m.paidByType.modern),
    ),
    tipsPerBlock: perBlockDist(
      metrics.map((m) => m.tipsByType.legacy + m.tipsByType.modern),
    ),
  };
}

/** Per-validator rollup over the window — who produced what, and how. */
export function aggregateMiners(metrics: BlockMetrics[]): MinerStatsWire[] {
  interface Acc {
    blocks: number;
    gasUsed: bigint;
    legacyGas: bigint;
    burned: bigint;
    tips: bigint;
    paid: bigint;
    ooo: bigint;
    comparable: bigint;
  }
  const by = new Map<string, Acc>();
  for (const m of metrics) {
    let a = by.get(m.miner);
    if (!a) {
      a = {
        blocks: 0,
        gasUsed: 0n,
        legacyGas: 0n,
        burned: 0n,
        tips: 0n,
        paid: 0n,
        ooo: 0n,
        comparable: 0n,
      };
      by.set(m.miner, a);
    }
    a.blocks += 1;
    a.gasUsed += m.gasUsed;
    a.legacyGas += m.gasByType.legacy;
    a.burned += m.burnedByType.legacy + m.burnedByType.modern;
    a.tips += m.tipsByType.legacy + m.tipsByType.modern;
    a.paid += m.paidByType.legacy + m.paidByType.modern;
    a.ooo += m.outOfOrderGas;
    a.comparable += m.comparableGas;
  }
  return [...by.entries()]
    .map(([miner, a]) => ({
      miner,
      blocks: a.blocks,
      gasUsed: a.gasUsed.toString(),
      legacyGasShare: ratio(a.legacyGas, a.gasUsed),
      burned: a.burned.toString(),
      tips: a.tips.toString(),
      paid: a.paid.toString(),
      priorityInversionRate: rate(a.ooo, a.comparable),
    }))
    .sort((x, y) => y.blocks - x.blocks || Number(BigInt(y.tips) - BigInt(x.tips)));
}
