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
  // Display-only fields, populated for the on-demand ladder (not the window
  // warm, which fetches headers + receipts only). Ignored by computeBlock.
  hash?: string;
  to?: string | null;
  value?: bigint;
  /** 4-byte selector ("0x........") or "" for plain transfers. */
  methodId?: string;
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
  /** Block producer / fee recipient (lowercased) — for per-validator rollups. */
  miner: string;
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
   * Out-of-order gas: Σ gasUsed of txns that sit ahead of a LATER, different-
   * sender tx which paid strictly higher revenue-per-gas (the fee ladder's
   * "jumped" test). Same-sender pairs are ignored — nonce forces their order.
   * The reported rate is `outOfOrderGas / comparableGas`, so it is gas-weighted
   * and detects ALL inversions (not just adjacent ones).
   */
  outOfOrderGas: bigint;
  /**
   * Denominator for the rate: the block's total tx gas when ≥2 distinct senders
   * make the ordering assessable, else 0 (single-sender / single-tx blocks are
   * nonce-forced → the rate is null / "n/a"). Aggregates by addition.
   */
  comparableGas: bigint;

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

  /**
   * Gas-weighted share of gas that is out of fee order (a tx ahead of a later,
   * different-sender tx that paid more): `outOfOrderGas / comparableGas`.
   * Normalized [0,1]; null when the block isn't assessable (fewer than 2
   * distinct senders).
   */
  priorityInversionRate: number | null;
  overPrioritizedGasByType: TypeSplit<string>;
}

/** Per-block distribution of a wei quantity over the window (all stringified wei). */
export interface PerBlockStat {
  /** Mean per block. */
  avg: string;
  /** Median per block (mean of the two middles for an even count). */
  median: string;
  /** Smallest block value. */
  min: string;
  /** Largest block value. */
  max: string;
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
  /** User cost (paid) per block — avg / median / min / max over the window. */
  paidPerBlock: PerBlockStat;
  /** Validator revenue (tips) per block — avg / median / min / max. */
  tipsPerBlock: PerBlockStat;
}

// ---------------------------------------------------------------------------
// Per-block fee ladder (on-demand detail for the graph)
// ---------------------------------------------------------------------------

/**
 * One transaction's place on the block's fee ladder, classified by situation:
 *   - "ordered" — sits where its tip rank puts it (no later cross-sender tx
 *     out-tips it).
 *   - "jumped" — a later, different-sender tx paid a HIGHER tip, yet this
 *     single-tx sender sits ahead of it: genuine non-fee prioritization.
 *   - "nonce" — same as jumped, but this sender has multiple txns in the block,
 *     so the placement may be forced by nonce ordering (ambiguous, not flagged red).
 */
export interface LadderTx {
  position: number;
  sender: string;
  type: "legacy" | "modern";
  /** Raw wei tip (validator revenue per gas). */
  tip: string;
  /** Tip in gwei as a number, for plotting on a log axis. */
  tipGwei: number;
  /** Raw gas used — drives the bar width (the tx's block-space footprint). */
  gasUsed: string;
  status: "ordered" | "jumped" | "nonce";
  /** Transaction hash. */
  hash: string;
  /** Recipient address (lowercased as provided by RPC), or null for contract creation. */
  to: string | null;
  /** Raw wei value transferred. */
  value: string;
  /** 4-byte selector ("0x........") or "" for plain transfers. */
  methodId: string;
}

export interface BlockLadderWire {
  number: string;
  timestamp: number;
  baseFeePerGas: string;
  txCount: number;
  burnsBaseFee: boolean;
  /** Cross-sender inversion rate for this block, [0,1] or null. */
  priorityInversionRate: number | null;
  txs: LadderTx[];
}

/** Per-validator rollup over the loaded window. */
export interface MinerStatsWire {
  miner: string;
  blocks: number;
  gasUsed: string;
  /** Gas-weighted legacy share of this miner's blocks. */
  legacyGasShare: number;
  /** Total burned (base fee) across this miner's blocks. */
  burned: string;
  /** Total tips this miner earned. */
  tips: string;
  /** Total paid by users in this miner's blocks. */
  paid: string;
  /** Gas-weighted cross-sender inversion rate across this miner's blocks. */
  priorityInversionRate: number | null;
}

export interface NetworkHealthResponse {
  chainId: number;
  burnsBaseFee: boolean;
  /** Current chain head at response time. */
  headBlock: string;
  /** True when older blocks can still be loaded (under the cache cap + not genesis). */
  hasMore: boolean;
  aggregate: WindowAggregateWire;
  /** Per-validator rollup, most-blocks first. */
  miners: MinerStatsWire[];
  /** Newest-first. */
  blocks: BlockStatsWire[];
}
