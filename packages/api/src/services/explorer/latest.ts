/**
 * Services backing the Explorer home view (Bundle 1 of the API spec).
 *
 *  - getLatestSummary  → §2.1 GET /api/latest/summary
 *  - getRecentBlocks   → §2.2 GET /api/blocks?limit&before
 *  - getRecentTxs      → §2.3 GET /api/txs/recent?limit
 *
 * The home view is the highest-frequency call surface in the app — every
 * page load hits at least the summary. We aggressively memoize against
 * the latest block number so repeat callers within a single block
 * generally read from cache.
 */

import { formatEther, type PublicClient } from "viem";
import { chainClient, currentChainId } from "../chains/context.js";
import { getRpcClient } from "../chains/clients.js";
import { getChain, DEFAULT_CHAIN_ID } from "../chains/registry.js";
import { lookupSelectors } from "../signatures.js";

// NB: spec §4a calls for `ots_getBlockDetails` here, but PulseChain's
// public RPC currently returns -32601 for it. The wrapper in
// `./ots.ts` still exists for later bundles (Bundle 2 needs
// `ots_getBlockTransactions`). For Bundle 1 we just use the standard
// `eth_getBlockByNumber` path — costs us logsBloom + the issuance
// fields, neither of which the home view actually displays.

const SUMMARY_TTL_MS = 3_000;
const RECENT_TXS_TTL_MS = 3_000;

// ---------------------------------------------------------------------------
// Common block shape returned to consumers
// ---------------------------------------------------------------------------

export interface BlockHeader {
  number: string;
  hash: string;
  timestamp: number;
  miner: string;
  transactionCount: number;
  gasUsed: string;
  gasLimit: string;
  baseFeePerGas: string | null;
}

/**
 * Fetch a single block header via `eth_getBlockByNumber` with
 * `includeTransactions: false`. The result's `transactions` field is a
 * list of hashes, so `.length` is the tx count.
 */
async function getBlockHeader(
  tagOrNumber: "latest" | "finalized" | "safe" | bigint,
  client: PublicClient = chainClient(),
): Promise<BlockHeader> {
  const block =
    typeof tagOrNumber === "bigint"
      ? await client.getBlock({
          blockNumber: tagOrNumber,
          includeTransactions: false,
        })
      : await client.getBlock({
          blockTag: tagOrNumber,
          includeTransactions: false,
        });

  return {
    number: block.number.toString(10),
    hash: block.hash,
    timestamp: Number(block.timestamp),
    miner: block.miner,
    transactionCount: block.transactions.length,
    gasUsed: block.gasUsed.toString(10),
    gasLimit: block.gasLimit.toString(10),
    baseFeePerGas: block.baseFeePerGas ? block.baseFeePerGas.toString(10) : null,
  };
}

// ---------------------------------------------------------------------------
// §2.1 — getLatestSummary
// ---------------------------------------------------------------------------

export interface LatestSummary {
  latestBlock: BlockHeader;
  finalizedBlock: {
    number: string;
    hash: string;
    timestamp: number;
    lagBlocks: number;
  };
  gasPrice: {
    baseFeePerGas: string;
    suggestedPriorityFee: string;
  };
  network: {
    chainId: number;
    name: string;
  };
}

const summaryCache = new Map<number, { v: LatestSummary; t: number }>();

export async function getLatestSummary(
  chainId: number = DEFAULT_CHAIN_ID,
): Promise<LatestSummary> {
  const cached = summaryCache.get(chainId);
  if (cached && Date.now() - cached.t < SUMMARY_TTL_MS) {
    return cached.v;
  }

  const client = getRpcClient(chainId);

  // Parallelize: latest header + finalized header + priority fee. A failed
  // finalized read isn't fatal — pre-merge chains and some forks don't have
  // it; we surface "lag 0 / same as latest" when that happens.
  const [latest, finalized, priorityFee] = await Promise.all([
    getBlockHeader("latest", client),
    getBlockHeader("finalized", client).catch(() => null),
    client.estimateMaxPriorityFeePerGas().catch(() => 0n),
  ]);

  const baseFeePerGas = latest.baseFeePerGas ?? "0";

  const finalizedOut =
    finalized !== null
      ? {
          number: finalized.number,
          hash: finalized.hash,
          timestamp: finalized.timestamp,
          lagBlocks: Number(BigInt(latest.number) - BigInt(finalized.number)),
        }
      : {
          number: latest.number,
          hash: latest.hash,
          timestamp: latest.timestamp,
          lagBlocks: 0,
        };

  const summary: LatestSummary = {
    latestBlock: latest,
    finalizedBlock: finalizedOut,
    gasPrice: {
      baseFeePerGas,
      suggestedPriorityFee: priorityFee.toString(10),
    },
    network: { chainId, name: getChain(chainId).name },
  };

  summaryCache.set(chainId, { v: summary, t: Date.now() });
  return summary;
}

// ---------------------------------------------------------------------------
// §2.2 — getRecentBlocks
// ---------------------------------------------------------------------------

export interface RecentBlocksResult {
  blocks: BlockHeader[];
  cursor: { before: string } | null;
}

const RECENT_BLOCKS_LIMIT_MAX = 50;

