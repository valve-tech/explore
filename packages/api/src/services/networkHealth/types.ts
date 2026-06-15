/**
 * Network-health analysis — types.
 *
 * Two lenses on every transaction's per-gas price, split at the base-fee line:
 *
 *   effectiveGasPrice  =  baseFee        +  tip
 *     (what user pays)     (burned)          (validator earns)
 *      └── USER COST ──┘   └────── VALIDATOR REVENUE ──────┘
 *
 * Transactions bucket as `legacy` (type 0 + 1) vs `modern` (type ≥ 2). All
 * money quantities are raw wei bigints in here; the wire serializers stringify
 * at the API boundary.
 *
 * See docs/superpowers/specs/2026-06-14-network-health-priority-design.md.
 */

/** A value split across the two transaction-type buckets. */
export interface TypeSplit<T> {
  /** EIP-2718 type 0 (legacy) + 1 (access list). */
  legacy: T;
  /** EIP-2718 type ≥ 2 (dynamic-fee / blob / set-code). */
  modern: T;
}

/** One transaction, normalized from a receipt. */
export interface TxInput {
  transactionIndex: number;
  /** Numeric tx type: 0 legacy, 1 access-list, 2 dynamic-fee, 3 blob, 4 setcode. */
  type: number;
  /** Lowercased sender — used to exclude same-sender nonce-ordered pairs. */
  from: string;
  gasUsed: bigint;
  effectiveGasPrice: bigint;
}

/** One block, normalized from its header + receipts. */
export interface BlockInput {
  number: bigint;
  timestamp: number;
  baseFeePerGas: bigint;
  /** Block total gas used, from the header. */
  gasUsed: bigint;
  gasLimit: bigint;
  miner: string;
  txs: TxInput[];
}

export interface AnalysisConfig {
  /**
   * When true the base fee is burned, so validator revenue per gas is the tip
   * (`effectiveGasPrice − baseFee`). When false the validator keeps the whole
   * effectiveGasPrice, and the ordering axis is the full price.
   */
  burnsBaseFee: boolean;
}

/** Position-bucket count for the order-distribution histogram. */
export const POSITION_BUCKETS = 10;

/**
 * Raw per-block metrics (bigints). Cached in the ring buffer and re-aggregated
 * per requested window — so every field is a sum/count that aggregates by
 * addition, never a pre-divided ratio.
 */
export interface BlockMetrics {
  number: bigint;
  timestamp: number;
  baseFeePerGas: bigint;
  gasUsed: bigint;
  gasLimit: bigint;
  txCount: number;

  /** Σ gasUsed by type. */
  gasByType: TypeSplit<bigint>;
  countByType: TypeSplit<number>;
  /** Σ (baseFee × gasUsed) by type — burned (0 when !burnsBaseFee). */
  burnedByType: TypeSplit<bigint>;
  /** Σ (revenuePerGas × gasUsed) by type — validator revenue / tips. */
  tipsByType: TypeSplit<bigint>;
  /** Σ (effectiveGasPrice × gasUsed) by type — user cost. */
  paidByType: TypeSplit<bigint>;

  /** Σ (normalized-position-in-basis-points × gasUsed) by type. */
  posBpsGasByType: TypeSplit<bigint>;
  /** Σ gasUsed per position bucket, by type (length POSITION_BUCKETS). */
  posHistGasByType: TypeSplit<bigint[]>;

  /**
   * Adjacent pairs where a later tx out-prioritizes an earlier one. Note the
   * two lenses agree on *ordering*: within a block baseFee is constant, so
   * `tip = effectiveGasPrice − baseFee` preserves rank — tip-order, cost-order
   * and price-order are identical. One inversion metric covers both.
   */
  priorityInversions: number;
  /** Adjacent comparable pairs (excludes same-sender nonce-ordered pairs). */
  priorityPairs: number;

  /** Σ gasUsed of txns placed earlier than their revenue rank justifies, by type. */
  overPrioritizedGasByType: TypeSplit<bigint>;
}

// ---------------------------------------------------------------------------
// Wire shapes — bigints stringified, ratios as numbers in [0,1].
// ---------------------------------------------------------------------------

export interface BlockStatsWire {
  number: string;
  timestamp: number;
  baseFeePerGas: string;
  gasUsed: string;
  gasLimit: string;
  txCount: number;

  /** Gas-weighted share of legacy gas: Σgas[legacy] / Σgas. */
  legacyGasShare: number;
  legacyCountShare: number;

  burned: string;
  tips: string;
  paid: string;
  /** burned / paid — the cost-vs-revenue wedge: share of user spend destroyed. */
  burnedShare: number;
  burnedByType: TypeSplit<string>;
  tipsByType: TypeSplit<string>;
  paidByType: TypeSplit<string>;

  /** Gas-weighted avg normalized position by type (0 = top of block), null if no gas. */
  avgPositionByType: TypeSplit<number | null>;
  /** Per-type position distribution — each array sums to ~1 across buckets. */
  positionHistogram: TypeSplit<number[]>;

  /** Normalized [0,1]; null when there were no comparable pairs. */
  priorityInversionRate: number | null;
  overPrioritizedGasByType: TypeSplit<string>;
}

export interface WindowAggregateWire {
  blocksAnalyzed: number;
  /** Oldest and newest block numbers + timestamps in the window. */
  fromBlock: string | null;
  toBlock: string | null;
  fromTimestamp: number | null;
  toTimestamp: number | null;

  legacyGasShare: number;
  legacyCountShare: number;

  burned: string;
  tips: string;
  paid: string;
  burnedByType: TypeSplit<string>;
  tipsByType: TypeSplit<string>;
  paidByType: TypeSplit<string>;

  avgPositionByType: TypeSplit<number | null>;
  positionHistogram: TypeSplit<number[]>;

  /** burned / paid — share of total user spend destroyed (vs earned by validators). */
  burnedShare: number;
  priorityInversionRate: number | null;
  overPrioritizedGasByType: TypeSplit<string>;
}

export interface NetworkHealthResponse {
  chainId: number;
  burnsBaseFee: boolean;
  /** Current chain head at response time. */
  headBlock: string;
  /** True when older blocks can still be loaded (under the cache cap + not genesis). */
  hasMore: boolean;
  aggregate: WindowAggregateWire;
  /** Newest-first. */
  blocks: BlockStatsWire[];
}
