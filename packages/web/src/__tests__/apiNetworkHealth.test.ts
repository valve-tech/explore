import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Tests for src/api/networkHealth.ts — the HTTP client for the network-health
 * window aggregate and per-block fee ladder. Both throw on any non-ok / ok:false
 * / missing-result response (so React Query never caches an empty window), with
 * the server `error` string preferred over the HTTP fallback.
 *
 * Real-world fixture: PulseChain block 26804492 burned 57209328955594993478 wei,
 * tips 16308415764020445994737, paid 16365625092976040988215 (raw-wei strings,
 * formatted at the render edge). Verify: https://scan.pulsechain.com/block/26804492
 */

import { fetchNetworkHealth, fetchBlockLadder } from "../api/networkHealth";

function okRes(json: unknown): Response {
  return { ok: true, status: 200, json: async () => json } as Response;
}
function jsonRes(json: unknown, status: number): Response {
  return { ok: status < 400, status, json: async () => json } as Response;
}
function badJsonRes(status: number): Response {
  return {
    ok: status < 400,
    status,
    json: async () => {
      throw new Error("not json");
    },
  } as unknown as Response;
}

const AGG_RESULT = {
  chainId: 369,
  burnsBaseFee: true,
  headBlock: "26804492",
  hasMore: false,
  aggregate: { burned: "57209328955594993478" },
  miners: [],
  blocks: [{ number: "26804492", burned: "57209328955594993478" }],
};

const LADDER_RESULT = {
  number: "26804492",
  timestamp: 1700000000,
  baseFeePerGas: "0",
  txCount: 3,
  burnsBaseFee: true,
  priorityInversionRate: null,
  txs: [],
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("fetchNetworkHealth", () => {
  it("builds the limit URL (bare for default chain) and returns the result", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(okRes({ ok: true, result: AGG_RESULT }));
    const out = await fetchNetworkHealth(369, 50);
    expect(fetchSpy.mock.calls[0]![0]).toBe("/api/network-health?limit=50");
    expect(out.aggregate.burned).toBe("57209328955594993478");
  });

  it("scopes chainid for a non-default chain (combining ? and &)", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(okRes({ ok: true, result: AGG_RESULT }));
    await fetchNetworkHealth(1, 10);
    expect(fetchSpy.mock.calls[0]![0]).toBe("/api/network-health?limit=10&chainid=1");
  });

  it("throws the server error on a non-ok response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonRes({ ok: false, error: "cold cache warming" }, 503),
    );
    await expect(fetchNetworkHealth(369, 10)).rejects.toThrow("cold cache warming");
  });

  it("throws an HTTP fallback when the error body is unparseable", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(badJsonRes(500));
    await expect(fetchNetworkHealth(369, 10)).rejects.toThrow("network-health HTTP 500");
  });

  it("throws when ok:true but result is missing", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(okRes({ ok: true }));
    await expect(fetchNetworkHealth(369, 10)).rejects.toThrow(/network-health HTTP 200/);
  });
});

describe("fetchBlockLadder", () => {
  it("builds the block route and returns the ladder", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(okRes({ ok: true, result: LADDER_RESULT }));
    const out = await fetchBlockLadder(369, "26804492");
    expect(fetchSpy.mock.calls[0]![0]).toBe("/api/network-health/block/26804492");
    expect(out.number).toBe("26804492");
  });

  it("scopes chainid for a non-default chain", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(okRes({ ok: true, result: LADDER_RESULT }));
    await fetchBlockLadder(1, "100");
    expect(fetchSpy.mock.calls[0]![0]).toBe("/api/network-health/block/100?chainid=1");
  });

  it("throws the server error on a non-ok response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonRes({ ok: false, error: "block not found" }, 404),
    );
    await expect(fetchBlockLadder(369, "0")).rejects.toThrow("block not found");
  });

  it("throws an HTTP fallback when the error body is unparseable", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(badJsonRes(502));
    await expect(fetchBlockLadder(369, "0")).rejects.toThrow("ladder HTTP 502");
  });

  it("throws when ok:true but result is missing", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(okRes({ ok: true }));
    await expect(fetchBlockLadder(369, "0")).rejects.toThrow(/ladder HTTP 200/);
  });
});
