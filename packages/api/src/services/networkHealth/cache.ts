/**
 * Network-health analysis — per-chain in-memory cache + orchestrator.
 *
 * Each chain keeps a contiguous ring buffer of the most-recent blocks' computed
 * BlockMetrics (raw bigints, never re-fetched). The head is topped up on demand
 * when a request arrives and the last check is stale — no constant background
 * poller, so idle chains cost nothing. "Load more" extends backward in chunks
 * up to CACHE_CAP, oldest evicted as new head blocks arrive.
 *
 * Only computed aggregates are cached (≈ <1KB/block), so 2560 × 3 chains is a
 * few MB. The ChainHealthCache class takes an injected fetcher so the buffer
 * logic is testable without RPC.
 */

import { getChain } from "../chains/registry.js";
import { getRpcClient } from "../chains/clients.js";
import { dedupePromise } from "../../lib/dedupePromise.js";
import {
  aggregateMiners,
  aggregateWindow,
  computeLadder,
  serializeBlock,
} from "./compute.js";
import { fetchBlockLadderInput, fetchBlockMetrics } from "./fetch.js";
import {
  type BlockLadderWire,
  type BlockMetrics,
  type NetworkHealthResponse,
} from "./types.js";

export const INITIAL_WINDOW = 64; // cold-warm size; matches the page's initial limit
export const LOAD_CHUNK = 256;
export const CACHE_CAP = 2560;
export const MAX_LIMIT = 512;
const HEAD_TTL_MS = 4_000; // sub-block-time; head is topped up at most this often
const FETCH_CONCURRENCY = 10;

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await fn(items[i]!);
    }
  }
  const n = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}

export interface CacheDeps {
  getHead: () => Promise<bigint>;
  fetchBlock: (n: bigint) => Promise<BlockMetrics>;
  cap?: number;
  initialWindow?: number;
  loadChunk?: number;
  headTtlMs?: number;
  concurrency?: number;
  now?: () => number;
}

export class ChainHealthCache {
  /** Ascending by block number, contiguous, length ≤ cap. */
  private blocks: BlockMetrics[] = [];
  private lastHeadCheck = -Infinity;

  private readonly cap: number;
  private readonly initialWindow: number;
  private readonly loadChunk: number;
  private readonly headTtlMs: number;
  private readonly concurrency: number;
  private readonly now: () => number;
  private readonly deps: CacheDeps;

  constructor(deps: CacheDeps) {
    this.deps = deps;
    this.cap = deps.cap ?? CACHE_CAP;
    this.initialWindow = deps.initialWindow ?? INITIAL_WINDOW;
    this.loadChunk = deps.loadChunk ?? LOAD_CHUNK;
    this.headTtlMs = deps.headTtlMs ?? HEAD_TTL_MS;
    this.concurrency = deps.concurrency ?? FETCH_CONCURRENCY;
    this.now = deps.now ?? (() => Date.now());
  }

  head(): bigint | null {
    return this.blocks.length ? this.blocks[this.blocks.length - 1]!.number : null;
  }

  size(): number {
    return this.blocks.length;
  }

  private merge(items: BlockMetrics[]): void {
    const byNum = new Map<string, BlockMetrics>();
    for (const b of this.blocks) byNum.set(b.number.toString(), b);
    for (const b of items) byNum.set(b.number.toString(), b);
    this.blocks = [...byNum.values()].sort((a, b) =>
      a.number < b.number ? -1 : a.number > b.number ? 1 : 0,
    );
  }

  private async loadRange(from: bigint, to: bigint): Promise<void> {
    if (to < from) return;
    const nums: bigint[] = [];
    for (let n = from; n <= to; n += 1n) nums.push(n);
    const fetched = await mapWithConcurrency(nums, this.concurrency, (n) =>
      this.deps.fetchBlock(n),
    );
    this.merge(fetched);
  }

  /** Warm (cold) or top up the head (stale). Bounded: a long gap resets to the latest window. */
  async ensureFresh(): Promise<void> {
    const now = this.now();
    if (this.blocks.length === 0) {
      const head = await this.deps.getHead();
      const from = head - BigInt(this.initialWindow) + 1n;
      await this.loadRange(from < 0n ? 0n : from, head);
      this.lastHeadCheck = now;
      return;
    }
    if (now - this.lastHeadCheck < this.headTtlMs) return;
    const head = await this.deps.getHead();
    this.lastHeadCheck = now;
    const cachedHead = this.blocks[this.blocks.length - 1]!.number;
    if (head <= cachedHead) return;
    if (head - cachedHead > BigInt(this.initialWindow)) {
      // Away too long — cheaper to reset to the latest window than backfill.
      this.blocks = [];
      const from = head - BigInt(this.initialWindow) + 1n;
      await this.loadRange(from < 0n ? 0n : from, head);
      return;
    }
    await this.loadRange(cachedHead + 1n, head);
    if (this.blocks.length > this.cap) {
      this.blocks = this.blocks.slice(this.blocks.length - this.cap);
    }
  }

