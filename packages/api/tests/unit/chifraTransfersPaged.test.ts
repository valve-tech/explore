import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  getTokenTransfers,
  isRangeTooLarge,
  TransfersUnavailableError,
  type RawLog,
  type TransferDeps,
} from "../../src/services/chifra/transfers.js";
import { invalidateChifraCache } from "../../src/services/chifra/cache.js";

/**
 * The transfers page reads eth_getLogs in bounded chunks, walks back from a
 * cursor, and returns the next cursor. The old code asked chifra /export for
 * the whole window in one request: it had no cursor, no chunking and no
 * budget, so every test here fails on it.
 */

const TOKEN = "0xA1077a294dDE1B09bB078844df40758a5D0f9a27";
const TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const pad = (a: string) => "0x" + a.replace(/^0x/, "").padStart(64, "0");
const NOW_MS = 1_800_000_000_000;
const HEAD = 1_000_000;
/** One block every 10s, the head at NOW. */
const tsOf = (b: number) => NOW_MS / 1000 - (HEAD - b) * 10;

/** `perBlock` transfer logs in every block. */
function chain(perBlock: number, opts: { maxResults?: number; slowMs?: number } = {}) {
  const calls: Array<[number, number]> = [];
  const deps: TransferDeps = {
    head: async () => HEAD,
    getLogs: async (_t, from, to) => {
      calls.push([from, to]);
      if (opts.slowMs) await new Promise((r) => setTimeout(r, opts.slowMs));
      const n = (to - from + 1) * perBlock;
      if (opts.maxResults !== undefined && n > opts.maxResults) {
        throw new Error("request exceeded max allowed range: query exceeds max results 20000");
      }
      const out: RawLog[] = [];
      for (let b = from; b <= to; b++) {
        for (let i = 0; i < perBlock; i++) {
          out.push({
            address: TOKEN.toLowerCase(),
            topics: [TOPIC, pad("0x01"), pad("0x02")],
            data: "0x0a",
            blockNumber: "0x" + b.toString(16),
            blockTimestamp: "0x" + tsOf(b).toString(16),
            transactionHash: "0x" + b.toString(16),
            logIndex: "0x" + i.toString(16),
          });
        }
      }
      return out;
    },
    blockTimestamp: async (b) => tsOf(b),
    now: () => NOW_MS,
    budgetMs: 5_000,
    chainKey: "369",
  };
  return { deps, calls };
}

beforeEach(() => invalidateChifraCache());

describe("getTokenTransfers (paged eth_getLogs)", () => {
  it("bounds the page: stops at the record limit, never reads the whole window", async () => {
    const { deps, calls } = chain(20);
    const page = await getTokenTransfers(TOKEN, { windowSeconds: 30 * 86400, limit: 1000 }, deps);
    assert.ok(page.records.length >= 1000 && page.records.length < 1000 + 200 * 20 + 1);
    const lowest = Math.min(...calls.map((c) => c[0]));
    assert.ok(HEAD - lowest < 1000, `read ${HEAD - lowest} blocks for one page`);
    assert.equal(page.lastBlock, HEAD);
    assert.equal(page.records[0]!.blockNumber, HEAD, "newest first");
    assert.equal(page.partial, false);
  });

  it("halves a chunk the node calls too large", async () => {
    const { deps, calls } = chain(20, { maxResults: 1000 });
    const page = await getTokenTransfers(TOKEN, { windowSeconds: 86400, limit: 500 }, deps);
    assert.ok(page.records.length >= 500);
    for (const [f, t] of calls.slice(-1)) assert.ok((t - f + 1) * 20 <= 1000);
  });

  it("returns a cursor, and the cursor page continues below the first page", async () => {
    const { deps } = chain(20);
    const p1 = await getTokenTransfers(TOKEN, { windowSeconds: 86400, limit: 1000 }, deps);
    assert.equal(typeof p1.nextCursor, "number");
    assert.equal(p1.nextCursor, p1.firstBlock - 1);
    assert.equal(p1.truncated, true);
    const p2 = await getTokenTransfers(
      TOKEN,
      { windowSeconds: 86400, limit: 1000, cursor: p1.nextCursor! },
      deps,
    );
    assert.equal(p2.lastBlock, p1.nextCursor);
    assert.ok(p2.records[0]!.blockNumber <= p1.nextCursor!);
    const seen = new Set(p1.records.map((r) => `${r.blockNumber}:${r.logIndex}`));
    for (const r of p2.records) assert.ok(!seen.has(`${r.blockNumber}:${r.logIndex}`), "no overlap");
  });

  it("stops at the window floor and returns no cursor there", async () => {
    const { deps } = chain(1);
    const page = await getTokenTransfers(TOKEN, { windowSeconds: 3600, limit: 5000 }, deps);
    assert.equal(page.nextCursor, null);
    assert.equal(page.truncated, false);
    const floor = NOW_MS / 1000 - 3600;
    for (const r of page.records) assert.ok(r.blockTimestamp >= floor);
    assert.equal(page.records.length, 361);
  });

  it("throws a retryable error when no chunk answers inside the budget", async () => {
    const { deps } = chain(1, { slowMs: 200 });
    deps.budgetMs = 50;
    deps.now = () => Date.now();
    await assert.rejects(
      getTokenTransfers(TOKEN, { windowSeconds: 86400 }, deps),
      (e: unknown) => e instanceof TransfersUnavailableError,
    );
  });

  it("serves a repeat request from the cache and keys it by cursor", async () => {
    const { deps, calls } = chain(20);
    await getTokenTransfers(TOKEN, { windowSeconds: 86400, limit: 100 }, deps);
    const n = calls.length;
    await getTokenTransfers(TOKEN, { windowSeconds: 86400, limit: 100 }, deps);
    assert.equal(calls.length, n, "cache hit makes no call");
    await getTokenTransfers(TOKEN, { windowSeconds: 86400, limit: 100, cursor: HEAD - 500 }, deps);
    assert.ok(calls.length > n, "another cursor is another key");
  });
});

describe("isRangeTooLarge", () => {
  it("knows the eRPC and reth range refusals", () => {
    assert.ok(isRangeTooLarge(new Error("request exceeded max allowed range: query exceeds max results 20000")));
    assert.ok(!isRangeTooLarge(new Error("fetch failed")));
  });
});
