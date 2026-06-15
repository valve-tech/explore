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
 * Tip flow between CONSECUTIVE cross-sender transactions, by magnitude. Walking
 * down the block, `variation` sums how far the tip moves between neighbors and
 * `ascent` sums only the moves that go UP (the wrong way for a fee market).
 * `ascent / variation` is the fraction of fee movement that's out of order:
 *   - magnitude-weighted, so a 1-wei wobble contributes ~nothing;
 *   - adjacent, so it's each tx vs its immediate neighbor (not distant pairs);
 *   - same-sender consecutive pairs skipped (nonce forces their order).
 * `senders` and `rev` are index-aligned in block-position order.
 */
function tipFlow(
  senders: string[],
  rev: bigint[],
): { ascent: bigint; variation: bigint } {
  let ascent = 0n;
  let variation = 0n;
  for (let i = 0; i + 1 < rev.length; i += 1) {
    if (senders[i] === senders[i + 1]) continue;
    const d = rev[i + 1]! - rev[i]!;
    variation += d < 0n ? -d : d;
    if (d > 0n) ascent += d;
  }
  return { ascent, variation };
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

  // Out-of-order: magnitude of tip movement that goes UP between consecutive
  // cross-sender txns, over total movement (see tipFlow).
  const { ascent: tipAscent, variation: tipVariation } = tipFlow(
    txs.map((t) => t.from),
    revenue,
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
    tipAscent,
    tipVariation,
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
    priorityInversionRate: rate(m.tipAscent, m.tipVariation),
    overPrioritizedGasByType: splitStr(m.overPrioritizedGasByType),
  };
}

/**
 * Per-block fee ladder: each tx in position order with its tip and a
 * situation classification, for the color-coded graph. O(n²) classification is
 * fine — this runs on one block, on demand (not during the window warm).
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

  const senderCount = new Map<string, number>();
  for (const t of txs) senderCount.set(t.from, (senderCount.get(t.from) ?? 0) + 1);

  const ladder: LadderTx[] = txs.map((t, i) => {
    // Did a later, different-sender tx pay a higher tip? Then this tx sits
    // ahead of someone who paid more.
    let jumped = false;
    for (let j = i + 1; j < n; j += 1) {
      if (txs[j]!.from !== t.from && rev[j]! > rev[i]!) {
        jumped = true;
        break;
      }
    }
    const multi = (senderCount.get(t.from) ?? 1) > 1;
    const status: LadderTx["status"] = jumped
      ? multi
        ? "nonce"
        : "jumped"
      : "ordered";
    return {
      position: i,
      sender: t.from,
      type: t.type <= 1 ? "legacy" : "modern",
      tip: rev[i]!.toString(),
      tipGwei: Number(rev[i]!) / 1e9,
      gasUsed: t.gasUsed.toString(),
      status,
      hash: t.hash ?? "",
      to: t.to ?? null,
      value: (t.value ?? 0n).toString(),
      methodId: t.methodId ?? "",
    };
  });

  const { ascent, variation } = tipFlow(
    txs.map((t) => t.from),
    rev,
  );

  return {
    number: block.number.toString(),
    timestamp: block.timestamp,
    baseFeePerGas: base.toString(),
    txCount: n,
    burnsBaseFee: config.burnsBaseFee,
    priorityInversionRate: rate(ascent, variation),
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
  let tipAscent = 0n;
  let tipVariation = 0n;

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
    tipAscent += m.tipAscent;
    tipVariation += m.tipVariation;
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
    priorityInversionRate: rate(tipAscent, tipVariation),
    overPrioritizedGasByType: splitStr(overPrioritizedGasByType),
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
    inv: bigint;
    pairs: bigint;
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
        inv: 0n,
        pairs: 0n,
      };
      by.set(m.miner, a);
    }
    a.blocks += 1;
    a.gasUsed += m.gasUsed;
    a.legacyGas += m.gasByType.legacy;
    a.burned += m.burnedByType.legacy + m.burnedByType.modern;
    a.tips += m.tipsByType.legacy + m.tipsByType.modern;
    a.paid += m.paidByType.legacy + m.paidByType.modern;
    a.inv += m.tipAscent;
    a.pairs += m.tipVariation;
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
      priorityInversionRate: rate(a.inv, a.pairs),
    }))
    .sort((x, y) => y.blocks - x.blocks || Number(BigInt(y.tips) - BigInt(x.tips)));
}