  /** Ensure ≥ `limit` blocks strictly below `ceiling`, loading older chunks up to the cap. */
  async ensureBelow(ceiling: bigint, limit: number): Promise<void> {
    let guard = 0;
    while (guard++ < 64) {
      const below = this.blocks.filter((b) => b.number < ceiling).length;
      if (below >= limit) return;
      if (this.blocks.length >= this.cap) return;
      const oldest = this.blocks[0]?.number ?? ceiling;
      if (oldest <= 0n) return;
      const room = this.cap - this.blocks.length;
      const want = Math.min(this.loadChunk, room);
      const to = oldest - 1n;
      let from = to - BigInt(want) + 1n;
      if (from < 0n) from = 0n;
      await this.loadRange(from, to);
    }
  }

  /** The newest `limit` cached blocks strictly below `ceiling`, newest-first. */
  getWindow(ceiling: bigint, limit: number): BlockMetrics[] {
    const below = this.blocks.filter((b) => b.number < ceiling);
    const slice = below.slice(Math.max(0, below.length - limit));
    return slice.reverse();
  }

  hasMore(windowOldest: bigint | null): boolean {
    if (windowOldest === null || windowOldest <= 0n) return false;
    if (this.blocks.some((b) => b.number < windowOldest)) return true;
    return this.blocks.length < this.cap;
  }
}

// ---------------------------------------------------------------------------
// Module-level orchestration (wires the real RPC client per chain)
// ---------------------------------------------------------------------------

const caches = new Map<number, ChainHealthCache>();
const inFlight = new Map<string, Promise<NetworkHealthResponse>>();

function getCache(chainId: number, burnsBaseFee: boolean): ChainHealthCache {
  let cache = caches.get(chainId);
  if (!cache) {
    const client = getRpcClient(chainId);
    cache = new ChainHealthCache({
      getHead: () => client.getBlockNumber(),
      fetchBlock: (n) => fetchBlockMetrics(client, n, burnsBaseFee),
    });
    caches.set(chainId, cache);
  }
  return cache;
}

/**
 * Network-health window for a chain. `before` (exclusive) drives load-more;
 * omitted = the latest window. Identical concurrent calls are collapsed.
 */
export async function getNetworkHealth(
  chainId: number,
  before: bigint | null,
  limit: number,
): Promise<NetworkHealthResponse> {
  const key = `${chainId}:${before ?? "head"}:${limit}`;
  return dedupePromise(inFlight, key, async () => {
    const config = getChain(chainId);
    const burnsBaseFee = config.burnsBaseFee ?? true;
    const cache = getCache(chainId, burnsBaseFee);

    await cache.ensureFresh();
    const head = cache.head();
    const ceiling = before ?? (head !== null ? head + 1n : 0n);
    await cache.ensureBelow(ceiling, limit);

    const window = cache.getWindow(ceiling, limit);
    const oldest = window.length ? window[window.length - 1]!.number : null;
    return {
      chainId,
      burnsBaseFee,
      headBlock: (head ?? 0n).toString(),
      hasMore: cache.hasMore(oldest),
      aggregate: aggregateWindow(window),
      miners: aggregateMiners(window),
      blocks: window.map(serializeBlock),
    };
  });
}

/**
 * One block's fee ladder, fetched on demand (not cached — it's a click-through
 * detail). Two RPC calls per request.
 */
export async function getBlockLadder(
  chainId: number,
  blockNumber: bigint,
): Promise<BlockLadderWire> {
  const config = getChain(chainId);
  const burnsBaseFee = config.burnsBaseFee ?? true;
  const input = await fetchBlockLadderInput(getRpcClient(chainId), blockNumber);
  return computeLadder(input, { burnsBaseFee });
}

/** Test seam: drop all cached state. */
export function __resetNetworkHealthCaches(): void {
  caches.clear();
  inFlight.clear();
}
