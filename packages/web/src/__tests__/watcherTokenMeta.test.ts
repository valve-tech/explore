import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * tokenMeta is the watcher's single effectful read (decimals/symbol). It now
 * reads through the backend `/api/token/:addr/meta` endpoint (one call returns
 * decimals + symbol), so we mock that fetch and exercise the memoization +
 * failure-eviction logic without a network: read a token once, key by chain,
 * treat symbol as optional, and do NOT cache a failed (decimals: null) read.
 */

const fetchTokenMeta = vi.fn();

vi.mock("../api/explorer", () => ({
  fetchTokenMeta: (...args: unknown[]) => fetchTokenMeta(...args),
}));

import { getTokenMeta, resetTokenMeta } from "../lib/watcher/tokenMeta";

const TOKEN = "0xAbC0000000000000000000000000000000000001"; // mixed case

beforeEach(() => {
  resetTokenMeta();
  fetchTokenMeta.mockReset();
});

describe("watcher/tokenMeta", () => {
  it("reads decimals + symbol once and memoizes per (chain, token)", async () => {
    fetchTokenMeta.mockResolvedValue({
      address: TOKEN.toLowerCase(),
      decimals: 6,
      symbol: "USDC",
      name: "USD Coin",
    });

    const a = await getTokenMeta(369, TOKEN);
    const b = await getTokenMeta(369, TOKEN.toLowerCase()); // same token, normalized

    expect(a).toEqual({ decimals: 6, symbol: "USDC" });
    expect(b).toBe(a); // same memoized promise resolution
    expect(fetchTokenMeta).toHaveBeenCalledTimes(1);
  });

  it("keys the cache by chain — same token on two chains reads twice", async () => {
    fetchTokenMeta.mockResolvedValue({
      address: TOKEN.toLowerCase(),
      decimals: 18,
      symbol: "WPLS",
      name: null,
    });

    await getTokenMeta(1, TOKEN);
    await getTokenMeta(369, TOKEN);

    expect(fetchTokenMeta).toHaveBeenCalledTimes(2); // once per chain
  });

  it("returns decimals with no symbol when the token has none", async () => {
    fetchTokenMeta.mockResolvedValue({
      address: TOKEN.toLowerCase(),
      decimals: 18,
      symbol: null,
      name: null,
    });

    expect(await getTokenMeta(1, TOKEN)).toEqual({ decimals: 18, symbol: undefined });
  });

  it("returns null and does NOT cache a failed (decimals: null) read", async () => {
    fetchTokenMeta.mockResolvedValueOnce({
      address: TOKEN.toLowerCase(),
      decimals: null,
      symbol: null,
      name: null,
    });
    expect(await getTokenMeta(1, TOKEN)).toBeNull();

    // Cache was evicted, so the next transfer of the same token retries.
    fetchTokenMeta.mockResolvedValueOnce({
      address: TOKEN.toLowerCase(),
      decimals: 8,
      symbol: "OK",
      name: null,
    });
    expect(await getTokenMeta(1, TOKEN)).toEqual({ decimals: 8, symbol: "OK" });
  });

  it("returns null and does NOT cache when the request rejects", async () => {
    fetchTokenMeta.mockRejectedValueOnce(new Error("network down"));
    expect(await getTokenMeta(1, TOKEN)).toBeNull();

    fetchTokenMeta.mockResolvedValueOnce({
      address: TOKEN.toLowerCase(),
      decimals: 8,
      symbol: "OK",
      name: null,
    });
    expect(await getTokenMeta(1, TOKEN)).toEqual({ decimals: 8, symbol: "OK" });
  });
});