export async function getRecentBlocks(opts: {
  limit?: number;
  before?: string;
}): Promise<RecentBlocksResult> {
  const limit = Math.min(
    Math.max(1, Math.floor(opts.limit ?? 10)),
    RECENT_BLOCKS_LIMIT_MAX,
  );

  // Resolve the upper-bound block number.
  const headNumber = opts.before
    ? BigInt(opts.before) - 1n
    : await chainClient().getBlockNumber();

  if (headNumber < 0n) {
    return { blocks: [], cursor: null };
  }

  const numbers: bigint[] = [];
  for (let i = 0n; i < BigInt(limit); i++) {
    const n = headNumber - i;
    if (n < 0n) break;
    numbers.push(n);
  }

  const blocks = await Promise.all(numbers.map((n) => getBlockHeader(n)));

  const tail = numbers[numbers.length - 1];
  const cursor =
    tail !== undefined && tail > 0n ? { before: tail.toString(10) } : null;

  return { blocks, cursor };
}

// ---------------------------------------------------------------------------
// §2.3 — getRecentTxs
// ---------------------------------------------------------------------------

export interface RecentTx {
  hash: string;
  blockNumber: string;
  timestamp: number;
  from: string;
  to: string | null;
  value: string;
  valuePLS: string;
  gasUsed: string | null;
  /** viem tx-type string: "legacy" | "eip2930" | "eip1559" | "eip4844". */
  type: string;
  /** Legacy/2930 gas price; null for 1559+. Wei decimal string. */
  gasPrice: string | null;
  /** 1559+ fee cap (max base + tip); null for legacy. Wei decimal string. */
  maxFeePerGas: string | null;
  /** 1559+ tip — what the node sorts on; null for legacy. Wei. */
  maxPriorityFeePerGas: string | null;
  methodId: string;
  methodName: string | null;
}

export interface RecentTxsResult {
  transactions: RecentTx[];
}

const RECENT_TXS_LIMIT_MAX = 50;

const recentTxsCache = new Map<
  number,
  { limit: number; v: RecentTxsResult; t: number }
>();

export async function getRecentTxs(limit: number = 10): Promise<RecentTxsResult> {
  const n = Math.min(Math.max(1, Math.floor(limit)), RECENT_TXS_LIMIT_MAX);

  const chainId = currentChainId();
  const cached = recentTxsCache.get(chainId);
  if (cached && cached.limit === n && Date.now() - cached.t < RECENT_TXS_TTL_MS) {
    return cached.v;
  }

  // Walk back from latest until we've gathered at least `n` transactions.
  // Empty blocks are common on dev forks; cap the scan window so we don't
  // walk arbitrarily far back on idle chains.
  const SCAN_WINDOW = 20;
  const head = await chainClient().getBlockNumber();
  const txs: RecentTx[] = [];

  for (let i = 0n; i < BigInt(SCAN_WINDOW) && txs.length < n; i++) {
    const blockNumber = head - i;
    if (blockNumber < 0n) break;

    const block = await chainClient().getBlock({
      blockNumber,
      includeTransactions: true,
    });
    const timestamp = Number(block.timestamp);

    for (const tx of block.transactions) {
      if (typeof tx === "string") continue; // shouldn't happen with full=true
      // A selector is four bytes. `input.slice(0, 10)` on a shorter blob
      // yields a fragment that is not a selector and can never resolve, so
      // require the full width — same rule as the address tx list.
      const methodId = (tx.input?.length ?? 0) >= 10 ? tx.input.slice(0, 10) : "";

      // viem narrows gas fields by tx.type; read through a loose view so we
      // can pull whichever set the tx carries (legacy gasPrice vs 1559 caps).
      const g = tx as {
        gasPrice?: bigint;
        maxFeePerGas?: bigint;
        maxPriorityFeePerGas?: bigint;
      };
      txs.push({
        hash: tx.hash,
        blockNumber: blockNumber.toString(10),
        timestamp,
        from: tx.from,
        to: tx.to ?? null,
        value: (tx.value ?? 0n).toString(10),
        valuePLS: formatEther(tx.value ?? 0n),
        gasUsed: null, // receipts not pulled here — kept light
        type: tx.type ?? "legacy",
        gasPrice: g.gasPrice != null ? g.gasPrice.toString(10) : null,
        maxFeePerGas: g.maxFeePerGas != null ? g.maxFeePerGas.toString(10) : null,
        maxPriorityFeePerGas:
          g.maxPriorityFeePerGas != null
            ? g.maxPriorityFeePerGas.toString(10)
            : null,
        methodId,
        methodName: null, // filled below
      });

      if (txs.length >= n) break;
    }
  }

  // Resolve methodName via the 4byte cache. lookupSelectors dedups +
  // batches; we keep only the first match per selector for the compact
  // "methodName" display the home view needs (full signature lookups go
  // through /api/signatures/:selector).
  const selectors = [...new Set(txs.map((t) => t.methodId).filter(Boolean))];
  if (selectors.length > 0) {
    let matches: Awaited<ReturnType<typeof lookupSelectors>> = {};
    try {
      matches = await lookupSelectors(selectors);
    } catch {
      // Sourcify/4byte unreachable — leave methodNames null. Not fatal.
    }
    for (const t of txs) {
      if (!t.methodId) continue;
      const first = matches[t.methodId]?.[0]?.textSignature;
      t.methodName = first ? first.split("(")[0] ?? first : null;
    }
  }

  const result: RecentTxsResult = { transactions: txs };
  recentTxsCache.set(chainId, { limit: n, v: result, t: Date.now() });
  return result;
}
