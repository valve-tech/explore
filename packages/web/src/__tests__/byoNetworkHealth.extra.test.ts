import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Supplements byoNetworkHealth.test.ts — covers the error-classification
 * branches in rpcFailed (rate-limit + generic) and the tolerant numeric
 * coercion helpers (numericType hex/label/unknown, hexToBig/hexToInt catch)
 * driven through fetchNetworkHealthViaRpc with malformed header/receipt fields.
 */

const sendRpcRequest = vi.fn();
vi.mock("../api/rpc", () => ({
  sendRpcRequest: (...args: unknown[]) => sendRpcRequest(...args),
}));

import { fetchNetworkHealthViaRpc } from "../lib/byoNetworkHealth";

const hex = (n: number | bigint) => "0x" + BigInt(n).toString(16);
const ok = (result: unknown) => ({ jsonrpc: "2.0", id: 1, result });

beforeEach(() => {
  sendRpcRequest.mockReset();
});

describe("byoNetworkHealth — rpcFailed classification", () => {
  it("surfaces a rate-limit message when the node returns 429 / too many requests", async () => {
    sendRpcRequest.mockImplementation((req: { method: string }) => {
      if (req.method === "eth_blockNumber") return Promise.resolve(ok(hex(5)));
      if (req.method === "eth_getBlockByNumber")
        return Promise.resolve(ok({ number: hex(5) }));
      return Promise.resolve({
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32005, message: "429 Too Many Requests" },
      });
    });
    await expect(fetchNetworkHealthViaRpc(369, 1, true)).rejects.toThrow(
      /rate-limited/,
    );
  });

  it("rethrows an unrecognized error message verbatim", async () => {
    sendRpcRequest.mockImplementation((req: { method: string }) => {
      if (req.method === "eth_blockNumber") return Promise.resolve(ok(hex(5)));
      if (req.method === "eth_getBlockByNumber")
        return Promise.resolve(ok({ number: hex(5) }));
      return Promise.resolve({
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32000, message: "weird internal failure" },
      });
    });
    await expect(fetchNetworkHealthViaRpc(369, 1, true)).rejects.toThrow(
      /weird internal failure/,
    );
  });

  it("falls back to a default message when the error has no message", async () => {
    sendRpcRequest.mockImplementation((req: { method: string }) => {
      if (req.method === "eth_blockNumber") return Promise.resolve(ok(hex(5)));
      if (req.method === "eth_getBlockByNumber")
        return Promise.resolve(ok({ number: hex(5) }));
      return Promise.resolve({ jsonrpc: "2.0", id: 1, error: { code: -1 } });
    });
    await expect(fetchNetworkHealthViaRpc(369, 1, true)).rejects.toThrow(/RPC error/);
  });
});

describe("byoNetworkHealth — tolerant numeric coercion", () => {
  it("handles hex/label/unknown tx types and malformed header hex without throwing", async () => {
    sendRpcRequest.mockImplementation((req: { method: string }) => {
      if (req.method === "eth_blockNumber") return Promise.resolve(ok(hex(10)));
      if (req.method === "eth_getBlockByNumber")
        return Promise.resolve(
          ok({
            number: hex(10),
            timestamp: "0xZZ", // unparseable → hexToInt catch → 0
            baseFeePerGas: "0xnotahex", // unparseable → hexToBig catch → 0n
            gasUsed: hex(21_000),
            gasLimit: hex(30_000_000),
            miner: "0xminer",
          }),
        );
      // Receipts exercise numericType: hex string ("0x2"), label ("eip1559"),
      // and an unknown/garbage type (→ default 2).
      return Promise.resolve(
        ok([
          {
            transactionIndex: "0x0",
            type: "0x2", // hex-string type → BigInt path
            from: "0xaaa",
            gasUsed: hex(21_000),
            effectiveGasPrice: hex(2_000_000_000),
          },
          {
            transactionIndex: "0x1",
            type: "eip1559", // label path
            from: "0xbbb",
            gasUsed: hex(21_000),
            effectiveGasPrice: hex(2_000_000_000),
          },
          {
            transactionIndex: "0x2",
            type: "totally-unknown", // unknown → default modern
            from: "0xccc",
            gasUsed: hex(21_000),
            effectiveGasPrice: hex(2_000_000_000),
          },
        ]),
      );
    });

    const out = await fetchNetworkHealthViaRpc(369, 1, true);
    const b = out.blocks[0]!;
    expect(b.number).toBe("10");
    expect(b.timestamp).toBe(0); // malformed timestamp coerced to 0
    expect(b.baseFeePerGas).toBe("0"); // malformed baseFee coerced to 0
    expect(b.txCount).toBe(3);
  });

  it("coerces a numeric-string tx type (Number(t) path)", async () => {
    sendRpcRequest.mockImplementation((req: { method: string }) => {
      if (req.method === "eth_blockNumber") return Promise.resolve(ok(hex(3)));
      if (req.method === "eth_getBlockByNumber")
        return Promise.resolve(
          ok({ number: hex(3), gasUsed: hex(21_000), gasLimit: hex(30_000_000) }),
        );
      return Promise.resolve(
        ok([
          {
            transactionIndex: "0x0",
            type: "2", // plain numeric string → Number(t)
            from: "0xaaa",
            gasUsed: hex(21_000),
            effectiveGasPrice: hex(2_000_000_000),
          },
        ]),
      );
    });
    const out = await fetchNetworkHealthViaRpc(369, 1, true);
    expect(out.blocks[0]!.txCount).toBe(1);
  });
});
