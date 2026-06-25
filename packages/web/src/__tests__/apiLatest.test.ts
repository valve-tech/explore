import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Tests for src/api/latest.ts — the home-view "latest" clients (summary, recent
 * blocks with cursor pagination, recent txs). All go through the shared
 * `apiFetch` envelope helper which throws on a non-ok HTTP status (JSON or raw
 * text error) and on `ok:false`.
 *
 * The block fixture uses a real PulseChain block number for verifiability:
 * block 26804492 — https://scan.pulsechain.com/block/26804492 (chainId 369).
 * Only the envelope shape is asserted here; the number is real.
 */

import {
  fetchLatestSummary,
  fetchRecentBlocks,
  fetchRecentTxs,
} from "../api/latest";

function okRes(json: unknown): Response {
  return { ok: true, status: 200, json: async () => json } as Response;
}
function errRes(text: string, status = 500): Response {
  return { ok: false, status, text: async () => text } as Response;
}

const BLOCK_HEADER = {
  number: "26804492",
  hash: "0xblock",
  timestamp: 1700000000,
  miner: "0xminer",
  transactionCount: 3,
  gasUsed: "100000",
  gasLimit: "30000000",
  baseFeePerGas: null,
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("fetchLatestSummary", () => {
  it("returns the unwrapped result on the default chain (bare URL)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      okRes({ ok: true, result: { latestBlock: BLOCK_HEADER } }),
    );
    const out = await fetchLatestSummary();
    expect(fetchSpy.mock.calls[0]![0]).toBe("/api/latest/summary");
    expect(out.latestBlock.number).toBe("26804492");
  });

  it("scopes chainid for a non-default chain", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(okRes({ ok: true, result: {} }));
    await fetchLatestSummary(1);
    expect(fetchSpy.mock.calls[0]![0]).toBe("/api/latest/summary?chainid=1");
  });

  it("throws the JSON error on a non-ok HTTP status", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      errRes(JSON.stringify({ error: "node lagging" })),
    );
    await expect(fetchLatestSummary()).rejects.toThrow("node lagging");
  });

  it("throws the raw text when the error body isn't JSON", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(errRes("502 Bad Gateway"));
    await expect(fetchLatestSummary()).rejects.toThrow("502 Bad Gateway");
  });

  it("falls back to the raw text when the JSON error body has no error field", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(errRes('{"detail":"x"}'));
    await expect(fetchLatestSummary()).rejects.toThrow('{"detail":"x"}');
  });

  it("throws on ok:false even with a 200 status", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      okRes({ ok: false, error: "stale" }),
    );
    await expect(fetchLatestSummary()).rejects.toThrow("stale");
  });

  it("throws the generic message on ok:false with no error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(okRes({ ok: false }));
    await expect(fetchLatestSummary()).rejects.toThrow("Unknown API error");
  });
});

describe("fetchRecentBlocks", () => {
  it("omits the query string when no limit/before given", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      okRes({ ok: true, result: { blocks: [BLOCK_HEADER], cursor: null } }),
    );
    const out = await fetchRecentBlocks({});
    expect(fetchSpy.mock.calls[0]![0]).toBe("/api/blocks");
    expect(out.blocks).toHaveLength(1);
  });

  it("builds limit + before query and scopes chainid", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      okRes({ ok: true, result: { blocks: [], cursor: { before: "0x5" } } }),
    );
    await fetchRecentBlocks({ limit: 10, before: "0x10", chainId: 1 });
    expect(fetchSpy.mock.calls[0]![0]).toBe(
      "/api/blocks?limit=10&before=0x10&chainid=1",
    );
  });
});

describe("fetchRecentTxs", () => {
  it("uses the default limit on the default chain", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(okRes({ ok: true, result: { transactions: [] } }));
    await fetchRecentTxs();
    expect(fetchSpy.mock.calls[0]![0]).toBe("/api/txs/recent?limit=10");
  });

  it("threads a custom limit + chainid", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(okRes({ ok: true, result: { transactions: [] } }));
    await fetchRecentTxs(25, 1);
    expect(fetchSpy.mock.calls[0]![0]).toBe("/api/txs/recent?limit=25&chainid=1");
  });
});
