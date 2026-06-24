import { describe, it, expect, beforeEach, vi } from "vitest";
import { encodeFunctionResult, parseAbi } from "viem";

/**
 * BYO-RPC token metadata: decimals/symbol/name read straight from the user's
 * node via eth_call. We mock `sendRpcRequest` and round-trip real ABI-encoded
 * return values (viem `encodeFunctionResult`) so the decode path is exercised
 * for real — including the "a single getter reverts → null, others survive"
 * tolerance and a non-ERC-20 (no decimals → decimals: null).
 */

const sendRpcRequest = vi.fn();
vi.mock("../api/rpc", () => ({
  sendRpcRequest: (...args: unknown[]) => sendRpcRequest(...args),
}));

import { fetchTokenMetaViaRpc } from "../lib/byoTokenMeta";

const ABI = parseAbi([
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function name() view returns (string)",
]);

const TOKEN = "0xabc0000000000000000000000000000000000001";

// keccak selectors for the three getters, so the mock can answer by method.
const SEL = {
  decimals: "0x313ce567",
  symbol: "0x95d89b41",
  name: "0x06fdde03",
} as const;

function ok(result: string) {
  return { jsonrpc: "2.0", id: 1, result };
}

beforeEach(() => {
  sendRpcRequest.mockReset();
});

describe("byoTokenMeta — fetchTokenMetaViaRpc", () => {
  it("decodes decimals + symbol + name from eth_call results", async () => {
    sendRpcRequest.mockImplementation((req: { params: [{ data: string }] }) => {
      const data = req.params[0].data;
      if (data.startsWith(SEL.decimals))
        return Promise.resolve(ok(encodeFunctionResult({ abi: ABI, functionName: "decimals", result: 6 })));
      if (data.startsWith(SEL.symbol))
        return Promise.resolve(ok(encodeFunctionResult({ abi: ABI, functionName: "symbol", result: "USDC" })));
      return Promise.resolve(ok(encodeFunctionResult({ abi: ABI, functionName: "name", result: "USD Coin" })));
    });

    expect(await fetchTokenMetaViaRpc(TOKEN, 369)).toEqual({
      address: TOKEN,
      decimals: 6,
      symbol: "USDC",
      name: "USD Coin",
    });
  });

  it("yields decimals: null for a non-ERC-20 (decimals reverts/empty)", async () => {
    sendRpcRequest.mockImplementation((req: { params: [{ data: string }] }) => {
      const data = req.params[0].data;
      if (data.startsWith(SEL.decimals)) return Promise.resolve(ok("0x")); // empty return
      if (data.startsWith(SEL.symbol)) return Promise.resolve(ok("0x"));
      return Promise.resolve(ok("0x"));
    });

    expect(await fetchTokenMetaViaRpc(TOKEN, 1)).toEqual({
      address: TOKEN,
      decimals: null,
      symbol: null,
      name: null,
    });
  });

  it("survives one getter erroring — keeps the others", async () => {
    sendRpcRequest.mockImplementation((req: { params: [{ data: string }] }) => {
      const data = req.params[0].data;
      if (data.startsWith(SEL.decimals))
        return Promise.resolve(ok(encodeFunctionResult({ abi: ABI, functionName: "decimals", result: 18 })));
      if (data.startsWith(SEL.symbol))
        return Promise.resolve({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: "execution reverted" } });
      return Promise.resolve(ok(encodeFunctionResult({ abi: ABI, functionName: "name", result: "Wrapped" })));
    });

    expect(await fetchTokenMetaViaRpc(TOKEN, 369)).toEqual({
      address: TOKEN,
      decimals: 18,
      symbol: null,
      name: "Wrapped",
    });
  });
});
