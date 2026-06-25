import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Supplements watcherEngine.test.ts — covers the tolerant coercion catch
 * branches inside fetchRuleItems: safeBigInt() on a non-numeric tx value (→ 0n)
 * and safeBlock() on a non-numeric blockNumber (→ null), driven through the
 * backend address_activity path.
 */

const fetchAddressTransactions = vi.fn();
const fetchTokenTransfers = vi.fn();
const getTokenMeta = vi.fn();
const isRpcOverridden = vi.fn();
const fetchTransfersViaRpc = vi.fn();
const fetchAddressActivityViaRpc = vi.fn();

vi.mock("../api/explorer", () => ({
  fetchAddressTransactions: (...a: unknown[]) => fetchAddressTransactions(...a),
  fetchTokenTransfers: (...a: unknown[]) => fetchTokenTransfers(...a),
}));
vi.mock("../lib/watcher/tokenMeta", () => ({
  getTokenMeta: (...a: unknown[]) => getTokenMeta(...a),
}));
vi.mock("../lib/rpcEndpoint", () => ({
  isRpcOverridden: (...a: unknown[]) => isRpcOverridden(...a),
}));
vi.mock("../lib/byoTransfers", () => ({
  fetchTransfersViaRpc: (...a: unknown[]) => fetchTransfersViaRpc(...a),
}));
vi.mock("../lib/watcher/byoActivity", () => ({
  fetchAddressActivityViaRpc: (...a: unknown[]) => fetchAddressActivityViaRpc(...a),
}));

import { fetchRuleItems } from "../lib/watcher/engine";
import { buildRule } from "../lib/watcher/rules";

const ADDR = "0xaaaa000000000000000000000000000000000001";

beforeEach(() => {
  vi.clearAllMocks();
  isRpcOverridden.mockReturnValue(false);
});

describe("watcher/engine — tolerant coercion in fetchRuleItems", () => {
  it("coerces a malformed tx value (safeBigInt→0n) and blockNumber (safeBlock→null) without throwing", async () => {
    fetchAddressTransactions.mockResolvedValue({
      transactions: [
        { hash: "0xbad", from: ADDR, to: null, value: "not-a-number", blockNumber: "nope" },
      ],
      total: 1,
    });

    const rule = buildRule({
      workspaceId: "w",
      chainId: 369,
      kind: "address_activity",
      address: ADDR,
    });
    const items = await fetchRuleItems(rule);

    expect(items).toHaveLength(1);
    expect(items[0]!.key).toBe("0xbad");
    // A zero-value out-tx still fires (no min threshold); blockNumber was null →
    // not carried, so the content has no blockNumber.
    expect(items[0]!.contents).toHaveLength(1);
    expect(items[0]!.contents[0]!.blockNumber).toBeUndefined();
  });
});
