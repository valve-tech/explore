import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Tests for three thin {ok,result}-envelope clients:
 *   - src/api/gas.ts        — gas-oracle tier recommendations
 *   - src/api/mempool.ts    — pending-tx snapshot
 *   - src/api/portfolio.ts  — token holdings
 *
 * All three share the same error contract: throw the server JSON `error` (or raw
 * text) on a non-ok HTTP status, and throw on `ok:false`. gas/mempool are
 * chain-scoped via ?chainid (default 369 → bare); portfolio always appends
 * &chainid (it builds a fixed query string, not via `scoped`).
 *
 * Fixtures: WPLS holding (decimals 18, symbol WPLS) on PulseChain (369). Verify:
 * https://scan.pulsechain.com/address/0xA1077a294dDE1B09bB078844df40758a5D0f9a27
 */

import { fetchGasOracle } from "../api/gas";
import { fetchPending } from "../api/mempool";
import { fetchHoldings } from "../api/portfolio";

function okRes(json: unknown): Response {
  return { ok: true, status: 200, json: async () => json } as Response;
}
function errRes(text: string, status = 500): Response {
  return { ok: false, status, text: async () => text } as Response;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("fetchGasOracle", () => {
  it("returns the unwrapped oracle state (bare URL for default chain)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      okRes({ ok: true, result: { chainId: 369, baseFee: "1000" } }),
    );
    const out = await fetchGasOracle();
    expect(fetchSpy.mock.calls[0]![0]).toBe("/api/gas/oracle");
    expect(out.baseFee).toBe("1000");
  });

  it("scopes chainid for a non-default chain", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(okRes({ ok: true, result: {} }));
    await fetchGasOracle(1);
    expect(fetchSpy.mock.calls[0]![0]).toBe("/api/gas/oracle?chainid=1");
  });

  it("throws the JSON error on a non-ok status", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      errRes(JSON.stringify({ error: "oracle cold" })),
    );
    await expect(fetchGasOracle()).rejects.toThrow("oracle cold");
  });

  it("throws raw text when the error body isn't JSON", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(errRes("503 Service Unavailable"));
    await expect(fetchGasOracle()).rejects.toThrow("503 Service Unavailable");
  });

  it("falls back to the raw text when the JSON error body has no error field", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(errRes('{"detail":"x"}'));
    await expect(fetchGasOracle()).rejects.toThrow('{"detail":"x"}');
  });

  it("throws on ok:false envelope", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(okRes({ ok: false, error: "no data" }));
    await expect(fetchGasOracle()).rejects.toThrow("no data");
  });

  it("throws the generic message on ok:false with no error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(okRes({ ok: false }));
    await expect(fetchGasOracle()).rejects.toThrow("Unknown API error");
  });
});

describe("fetchPending", () => {
  it("returns the unwrapped mempool snapshot (bare URL)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      okRes({
        ok: true,
        result: { transactions: [], pendingCount: 0, queuedCount: 0, truncated: false },
      }),
    );
    const out = await fetchPending();
    expect(fetchSpy.mock.calls[0]![0]).toBe("/api/mempool/pending");
    expect(out.pendingCount).toBe(0);
  });

  it("scopes chainid for a non-default chain", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(okRes({ ok: true, result: {} }));
    await fetchPending(1);
    expect(fetchSpy.mock.calls[0]![0]).toBe("/api/mempool/pending?chainid=1");
  });

  it("throws the JSON error on a non-ok status", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      errRes(JSON.stringify({ error: "txpool disabled" })),
    );
    await expect(fetchPending()).rejects.toThrow("txpool disabled");
  });

  it("throws raw text when the error body isn't JSON", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(errRes("nope"));
    await expect(fetchPending()).rejects.toThrow("nope");
  });

  it("falls back to the raw text when the JSON error body has no error field", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(errRes('{"x":1}'));
    await expect(fetchPending()).rejects.toThrow('{"x":1}');
  });

  it("throws on ok:false envelope", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(okRes({ ok: false, error: "x" }));
    await expect(fetchPending()).rejects.toThrow("x");
  });

  it("throws the generic message on ok:false with no error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(okRes({ ok: false }));
    await expect(fetchPending()).rejects.toThrow("Unknown API error");
  });
});

describe("fetchHoldings", () => {
  it("builds the address+chainid query and returns the result", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      okRes({
        ok: true,
        result: {
          chainId: 369,
          address: "0xabc",
          native: { symbol: "PLS", balance: "1000" },
          holdings: [
            { tokenAddress: "0xwpls", symbol: "WPLS", name: "Wrapped Pulse", decimals: 18, balance: "5" },
          ],
          indexed: true,
        },
      }),
    );
    const out = await fetchHoldings("0xabc", 369);
    // Default chain (369) omits chainid — byte-identical to the single-chain era
    // and consistent with the other api modules' scoped() URLs.
    expect(fetchSpy.mock.calls[0]![0]).toBe(
      "/api/portfolio/holdings?address=0xabc",
    );
    expect(out.holdings[0]!.symbol).toBe("WPLS");
    expect(out.indexed).toBe(true);
  });

  it("holdings: appends chainid for a non-default chain", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      okRes({
        ok: true,
        result: {
          chainId: 1,
          address: "0xabc",
          native: { symbol: "ETH", balance: "0" },
          holdings: [],
          indexed: false,
        },
      }),
    );
    await fetchHoldings("0xabc", 1);
    expect(fetchSpy.mock.calls[0]![0]).toBe(
      "/api/portfolio/holdings?address=0xabc&chainid=1",
    );
  });

  it("throws the JSON error on a non-ok status", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      errRes(JSON.stringify({ error: "address required" }), 400),
    );
    await expect(fetchHoldings("", 369)).rejects.toThrow("address required");
  });

  it("throws raw text when the error body isn't JSON", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(errRes("server error"));
    await expect(fetchHoldings("0xabc", 369)).rejects.toThrow("server error");
  });

  it("falls back to the raw text when the JSON error body has no error field", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(errRes('{"k":"v"}'));
    await expect(fetchHoldings("0xabc", 369)).rejects.toThrow('{"k":"v"}');
  });

  it("throws on ok:false envelope", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(okRes({ ok: false, error: "no sink" }));
    await expect(fetchHoldings("0xabc", 369)).rejects.toThrow("no sink");
  });

  it("throws the generic message on ok:false with no error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(okRes({ ok: false }));
    await expect(fetchHoldings("0xabc", 369)).rejects.toThrow("Unknown API error");
  });
});
