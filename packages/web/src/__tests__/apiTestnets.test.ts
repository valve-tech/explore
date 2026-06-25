import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Tests for src/api/testnets.ts — virtual-testnet (Anvil fork) lifecycle:
 * create/list/get/destroy, snapshot/revert, fund/mine/time-travel, and RPC
 * proxy. All share `handleResponse`, which throws the server's JSON `error`
 * (or raw text) on a non-ok response.
 *
 * Fixtures are synthetic ForkInfo records. createFork strips chainId out of the
 * body and appends it as ?chainid=N (default 369 → bare URL).
 */

import {
  createFork,
  listForks,
  getFork,
  destroyFork,
  takeSnapshot,
  revertSnapshot,
  fundAddress,
  mineBlocks,
  timeTravel,
  proxyRpc,
} from "../api/testnets";

const FORK = {
  id: "fork-1",
  port: 8545,
  rpcUrl: "http://localhost:8545",
  blockNumber: "latest" as const,
  label: "test",
  createdAt: "2026-06-24T00:00:00Z",
  pid: 123,
  chainId: 369,
};

function okRes(json: unknown): Response {
  return { ok: true, status: 200, json: async () => json } as Response;
}
function errRes(text: string, status = 500): Response {
  return { ok: false, status, text: async () => text } as Response;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("createFork", () => {
  it("POSTs the body without chainId on the default chain", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(okRes({ ok: true, fork: FORK }));
    const out = await createFork({ blockNumber: 100, label: "test" });
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("/api/testnets");
    expect(init!.method).toBe("POST");
    expect(JSON.parse(init!.body as string)).toEqual({ blockNumber: 100, label: "test" });
    expect(out.id).toBe("fork-1");
  });

  it("appends ?chainid and strips chainId from the body for a non-default chain", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(okRes({ ok: true, fork: { ...FORK, chainId: 1 } }));
    await createFork({ chainId: 1, label: "eth" });
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("/api/testnets?chainid=1");
    expect(JSON.parse(init!.body as string)).toEqual({ label: "eth" });
  });

  it("throws the server JSON error on failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      errRes(JSON.stringify({ error: "anvil missing" })),
    );
    await expect(createFork({})).rejects.toThrow("anvil missing");
  });

  it("throws the raw text when the error body isn't JSON", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(errRes("boom"));
    await expect(createFork({})).rejects.toThrow("boom");
  });

  it("falls back to the raw text when the JSON error body has no error field", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(errRes('{"detail":"y"}'));
    await expect(createFork({})).rejects.toThrow('{"detail":"y"}');
  });
});

describe("listForks", () => {
  it("GETs the base URL and returns the forks array", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(okRes({ ok: true, forks: [FORK] }));
    const out = await listForks();
    expect(fetchSpy.mock.calls[0]![0]).toBe("/api/testnets");
    expect(out).toHaveLength(1);
  });
});

describe("getFork", () => {
  it("GETs the id route and returns the fork", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(okRes({ ok: true, fork: FORK }));
    const out = await getFork("fork-1");
    expect(fetchSpy.mock.calls[0]![0]).toBe("/api/testnets/fork-1");
    expect(out.id).toBe("fork-1");
  });
});

describe("destroyFork", () => {
  it("DELETEs the id route", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(okRes({ ok: true }));
    await expect(destroyFork("fork-1")).resolves.toBeUndefined();
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("/api/testnets/fork-1");
    expect(init!.method).toBe("DELETE");
  });
});

describe("snapshot helpers", () => {
  it("takeSnapshot POSTs and returns the snapshotId", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(okRes({ ok: true, snapshotId: "0x1" }));
    const out = await takeSnapshot("fork-1");
    expect(fetchSpy.mock.calls[0]![0]).toBe("/api/testnets/fork-1/snapshot");
    expect(out).toBe("0x1");
  });

  it("revertSnapshot POSTs the snapshotId and returns success", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(okRes({ ok: true, success: true }));
    const out = await revertSnapshot("fork-1", "0x1");
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("/api/testnets/fork-1/revert");
    expect(JSON.parse(init!.body as string)).toEqual({ snapshotId: "0x1" });
    expect(out).toBe(true);
  });
});

describe("fund / mine / time-travel", () => {
  it("fundAddress POSTs address + amount", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(okRes({ ok: true }));
    await fundAddress("fork-1", "0xabc", "100");
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("/api/testnets/fork-1/fund");
    expect(JSON.parse(init!.body as string)).toEqual({ address: "0xabc", amount: "100" });
  });

  it("mineBlocks POSTs the count", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(okRes({ ok: true }));
    await mineBlocks("fork-1", 5);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("/api/testnets/fork-1/mine");
    expect(JSON.parse(init!.body as string)).toEqual({ count: 5 });
  });

  it("timeTravel POSTs the seconds", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(okRes({ ok: true }));
    await timeTravel("fork-1", 3600);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("/api/testnets/fork-1/time-travel");
    expect(JSON.parse(init!.body as string)).toEqual({ seconds: 3600 });
  });
});

describe("proxyRpc", () => {
  it("POSTs method + params and returns the result", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(okRes({ result: "0x10" }));
    const out = await proxyRpc("fork-1", "eth_blockNumber");
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("/api/testnets/fork-1/rpc");
    expect(JSON.parse(init!.body as string)).toEqual({
      method: "eth_blockNumber",
      params: [],
    });
    expect(out).toBe("0x10");
  });

  it("forwards explicit params", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(okRes({ result: null }));
    await proxyRpc("fork-1", "eth_getBalance", ["0xabc", "latest"]);
    expect(JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string)).toEqual({
      method: "eth_getBalance",
      params: ["0xabc", "latest"],
    });
  });

  it("throws on a non-ok proxy response (raw text path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(errRes("rpc down"));
    await expect(proxyRpc("fork-1", "eth_blockNumber")).rejects.toThrow("rpc down");
  });
});
