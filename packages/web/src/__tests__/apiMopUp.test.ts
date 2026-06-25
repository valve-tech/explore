import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * Coverage mop-up for the api/* clients — the specific arms the existing
 * api*.test.ts files leave uncovered:
 *
 *  - source.ts        post-loop returns when the retry budget is *empty*
 *                     (SOURCE_RETRY_BACKOFF_MS = []) so the for-loop body
 *                     never runs and control falls through to `return null`
 *                     / `throw "unreachable"`.
 *  - contractMeta.ts  malformed-JSON → fatal (res.json() throws), and the
 *                     post-loop `return null` with an empty RETRY budget.
 *  - explorer.ts      toBlockTag's already-hex short input (line 452) and
 *                     mapRpcBlock's formatEther-throws → valuePLS "0" catch.
 *
 * Real fixture: WPLS 0xA1077a294dDE1B09bB078844df40758a5D0f9a27 (chain 369).
 * https://scan.pulsechain.com/address/0xA1077a294dDE1B09bB078844df40758a5D0f9a27
 */

const WPLS = "0xA1077a294dDE1B09bB078844df40758a5D0f9a27";

function okRes(json: unknown): Response {
  return { ok: true, status: 200, json: async () => json } as Response;
}

/* ------------------------------------------------------------------ */
/* source.ts — empty-budget fall-through                              */
/* ------------------------------------------------------------------ */

describe("source.ts — empty retry budget falls through to the post-loop return", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("fetchTraceSourceFiles returns null when the budget is empty (loop never runs)", async () => {
    const source = await import("../api/source");
    const saved = [...source.SOURCE_RETRY_BACKOFF_MS];
    source.SOURCE_RETRY_BACKOFF_MS.length = 0; // []
    try {
      // fetch must never be called — the loop body is skipped entirely.
      const spy = vi.spyOn(globalThis, "fetch");
      const out = await source.fetchTraceSourceFiles(WPLS);
      expect(out).toBeNull();
      expect(spy).not.toHaveBeenCalled();
    } finally {
      source.SOURCE_RETRY_BACKOFF_MS.length = 0;
      source.SOURCE_RETRY_BACKOFF_MS.push(...saved);
    }
  });

  it("fetchContractSourceWithRetry throws the unreachable guard on an empty budget", async () => {
    const source = await import("../api/source");
    const saved = [...source.SOURCE_RETRY_BACKOFF_MS];
    source.SOURCE_RETRY_BACKOFF_MS.length = 0;
    try {
      await expect(source.fetchContractSourceWithRetry(WPLS)).rejects.toThrow(
        /unreachable/i,
      );
    } finally {
      source.SOURCE_RETRY_BACKOFF_MS.length = 0;
      source.SOURCE_RETRY_BACKOFF_MS.push(...saved);
    }
  });

  it("fetchTraceSourceMap returns null when the budget is empty", async () => {
    const source = await import("../api/source");
    const saved = [...source.SOURCE_RETRY_BACKOFF_MS];
    source.SOURCE_RETRY_BACKOFF_MS.length = 0;
    try {
      const out = await source.fetchTraceSourceMap(WPLS, [0, 4]);
      expect(out).toBeNull();
    } finally {
      source.SOURCE_RETRY_BACKOFF_MS.length = 0;
      source.SOURCE_RETRY_BACKOFF_MS.push(...saved);
    }
  });
});

/* ------------------------------------------------------------------ */
/* contractMeta.ts — malformed JSON + empty-budget post-loop          */
/* ------------------------------------------------------------------ */

describe("contractMeta.ts — malformed JSON and empty-budget fall-through", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("treats a res.json() throw as fatal (malformed JSON → give up, no retry)", async () => {
    const { resolveContractMeta } = await import("../api/contractMeta");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("bad json");
      },
    } as unknown as Response);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const addr = "0x00000000000000000000000000000000000000d1";
    const pending = resolveContractMeta([addr]);
    await vi.runAllTimersAsync();
    const out = await pending;

    // Malformed JSON is fatal → no address in the result, exactly one attempt.
    expect(out[addr]).toBeUndefined();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/non-retryable error.*malformed JSON/i),
    );
  });

  it("falls through to the post-loop null when the retry budget is empty", async () => {
    const mod = await import("../api/contractMeta");
    const saved = [...mod.RETRY_BACKOFF_MS];
    mod.RETRY_BACKOFF_MS.length = 0; // []  → for-loop body never executes
    try {
      // A transient response would normally retry; with an empty budget the
      // loop is skipped and fetchMetaWithRetry returns the post-loop null.
      const spy = vi.spyOn(globalThis, "fetch");
      const addr = "0x00000000000000000000000000000000000000d2";
      const pending = mod.resolveContractMeta([addr]);
      await vi.runAllTimersAsync();
      const out = await pending;
      expect(out[addr]).toBeUndefined();
      expect(spy).not.toHaveBeenCalled();
    } finally {
      mod.RETRY_BACKOFF_MS.length = 0;
      mod.RETRY_BACKOFF_MS.push(...saved);
    }
  });
});

/* ------------------------------------------------------------------ */
/* explorer.ts — toBlockTag hex passthrough + mapRpcBlock value catch  */
/* ------------------------------------------------------------------ */

describe("explorer.ts — fetchBlock edge arms", () => {
  beforeEach(() => {
    localStorage.clear(); // no RPC override → dispatcher path
    vi.restoreAllMocks();
  });
  afterEach(() => vi.restoreAllMocks());

  it("passes an already-hex block tag straight through (toBlockTag 0x branch)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      okRes({
        jsonrpc: "2.0",
        result: {
          number: "0x1a",
          hash: "0xblock",
          parentHash: "0xparent",
          timestamp: "0x64",
          miner: "0xminer",
          gasUsed: "0x0",
          gasLimit: "0x0",
          baseFeePerGas: null,
          size: "0x10",
          transactions: [],
        },
      }),
    );
    const { fetchBlock } = await import("../api/explorer");
    // "0x1a" is hex but NOT a 66-char hash → toBlockTag returns it unchanged
    // and the dispatcher uses eth_getBlockByNumber with tag=0x1a.
    await fetchBlock("0x1a");
    const url = String(fetchSpy.mock.calls[0]![0]);
    expect(url).toContain("eth_getBlockByNumber");
    expect(url).toContain("tag=0x1a");
  });

  // NOTE: the mapRpcBlock `catch { valuePLS = "0" }` (explorer.ts line 590) is
  // unreachable — any tx.value that makes formatEther(hexToBigInt(value)) throw
  // at line 588 also makes the *unguarded* hexToBigInt(value) at line 598 throw
  // first, which propagates out of map(). No input reaches the catch arm.
});
