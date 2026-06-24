import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { callReadFunction } from "../components/explorer/ContractView/callReadFunction";
import type { AbiItem } from "../components/explorer/ContractView/types";

/**
 * callReadFunction encodes a contract read with viem (real), POSTs it to
 * /api/simulate, and formats the decoded return. We stub global fetch and assert
 * the encoded selector + each result branch.
 *
 * Known setup — WPLS.decimals():
 *   https://explore.valve.city/address/0xA1077a294dDE1B09bB078844df40758a5D0f9a27?chainid=369
 *   selector keccak("decimals()")[:4] = 0x313ce567, returns 18.
 */

const WPLS = "0xA1077a294dDE1B09bB078844df40758a5D0f9a27";
const decimalsFn: AbiItem = {
  name: "decimals",
  type: "function",
  stateMutability: "view",
  inputs: [],
  outputs: [{ name: "", type: "uint8" }],
} as AbiItem;

let fetchMock: ReturnType<typeof vi.fn>;
function mockFetchJson(body: unknown) {
  fetchMock.mockResolvedValue({ json: async () => body } as Response);
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("callReadFunction", () => {
  it("encodes the right selector and formats a decoded return", async () => {
    mockFetchJson({
      ok: true,
      result: { decodedReturn: { values: [{ name: "", type: "uint8", value: 18 }] } },
    });

    const res = await callReadFunction(decimalsFn, WPLS, {});

    expect(res).toEqual({ ok: true, result: "result (uint8): 18" });
    // The simulate POST carries the keccak selector for decimals().
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.to).toBe(WPLS);
    expect(body.data).toBe("0x313ce567");
  });

  it("coerces a bool arg and joins multiple decoded values", async () => {
    const fn: AbiItem = {
      name: "setReturn",
      type: "function",
      stateMutability: "view",
      inputs: [{ name: "flag", type: "bool" }],
      outputs: [],
    } as AbiItem;
    mockFetchJson({
      ok: true,
      result: {
        decodedOutput: {
          values: [
            { name: "a", type: "uint256", value: 1 },
            { name: "b", type: "bool", value: true },
          ],
        },
      },
    });

    const res = await callReadFunction(fn, WPLS, { flag: "true" });
    expect(res).toEqual({ ok: true, result: "a (uint256): 1\nb (bool): true" });
  });

  it("returns the revert reason on a failed call", async () => {
    // The error branch fires when the envelope is not ok.
    mockFetchJson({ ok: false, result: { revertReason: "execution reverted: bad" } });
    const res = await callReadFunction(decimalsFn, WPLS, {});
    expect(res).toEqual({ ok: false, error: "execution reverted: bad" });
  });

  it("falls back to raw returnData when nothing decoded", async () => {
    mockFetchJson({ ok: true, result: { returnData: "0x12" } });
    expect(await callReadFunction(decimalsFn, WPLS, {})).toEqual({
      ok: true,
      result: "0x12",
    });
  });

  it("reports an empty result when there's no decode and no returnData", async () => {
    mockFetchJson({ ok: true, result: {} });
    expect(await callReadFunction(decimalsFn, WPLS, {})).toEqual({
      ok: true,
      result: "(empty result)",
    });
  });

  it("surfaces a thrown fetch error", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    expect(await callReadFunction(decimalsFn, WPLS, {})).toEqual({
      ok: false,
      error: "network down",
    });
  });
});
