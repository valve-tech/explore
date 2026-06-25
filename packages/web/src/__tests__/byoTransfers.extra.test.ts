import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Supplements byoTransfers.test.ts — covers the tolerant coercion catch
 * branches: toNum() on a malformed blockNumber/logIndex (→ 0) and decode()
 * on malformed log data (→ value "0").
 */

const sendRpcRequest = vi.fn();
vi.mock("../api/rpc", () => ({
  sendRpcRequest: (...args: unknown[]) => sendRpcRequest(...args),
}));

import { fetchTransfersViaRpc } from "../lib/byoTransfers";

const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const TOKEN = "0xa1077a294dde1b09bb078844df40758a5d0f9a27";
const ok = (result: unknown) => ({ jsonrpc: "2.0", id: 1, result });

beforeEach(() => {
  sendRpcRequest.mockReset();
});

describe("byoTransfers — tolerant coercion", () => {
  it("coerces malformed blockNumber/logIndex/data to safe defaults", async () => {
    const badLog = {
      address: TOKEN,
      topics: [
        TRANSFER_TOPIC,
        "0x000000000000000000000000" + "11".repeat(20),
        "0x000000000000000000000000" + "22".repeat(20),
      ],
      data: "0xZZZZ", // BigInt() throws → value "0"
      blockNumber: "0xnothex", // toNum catch → 0
      transactionHash: "0xtx",
      logIndex: "0xalsobad", // toNum catch → 0
    };
    sendRpcRequest.mockImplementation((req: { method: string }) =>
      req.method === "eth_blockNumber"
        ? Promise.resolve(ok("0x100"))
        : Promise.resolve(ok([badLog])),
    );

    const out = await fetchTransfersViaRpc(TOKEN, "24h", 369);
    expect(out.records).toHaveLength(1);
    expect(out.records[0]).toMatchObject({
      blockNumber: 0,
      logIndex: 0,
      value: "0",
      variant: "erc20",
    });
  });

  it("treats empty data ('0x') as value 0", async () => {
    const emptyDataLog = {
      address: TOKEN,
      topics: [
        TRANSFER_TOPIC,
        "0x000000000000000000000000" + "11".repeat(20),
        "0x000000000000000000000000" + "22".repeat(20),
      ],
      data: "0x",
      blockNumber: "0x10",
      transactionHash: "0xtx",
      logIndex: "0x0",
    };
    sendRpcRequest.mockImplementation((req: { method: string }) =>
      req.method === "eth_blockNumber"
        ? Promise.resolve(ok("0x20"))
        : Promise.resolve(ok([emptyDataLog])),
    );
    const out = await fetchTransfersViaRpc(TOKEN, "24h", 369);
    expect(out.records[0]!.value).toBe("0");
  });

  it("defaults from/to to empty string when the topics are absent", async () => {
    // Only the signature topic — no indexed from/to (degenerate, but tolerated).
    const log = {
      address: TOKEN,
      topics: [TRANSFER_TOPIC],
      data: "0x05",
      blockNumber: "0x10",
      transactionHash: "0xtx",
      logIndex: "0x0",
    };
    sendRpcRequest.mockImplementation((req: { method: string }) =>
      req.method === "eth_blockNumber"
        ? Promise.resolve(ok("0x20"))
        : Promise.resolve(ok([log])),
    );
    const out = await fetchTransfersViaRpc(TOKEN, "24h", 369);
    expect(out.records[0]!.from).toBe("");
    expect(out.records[0]!.to).toBe("");
    expect(out.records[0]!.value).toBe("5");
  });

  it("uses the default blocks-per-day for an unknown chain", async () => {
    const head = 1_000_000;
    sendRpcRequest.mockImplementation((req: { method: string }) =>
      req.method === "eth_blockNumber"
        ? Promise.resolve(ok("0x" + head.toString(16)))
        : Promise.resolve(ok([])),
    );
    // chainId 999 is not in BLOCKS_PER_DAY → default 8640.
    const out = await fetchTransfersViaRpc(TOKEN, "24h", 999);
    expect(head - out.firstBlock).toBe(8640);
  });
});
