import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Tests for src/api/simulate.ts — single + bundle simulation and the fork
 * simulate/from-hash helpers. The interesting branches are the
 * buildStateOverridesPayload pruning logic (drop empty entries / empty storage)
 * and the {ok,result} envelope unwrap, plus the JSON-vs-text error parsing.
 *
 * Fixtures are synthetic: a from/to pair and a state override. Default chain is
 * 369 (PulseChain), so a bare /api/simulate URL is expected; chain 1 = Ethereum
 * asserts the ?chainid scoping.
 */

import {
  simulateTransaction,
  simulateBundle,
  forkSimulate,
  simulateFromHash,
} from "../api/simulate";
import type { SimulationRequest, BundleSimulationRequest } from "../types";

function okRes(json: unknown): Response {
  return { ok: true, status: 200, json: async () => json } as Response;
}
function errRes(text: string, status = 500): Response {
  return { ok: false, status, text: async () => text } as Response;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("simulateTransaction", () => {
  it("builds a minimal payload and unwraps result", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(okRes({ ok: true, result: { success: true } }));
    const req: SimulationRequest = { from: "0xfrom", to: "0xto" };
    const out = await simulateTransaction(req);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("/api/simulate");
    expect(init!.method).toBe("POST");
    expect(JSON.parse(init!.body as string)).toEqual({ from: "0xfrom", to: "0xto" });
    expect(out).toEqual({ success: true });
  });

  it("includes value/data/gasLimit/blockNumber/abi and scopes chainid", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(okRes({ ok: true, result: {} }));
    const req: SimulationRequest = {
      from: "0xfrom",
      to: "0xto",
      value: "1",
      data: "0xabcd",
      gasLimit: 21000,
      blockNumber: "100",
      abi: "[]",
    };
    await simulateTransaction(req, 1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("/api/simulate?chainid=1");
    expect(JSON.parse(init!.body as string)).toMatchObject({
      value: "1",
      data: "0xabcd",
      gasLimit: 21000,
      blockNumber: "100",
      abi: "[]",
    });
  });

  it("omits blockNumber when it is 'latest'", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(okRes({ ok: true, result: {} }));
    await simulateTransaction({ from: "0xf", to: "0xt", blockNumber: "latest" });
    expect(
      JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string),
    ).not.toHaveProperty("blockNumber");
  });

  it("builds stateOverrides with balance/nonce/code/stateDiff", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(okRes({ ok: true, result: {} }));
    await simulateTransaction({
      from: "0xf",
      to: "0xt",
      stateOverrides: [
        {
          address: "0xacc",
          balance: "100",
          nonce: "5",
          code: "0x60",
          storage: { "0x0": "0x1" },
        },
      ],
    });
    const body = JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string);
    expect(body.stateOverrides).toEqual({
      "0xacc": {
        balance: "100",
        nonce: "5",
        code: "0x60",
        stateDiff: { "0x0": "0x1" },
      },
    });
  });

  it("drops overrides with no address and entries with no fields", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(okRes({ ok: true, result: {} }));
    await simulateTransaction({
      from: "0xf",
      to: "0xt",
      stateOverrides: [
        { address: "", balance: "1" },
        { address: "0xempty", storage: {} },
      ],
    });
    const body = JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string);
    expect(body).not.toHaveProperty("stateOverrides");
  });

  it("omits stateOverrides when the array is empty", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(okRes({ ok: true, result: {} }));
    await simulateTransaction({ from: "0xf", to: "0xt", stateOverrides: [] });
    expect(
      JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string),
    ).not.toHaveProperty("stateOverrides");
  });

  it("throws 'Simulation failed' with the JSON error message", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      errRes(JSON.stringify({ error: "out of gas" })),
    );
    await expect(
      simulateTransaction({ from: "0xf", to: "0xt" }),
    ).rejects.toThrow("Simulation failed: out of gas");
  });

  it("throws with the raw text when the error body is not JSON", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(errRes("boom"));
    await expect(
      simulateTransaction({ from: "0xf", to: "0xt" }),
    ).rejects.toThrow("Simulation failed: boom");
  });

  it("falls back to the raw text when the JSON error body has no error field", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(errRes('{"detail":"x"}'));
    await expect(
      simulateTransaction({ from: "0xf", to: "0xt" }),
    ).rejects.toThrow('Simulation failed: {"detail":"x"}');
  });
});

describe("simulateBundle", () => {
  it("maps each tx, pruning optional fields, and returns the body", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(okRes({ results: [] }));
    const req: BundleSimulationRequest = {
      transactions: [
        { from: "0xa", to: "0xb" },
        {
          from: "0xc",
          to: "0xd",
          value: "9",
          data: "0x12",
          gasLimit: 30000,
          blockNumber: "latest",
          abi: "[]",
          stateOverrides: [{ address: "0xacc", balance: "1" }],
        },
      ],
    };
    await simulateBundle(req);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("/api/simulate-bundle");
    const body = JSON.parse(init!.body as string);
    expect(body.transactions[0]).toEqual({ from: "0xa", to: "0xb" });
    // blockNumber:"latest" pruned; abi + stateOverrides + value/data/gasLimit kept.
    expect(body.transactions[1]).not.toHaveProperty("blockNumber");
    expect(body.transactions[1].value).toBe("9");
    expect(body.transactions[1].stateOverrides).toEqual({
      "0xacc": { balance: "1" },
    });
  });

  it("includes a non-latest blockNumber on a bundle tx", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(okRes({ results: [] }));
    await simulateBundle({
      transactions: [{ from: "0xa", to: "0xb", blockNumber: "55" }],
    });
    const body = JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string);
    expect(body.transactions[0].blockNumber).toBe("55");
  });

  it("scopes chainid for a non-default chain", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(okRes({ results: [] }));
    await simulateBundle({ transactions: [{ from: "0xa", to: "0xb" }] }, 1);
    expect(fetchSpy.mock.calls[0]![0]).toBe("/api/simulate-bundle?chainid=1");
  });

  it("throws 'Bundle simulation failed' with the JSON error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      errRes(JSON.stringify({ error: "tx 1 reverted" })),
    );
    await expect(
      simulateBundle({ transactions: [{ from: "0xa", to: "0xb" }] }),
    ).rejects.toThrow("Bundle simulation failed: tx 1 reverted");
  });

  it("throws with raw text when the bundle error body is not JSON", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(errRes("kaboom"));
    await expect(
      simulateBundle({ transactions: [{ from: "0xa", to: "0xb" }] }),
    ).rejects.toThrow("Bundle simulation failed: kaboom");
  });

  it("falls back to the raw text when the bundle JSON error has no error field", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(errRes('{"detail":"x"}'));
    await expect(
      simulateBundle({ transactions: [{ from: "0xa", to: "0xb" }] }),
    ).rejects.toThrow('Bundle simulation failed: {"detail":"x"}');
  });
});

describe("forkSimulate / simulateFromHash", () => {
  it("forkSimulate POSTs params and returns the envelope", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(okRes({ ok: true, result: { success: true } }));
    const params = { from: "0xf", to: "0xt", value: "1" };
    const out = await forkSimulate(params);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("/api/simulate/fork");
    expect(JSON.parse(init!.body as string)).toEqual(params);
    expect(out.ok).toBe(true);
  });

  it("simulateFromHash POSTs the txHash and returns the envelope", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(okRes({ ok: true }));
    await simulateFromHash("0xhash");
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("/api/simulate/from-hash");
    expect(JSON.parse(init!.body as string)).toEqual({ txHash: "0xhash" });
  });
});
