import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * BYO-RPC address activity: scan the recent-block window on the user's node and
 * return only the top-level txs that touch the watched address, with hex fields
 * normalized to the decimal strings the AddressTransaction contract uses. We mock
 * `sendRpcRequest` to serve a head + a couple of blocks.
 */

const sendRpcRequest = vi.fn();
vi.mock("../api/rpc", () => ({
  sendRpcRequest: (...args: unknown[]) => sendRpcRequest(...args),
}));

import { fetchAddressActivityViaRpc } from "../lib/watcher/byoActivity";

const WATCHED = "0xaaaa000000000000000000000000000000000001";
const OTHER = "0xbbbb000000000000000000000000000000000002";

function block(num: number, txs: Array<{ hash: string; from: string; to: string | null; value: string }>) {
  return { jsonrpc: "2.0", id: 1, result: { number: "0x" + num.toString(16), transactions: txs } };
}

beforeEach(() => {
  sendRpcRequest.mockReset();
});

describe("byoActivity — fetchAddressActivityViaRpc", () => {
  it("returns only txs touching the address, hex normalized to decimals", async () => {
    const head = 100;
    sendRpcRequest.mockImplementation((req: { method: string; params: unknown[] }) => {
      if (req.method === "eth_blockNumber")
        return Promise.resolve({ jsonrpc: "2.0", id: 1, result: "0x" + head.toString(16) });
      const tag = (req.params[0] as string);
      const n = Number(BigInt(tag));
      if (n === head)
        return Promise.resolve(
          block(n, [
            { hash: "0xin", from: OTHER, to: WATCHED, value: "0xde0b6b3a7640000" }, // 1e18 in
            { hash: "0xunrelated", from: OTHER, to: OTHER, value: "0x1" },
          ]),
        );
      if (n === head - 1)
        return Promise.resolve(
          block(n, [{ hash: "0xout", from: WATCHED, to: null, value: "0x0" }]), // contract creation out
        );
      return Promise.resolve(block(n, []));
    });

    const out = await fetchAddressActivityViaRpc(WATCHED.toUpperCase(), 369);

    // Scanned in ascending block order: block 99 (0xout) before block 100 (0xin).
    expect(out).toEqual([
      { hash: "0xout", from: WATCHED, to: "", value: "0", blockNumber: "99" },
      { hash: "0xin", from: OTHER, to: WATCHED, value: "1000000000000000000", blockNumber: "100" },
    ]);
  });

  it("scans the full window (one eth_blockNumber + one getBlock per block)", async () => {
    const head = 50;
    sendRpcRequest.mockImplementation((req: { method: string; params: unknown[] }) => {
      if (req.method === "eth_blockNumber")
        return Promise.resolve({ jsonrpc: "2.0", id: 1, result: "0x" + head.toString(16) });
      return Promise.resolve(block(Number(BigInt(req.params[0] as string)), []));
    });

    await fetchAddressActivityViaRpc(WATCHED, 369);

    const getBlockCalls = sendRpcRequest.mock.calls.filter(
      (c) => (c[0] as { method: string }).method === "eth_getBlockByNumber",
    );
    expect(getBlockCalls).toHaveLength(12); // SCAN_BLOCKS
  });

  it("skips a missing block in the window without sinking the scan", async () => {
    const head = 30;
    sendRpcRequest.mockImplementation((req: { method: string; params: unknown[] }) => {
      if (req.method === "eth_blockNumber")
        return Promise.resolve({ jsonrpc: "2.0", id: 1, result: "0x" + head.toString(16) });
      const n = Number(BigInt(req.params[0] as string));
      if (n === head) return Promise.resolve({ jsonrpc: "2.0", id: 1, result: null });
      if (n === head - 1)
        return Promise.resolve(block(n, [{ hash: "0xhit", from: WATCHED, to: OTHER, value: "0x2" }]));
      return Promise.resolve(block(n, []));
    });

    const out = await fetchAddressActivityViaRpc(WATCHED, 369);
    expect(out).toEqual([
      { hash: "0xhit", from: WATCHED, to: OTHER, value: "2", blockNumber: "29" },
    ]);
  });

  it("throws when eth_blockNumber errors", async () => {
    sendRpcRequest.mockResolvedValue({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: "node down" } });
    await expect(fetchAddressActivityViaRpc(WATCHED, 369)).rejects.toThrow("node down");
  });
});
