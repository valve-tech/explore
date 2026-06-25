import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Supplements byoActivity.test.ts — covers the toDec() catch branch: a tx with
 * a malformed hex value is coerced to "0" rather than throwing the scan.
 */

const sendRpcRequest = vi.fn();
vi.mock("../api/rpc", () => ({
  sendRpcRequest: (...args: unknown[]) => sendRpcRequest(...args),
}));

import { fetchAddressActivityViaRpc } from "../lib/watcher/byoActivity";

const WATCHED = "0xaaaa000000000000000000000000000000000001";
const OTHER = "0xbbbb000000000000000000000000000000000002";
const ok = (result: unknown) => ({ jsonrpc: "2.0", id: 1, result });

beforeEach(() => {
  sendRpcRequest.mockReset();
});

describe("byoActivity — malformed value coercion", () => {
  it("coerces an unparseable tx value to '0' (toDec catch)", async () => {
    const head = 40;
    sendRpcRequest.mockImplementation((req: { method: string; params: unknown[] }) => {
      if (req.method === "eth_blockNumber")
        return Promise.resolve(ok("0x" + head.toString(16)));
      const n = Number(BigInt(req.params[0] as string));
      if (n === head)
        return Promise.resolve(
          ok({
            number: "0x" + n.toString(16),
            transactions: [
              { hash: "0xhit", from: WATCHED, to: OTHER, value: "0xZZZ" }, // malformed
            ],
          }),
        );
      return Promise.resolve(ok({ number: "0x" + n.toString(16), transactions: [] }));
    });

    const out = await fetchAddressActivityViaRpc(WATCHED, 369);
    expect(out).toEqual([
      { hash: "0xhit", from: WATCHED, to: OTHER, value: "0", blockNumber: "40" },
    ]);
  });
});
