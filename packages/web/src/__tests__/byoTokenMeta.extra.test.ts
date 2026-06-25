import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Supplements byoTokenMeta.test.ts — covers the try/catch in call(): a
 * non-empty but undecodable eth_call return makes decodeFunctionResult throw,
 * which the helper swallows to null (a bad getter never sinks the others).
 */

const sendRpcRequest = vi.fn();
vi.mock("../api/rpc", () => ({
  sendRpcRequest: (...args: unknown[]) => sendRpcRequest(...args),
}));

import { fetchTokenMetaViaRpc } from "../lib/byoTokenMeta";

const TOKEN = "0xabc0000000000000000000000000000000000001";
const SEL = {
  decimals: "0x313ce567",
  symbol: "0x95d89b41",
  name: "0x06fdde03",
} as const;
const ok = (result: string) => ({ jsonrpc: "2.0", id: 1, result });

beforeEach(() => {
  sendRpcRequest.mockReset();
});

describe("byoTokenMeta — undecodable return falls to null (catch path)", () => {
  it("swallows a decode throw on one getter, keeps the decodable others", async () => {
    sendRpcRequest.mockImplementation((req: { params: [{ data: string }] }) => {
      const data = req.params[0].data;
      if (data.startsWith(SEL.decimals)) {
        // Non-empty but truncated/garbage data → decodeFunctionResult throws.
        return Promise.resolve(ok("0x1234"));
      }
      if (data.startsWith(SEL.symbol)) {
        // A string getter whose payload is undecodable (bad offset) → throws.
        return Promise.resolve(ok("0xdeadbeef"));
      }
      // name returns empty → null via the !result guard.
      return Promise.resolve(ok("0x"));
    });

    expect(await fetchTokenMetaViaRpc(TOKEN, 369)).toEqual({
      address: TOKEN,
      decimals: null,
      symbol: null,
      name: null,
    });
  });
});
