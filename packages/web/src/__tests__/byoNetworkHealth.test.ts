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

  it("normalizes a REAL block + receipts into the correct burned/tips/paid wei", async () => {
    // Known setup — real PulseChain block 26804492 (0x199010c), 2 legacy txs:
    //   https://explore.valve.city/block/26804492?chainid=369
    // header + receipts captured from rpc.pulsechain.com; burned/tips/paid are
    // computed from the chain's own baseFee/effectiveGasPrice/gasUsed.
    const realHeader = {
      jsonrpc: "2.0",
      id: 1,
      result: {
        number: "0x199010c",
        timestamp: "0x6a320063",
        baseFeePerGas: "0x19ba96bbd407f",
        gasUsed: "0x1edba",
        gasLimit: "0x2ad4e1b",
        miner: "0x5ead01d58067a68d0d700374500580ec5c961d0d",
      },
    };
    const realReceipts = {
      jsonrpc: "2.0",
      id: 1,
      result: [
        { transactionIndex: "0x0", type: "0x0", from: "0x0cfd4b2bc70dd20e9e040e67fc26c9cc4309192a", gasUsed: "0x143a3", effectiveGasPrice: "0x1dae1ac793f88e4" },
        { transactionIndex: "0x1", type: "0x0", from: "0x04f5673d298c55e86d402fe895fa4f93d05f0348", gasUsed: "0xaa17", effectiveGasPrice: "0x1afb5e29cc5652d" },
      ],
    };
    sendRpcRequest.mockImplementation((req: { method: string }) => {
      if (req.method === "eth_blockNumber")
        return Promise.resolve({ jsonrpc: "2.0", id: 1, result: "0x199010c" });
      if (req.method === "eth_getBlockByNumber") return Promise.resolve(realHeader);
      return Promise.resolve(realReceipts);
    });

    const out = await fetchNetworkHealthViaRpc(369, 1, true);
    const b = out.blocks[0]!;

    expect(out.headBlock).toBe("26804492");
    expect(b.number).toBe("26804492");
    expect(b.timestamp).toBe(1781661795);
    expect(b.baseFeePerGas).toBe("452626936053887");
    expect(b.gasUsed).toBe("126394"); // block header gasUsed == Σ tx gasUsed here
    expect(b.txCount).toBe(2);
    expect(b.legacyGasShare).toBe(1); // both txs are type-0 (legacy)
    expect(b.legacyCountShare).toBe(1);

    // burned = Σ baseFee·gasUsed; tips = Σ (effGasPrice−baseFee)·gasUsed; paid = Σ effGasPrice·gasUsed
    expect(out.aggregate.burned).toBe("57209328955594993478");
    expect(out.aggregate.tips).toBe("16308415764020445994737");
    expect(out.aggregate.paid).toBe("16365625092976040988215");
    expect(BigInt(out.aggregate.burned) + BigInt(out.aggregate.tips)).toBe(
      BigInt(out.aggregate.paid),
    );
  });

  it("streams newest-first: onProgress paints partial windows that grow to the full result", async () => {
    const head = 200;
    sendRpcRequest.mockImplementation((req: { method: string; params: unknown[] }) => {
      if (req.method === "eth_blockNumber")
        return Promise.resolve({ jsonrpc: "2.0", id: 1, result: hex(head) });
      if (req.method === "eth_getBlockByNumber")
        return Promise.resolve(header(Number(BigInt(req.params[0] as string))));
      return Promise.resolve(receipts());
    });

    const partials: number[] = [];
    const out = await fetchNetworkHealthViaRpc(369, 130, true, {
      onProgress: (p) => partials.push(p.aggregate.blocksAnalyzed),
    });

    // 130 blocks over a 64-block chunk → chunks of 64, 64, 2; the last is
    // delivered via the return value, so onProgress fires for the first two.
    expect(partials).toEqual([64, 128]);
    // Each partial leads with the newest block, and the final result is complete.
    expect(out.aggregate.blocksAnalyzed).toBe(130);
    expect(out.blocks[0]!.number).toBe("200"); // newest first
    expect(out.blocks.at(-1)!.number).toBe("71"); // 200 - 130 + 1
    expect(out.headBlock).toBe("200");
  });

  it("aborts mid-stream when the signal fires", async () => {
    const controller = new AbortController();
    const head = 200;
    let blockCalls = 0;
    sendRpcRequest.mockImplementation((req: { method: string; params: unknown[] }) => {
      if (req.method === "eth_blockNumber")
        return Promise.resolve({ jsonrpc: "2.0", id: 1, result: hex(head) });
      if (req.method === "eth_getBlockByNumber") {
        blockCalls += 1;
        // Abort once the first chunk has been requested.
        if (blockCalls === 1) controller.abort();
        return Promise.resolve(header(Number(BigInt(req.params[0] as string))));
      }
      return Promise.resolve(receipts());
    });

    await expect(
      fetchNetworkHealthViaRpc(369, 200, true, { signal: controller.signal }),
    ).rejects.toThrow(/abort/i);
    // It stopped early — far fewer than the 200 blocks were fetched.
    expect(blockCalls).toBeLessThan(200);
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
