import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * BYO-RPC token transfers: with a per-chain RPC override, the token chart reads
 * Transfer logs straight from the user's node via eth_getLogs. We mock
 * `sendRpcRequest` and decode a REAL on-chain log so the fixture is verifiable.
 *
 * Known setup — a real WPLS (PulseChain wrapped PLS) transfer:
 *   token: https://explore.valve.city/token/0xA1077a294dDE1B09bB078844df40758a5D0f9a27?chainid=369
 *   tx:    https://explore.valve.city/tx/0xd515ef07d4308c389b05fe13c55ac1ebe3270bd8bbf4470b0a134a1766fe3c81?chainid=369
 *   block 26804224 (0x1990000), logIndex 271 (0x10f)
 *   from 0x1551…6fbb → to 0x165c…52d9, value 5456.507558918974858760 WPLS
 * (captured from rpc.pulsechain.com eth_getLogs; topics + data are byte-for-byte
 * the chain's, so the asserted from/to/value match the explorer.)
 */

const sendRpcRequest = vi.fn();
vi.mock("../api/rpc", () => ({
  sendRpcRequest: (...args: unknown[]) => sendRpcRequest(...args),
}));

import { fetchTransfersViaRpc } from "../lib/byoTransfers";

const WPLS = "0xA1077a294dDE1B09bB078844df40758a5D0f9a27";
const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

// The real WPLS Transfer log, verbatim from the chain.
const WPLS_LOG = {
  address: "0xa1077a294dde1b09bb078844df40758a5d0f9a27",
  topics: [
    TRANSFER_TOPIC,
    "0x000000000000000000000000155172653e94a7e5f0e04126803dcb6896796fbb",
    "0x000000000000000000000000165c3410fc91ef562c50559f7d2289febed552d9",
  ],
  data: "0x000000000000000000000000000000000000000000000127cc410b054f53e608",
  blockNumber: "0x1990000",
  transactionHash:
    "0xd515ef07d4308c389b05fe13c55ac1ebe3270bd8bbf4470b0a134a1766fe3c81",
  logIndex: "0x10f",
};

const ok = (result: unknown) => ({ jsonrpc: "2.0", id: 1, result });

beforeEach(() => {
  sendRpcRequest.mockReset();
});

describe("byoTransfers — fetchTransfersViaRpc", () => {
  it("decodes a real ERC-20 Transfer log to the explorer's from/to/value", async () => {
    const head = 0x1990010;
    sendRpcRequest.mockImplementation((req: { method: string }) => {
      if (req.method === "eth_blockNumber")
        return Promise.resolve(ok("0x" + head.toString(16)));
      if (req.method === "eth_getLogs") return Promise.resolve(ok([WPLS_LOG]));
      throw new Error(`unexpected ${req.method}`);
    });

    const out = await fetchTransfersViaRpc(WPLS, "24h", 369);

    expect(out.records).toHaveLength(1);
    expect(out.records[0]).toEqual({
      blockNumber: 26804224,
      blockTimestamp: 0, // not available from a bare log
      txHash:
        "0xd515ef07d4308c389b05fe13c55ac1ebe3270bd8bbf4470b0a134a1766fe3c81",
      logIndex: 271,
      from: "0x155172653e94a7e5f0e04126803dcb6896796fbb",
      to: "0x165c3410fc91ef562c50559f7d2289febed552d9",
      value: "5456507558918974858760", // 5456.5075… WPLS (18 dp)
      variant: "erc20",
    });
    expect(out.lastBlock).toBe(head);
  });

  it("scopes eth_getLogs to the token + Transfer topic over the window's block range", async () => {
    const head = 0x1990010;
    let logsParams: { address: string; topics: string[]; fromBlock: string; toBlock: string } | null =
      null;
    sendRpcRequest.mockImplementation((req: { method: string; params: unknown[] }) => {
      if (req.method === "eth_blockNumber")
        return Promise.resolve(ok("0x" + head.toString(16)));
      logsParams = (req.params as [typeof logsParams])[0];
      return Promise.resolve(ok([]));
    });

    const out = await fetchTransfersViaRpc(WPLS, "24h", 369);

    // 24h window on PulseChain ≈ 8640 blocks back from head (block estimate only;
    // bucketing uses real block numbers).
    expect(out.firstBlock).toBe(head - 8640);
    expect(out.lastBlock).toBe(head);
    expect(logsParams!.address).toBe(WPLS);
    expect(logsParams!.topics).toEqual([TRANSFER_TOPIC]);
    expect(BigInt(logsParams!.toBlock)).toBe(BigInt(head));
    expect(BigInt(logsParams!.fromBlock)).toBe(BigInt(head - 8640));
  });

  it("widens the block range for longer windows (30d > 7d > 24h)", async () => {
    const head = 1_000_000;
    const froms: Record<string, number> = {};
    for (const w of ["24h", "7d", "30d"] as const) {
      sendRpcRequest.mockImplementation((req: { method: string }) =>
        req.method === "eth_blockNumber"
          ? Promise.resolve(ok("0x" + head.toString(16)))
          : Promise.resolve(ok([])),
      );
      froms[w] = (await fetchTransfersViaRpc(WPLS, w, 369)).firstBlock;
    }
    expect(head - froms["24h"]!).toBe(8640); // 1 day
    expect(head - froms["7d"]!).toBe(8640 * 7);
    expect(head - froms["30d"]!).toBe(8640 * 30);
  });

  it("treats a 4-topic log as an ERC-721 transfer (value 1, tokenId from topic)", async () => {
    // Illustrative ERC-721 shape (indexed tokenId → 4 topics, empty data).
    const erc721Log = {
      address: WPLS,
      topics: [
        TRANSFER_TOPIC,
        "0x000000000000000000000000" + "11".repeat(20),
        "0x000000000000000000000000" + "22".repeat(20),
        "0x" + (1234).toString(16).padStart(64, "0"), // tokenId 1234
      ],
      data: "0x",
      blockNumber: "0x10",
      transactionHash: "0xabc",
      logIndex: "0x0",
    };
    sendRpcRequest.mockImplementation((req: { method: string }) =>
      req.method === "eth_blockNumber"
        ? Promise.resolve(ok("0x20"))
        : Promise.resolve(ok([erc721Log])),
    );

    const out = await fetchTransfersViaRpc(WPLS, "24h", 369);
    expect(out.records[0]).toMatchObject({
      variant: "erc721",
      value: "1",
      tokenId: "1234",
    });
  });

  it("propagates an eth_getLogs error (e.g. range too wide) to the caller", async () => {
    sendRpcRequest.mockImplementation((req: { method: string }) =>
      req.method === "eth_blockNumber"
        ? Promise.resolve(ok("0x" + (50_000).toString(16)))
        : Promise.resolve({
            jsonrpc: "2.0",
            id: 1,
            error: { code: -32005, message: "query returned more than 10000 results" },
          }),
    );
    await expect(fetchTransfersViaRpc(WPLS, "30d", 369)).rejects.toThrow(
      /more than 10000 results/,
    );
  });
});
