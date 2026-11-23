import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchSlotBeforeBlock, preTxStateVarValue } from "../preTxStateVar";
import type { StateVarRef } from "../resolveStateVar";
import type { FrameStorage } from "../storageContext";
import pepe from "./fixtures/pepeToken.json";

// PepeToken on Ethereum, slot 9 (`uniswapV2Pair`) at block 21000000:
// the real answer of GET /api?module=proxy&action=eth_getStorageAt.
const REAL = { jsonrpc: "2.0", id: 1, result: pepe.slots["0x9"] };
const ref: StateVarRef = {
  name: "uniswapV2Pair", typeLabel: "address", encoding: "inplace", slot: 9n, offset: 0, numberOfBytes: 20, kind: "value",
};
const known = (storage: Record<string, string> = {}): FrameStorage => ({
  status: "known", address: pepe.address.toLowerCase(), storage, prevStorage: null, writtenSlot: null, snapshotStep: null,
});
const mockFetch = (body: unknown, ok = true) => {
  const fn = vi.fn(async (_url: string, _init?: RequestInit) => ({ ok, json: async () => body }) as Response);
  vi.stubGlobal("fetch", fn);
  return fn;
};

afterEach(() => vi.unstubAllGlobals());

describe("preTxStateVarValue", () => {
  it("reads the slot at the parent block, at the storage address, on the right chain", async () => {
    const fn = mockFetch(REAL);
    const v = await preTxStateVarValue({ ref, frameStorage: known(), chainId: 1, blockNumber: 21000001, txIndex: 0 });
    expect(v).toEqual({
      name: "uniswapV2Pair", type: "address", source: "storage",
      value: "0xA43fe16908251ee70EF74718545e4FE6C5cCEc9f",
      note: "value before the transaction; the transaction has not touched this slot yet",
    });
    const url = String(fn.mock.calls[0]![0]);
    expect(url).toContain("module=proxy&action=eth_getStorageAt");
    expect(url).toContain("address=" + pepe.address.toLowerCase());
    expect(url).toContain("position=0x" + "9".padStart(64, "0"));
    expect(url).toContain("tag=0x1406f40"); // 21000000
    expect(url).toContain("chainid=1");
  });

  it("says that the value is approximate when the transaction is not first in its block", async () => {
    mockFetch(REAL);
    const v = await preTxStateVarValue({ ref, frameStorage: known(), chainId: 1, blockNumber: 21000001, txIndex: 4 });
    expect(v?.note).toBe(
      "approximate: value at the end of block 21000000; an earlier transaction in block 21000001 can change it",
    );
    const noIndex = await preTxStateVarValue({ ref, frameStorage: known(), chainId: 1, blockNumber: 21000001 });
    expect(noIndex?.note).toMatch(/^approximate:/);
  });

  it("does not read when the trace already holds the slot or cannot vouch for the storage", async () => {
    const fn = mockFetch(REAL);
    const touched = known({ ["0x" + "9".padStart(64, "0")]: "0x" + "0".repeat(64) });
    expect(await preTxStateVarValue({ ref, frameStorage: touched, chainId: 1, blockNumber: 5 })).toBeNull();
    expect(await preTxStateVarValue({ ref, frameStorage: { status: "unknown", reason: "x" }, chainId: 1, blockNumber: 5 })).toBeNull();
    expect(await preTxStateVarValue({
      ref, frameStorage: { status: "need-detail", address: "0x1", step: 3 }, chainId: 1, blockNumber: 5,
    })).toBeNull();
    expect(await preTxStateVarValue({ ref: { ...ref, kind: "opaque" }, frameStorage: known(), chainId: 1, blockNumber: 5 })).toBeNull();
    expect(fn).not.toHaveBeenCalled();
  });

  it("returns null on an RPC error, an HTTP error or a short result", async () => {
    mockFetch({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: "missing trie node" } });
    expect(await preTxStateVarValue({ ref, frameStorage: known(), chainId: 1, blockNumber: 5 })).toBeNull();
    mockFetch(REAL, false);
    expect(await preTxStateVarValue({ ref, frameStorage: known(), chainId: 1, blockNumber: 5 })).toBeNull();
    mockFetch({ jsonrpc: "2.0", id: 1, result: "0x" });
    expect(await fetchSlotBeforeBlock(pepe.address, 9n, 5, 1)).toBeNull();
  });

  it("returns null for block 0 or a block number that is not an integer", async () => {
    const fn = mockFetch(REAL);
    expect(await fetchSlotBeforeBlock(pepe.address, 9n, 0, 1)).toBeNull();
    expect(await fetchSlotBeforeBlock(pepe.address, 9n, Number.NaN, 1)).toBeNull();
    expect(fn).not.toHaveBeenCalled();
  });
});
