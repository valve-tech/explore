import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * BYO-RPC network health: the browser pulls each block's header +
 * eth_getBlockReceipts from the user's node and runs the API's PURE analysis
 * (imported via the @networkHealth alias) to produce the same wire shape the
 * backend serves. We mock `sendRpcRequest` and assert ordering, the window
 * rollup, and the honest "receipts unsupported" error. This also proves the
 * cross-package alias resolves under vitest.
 */

const sendRpcRequest = vi.fn();
vi.mock("../api/rpc", () => ({
  sendRpcRequest: (...args: unknown[]) => sendRpcRequest(...args),
}));

import {
  fetchNetworkHealthViaRpc,
  fetchBlockLadderViaRpc,
} from "../lib/byoNetworkHealth";

const hex = (n: number | bigint) => "0x" + BigInt(n).toString(16);

// A block whose single tx pays a 1 gwei tip over a 1 gwei base fee.
function header(n: number) {
  return {
    jsonrpc: "2.0",
    id: 1,
    result: {
      number: hex(n),
      timestamp: hex(1_700_000_000 + n),
      baseFeePerGas: hex(1_000_000_000), // 1 gwei
      gasUsed: hex(21_000),
      gasLimit: hex(30_000_000),
      miner: "0xMiNeR0000000000000000000000000000000001",
    },
  };
}
function headerWithTxs(n: number) {
  return {
    jsonrpc: "2.0",
    id: 1,
    result: {
      ...header(n).result,
      transactions: [
        {
          transactionIndex: "0x0",
          hash: "0xtx" + n,
          to: "0xdead00000000000000000000000000000000beef",
          value: hex(5),
          input: "0xa9059cbb0000",
        },
      ],
    },
  };
}
function receipts() {
  return {
    jsonrpc: "2.0",
    id: 1,
    result: [
      {
        transactionIndex: "0x0",
        type: "0x2",
        from: "0xaaaa000000000000000000000000000000000001",
        gasUsed: hex(21_000),
        effectiveGasPrice: hex(2_000_000_000), // 2 gwei → 1 gwei tip
      },
    ],
  };
}

beforeEach(() => {
  sendRpcRequest.mockReset();
});

describe("byoNetworkHealth — fetchNetworkHealthViaRpc", () => {
  it("computes the window from the node, newest-first, with a valid rollup", async () => {
    const head = 10;
    sendRpcRequest.mockImplementation((req: { method: string; params: unknown[] }) => {
      if (req.method === "eth_blockNumber")
        return Promise.resolve({ jsonrpc: "2.0", id: 1, result: hex(head) });
      if (req.method === "eth_getBlockByNumber")
        return Promise.resolve(header(Number(BigInt(req.params[0] as string))));
      if (req.method === "eth_getBlockReceipts") return Promise.resolve(receipts());
      throw new Error(`unexpected ${req.method}`);
    });

    const out = await fetchNetworkHealthViaRpc(369, 3, true);

    expect(out.chainId).toBe(369);
    expect(out.burnsBaseFee).toBe(true);
    expect(out.headBlock).toBe("10");
    expect(out.hasMore).toBe(true); // oldest block (8) > genesis
    expect(out.aggregate.blocksAnalyzed).toBe(3);
    // newest-first: blocks 10, 9, 8
    expect(out.blocks.map((b) => b.number)).toEqual(["10", "9", "8"]);
    expect(out.aggregate.fromBlock).toBe("8");
    expect(out.aggregate.toBlock).toBe("10");
    // base fee is burned → burned is the 1 gwei base × 21000 gas, per block × 3.
    expect(BigInt(out.aggregate.burned)).toBe(1_000_000_000n * 21_000n * 3n);
    // tip is 1 gwei × 21000 gas × 3 blocks.
    expect(BigInt(out.aggregate.tips)).toBe(1_000_000_000n * 21_000n * 3n);
  });

  it("clamps the window at genesis (hasMore false)", async () => {
    sendRpcRequest.mockImplementation((req: { method: string; params: unknown[] }) => {
      if (req.method === "eth_blockNumber")
        return Promise.resolve({ jsonrpc: "2.0", id: 1, result: hex(1) });
      if (req.method === "eth_getBlockByNumber")
        return Promise.resolve(header(Number(BigInt(req.params[0] as string))));
      return Promise.resolve(receipts());
    });

    const out = await fetchNetworkHealthViaRpc(369, 50, true); // only blocks 0,1 exist
    expect(out.blocks.map((b) => b.number)).toEqual(["1", "0"]);
    expect(out.hasMore).toBe(false);
  });

  it("surfaces a clear message when the node lacks eth_getBlockReceipts", async () => {
    sendRpcRequest.mockImplementation((req: { method: string }) => {
      if (req.method === "eth_blockNumber")
        return Promise.resolve({ jsonrpc: "2.0", id: 1, result: hex(5) });
      if (req.method === "eth_getBlockByNumber") return Promise.resolve(header(5));
      return Promise.resolve({
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32601, message: "the method eth_getBlockReceipts does not exist" },
      });
    });

    await expect(fetchNetworkHealthViaRpc(369, 1, true)).rejects.toThrow(
      /doesn't support eth_getBlockReceipts/,
    );
  });
});

describe("byoNetworkHealth — fetchBlockLadderViaRpc", () => {
  it("merges full txs with receipts into a ladder", async () => {
    sendRpcRequest.mockImplementation((req: { method: string }) => {
      if (req.method === "eth_getBlockByNumber") return Promise.resolve(headerWithTxs(7));
      if (req.method === "eth_getBlockReceipts") return Promise.resolve(receipts());
      throw new Error(`unexpected ${req.method}`);
    });

    const ladder = await fetchBlockLadderViaRpc(369, "7", true);
    expect(ladder.number).toBe("7");
    expect(ladder.burnsBaseFee).toBe(true);
    expect(ladder.txs).toHaveLength(1);
    expect(ladder.txs[0]!.hash).toBe("0xtx7");
    expect(ladder.txs[0]!.methodId).toBe("0xa9059cbb");
    expect(ladder.txs[0]!.type).toBe("modern");
  });
});
