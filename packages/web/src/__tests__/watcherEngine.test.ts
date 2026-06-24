import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Watch engine — `fetchRuleItems` is the effectful adapter that pulls a rule's
 * recent activity (backend REST by default, or the user's node under BYO-RPC),
 * normalizes it, and runs the pure matchers. We mock the data sources and assert
 * the mapping + dedupe keys + matcher wiring for both kinds × both transports.
 *
 * Known setup (erc20 branch) — the same real WPLS transfer used in
 * byoTransfers.test.ts:
 *   tx https://explore.valve.city/tx/0xd515ef07d4308c389b05fe13c55ac1ebe3270bd8bbf4470b0a134a1766fe3c81?chainid=369
 *   5456.507558918974858760 WPLS, 0x1551…6fbb → 0x165c…52d9, logIndex 271
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
import { renderWatchSummary } from "../lib/watcher/summary";

const WPLS = "0xa1077a294dde1b09bb078844df40758a5d0f9a27";
const ADDR = "0x155172653e94a7e5f0e04126803dcb6896796fbb"; // a real PulseChain account
const COUNTERPARTY = "0x165c3410fc91ef562c50559f7d2289febed552d9";

// The real WPLS transfer, in the normalized ChifraTransfer shape the chart/window uses.
const WPLS_RECORD = {
  blockNumber: 26804224,
  blockTimestamp: 0,
  txHash: "0xd515ef07d4308c389b05fe13c55ac1ebe3270bd8bbf4470b0a134a1766fe3c81",
  logIndex: 271,
  from: ADDR,
  to: COUNTERPARTY,
  value: "5456507558918974858760",
  variant: "erc20" as const,
};
const wplsWindow = { records: [WPLS_RECORD], firstBlock: 26795584, lastBlock: 26804224, truncated: false };

// A native (PLS) transfer touching ADDR, in the AddressTransaction shape.
const NATIVE_TX = {
  hash: "0xnative1",
  blockNumber: "26804500",
  from: ADDR,
  to: COUNTERPARTY,
  value: (10n ** 18n).toString(), // 1 PLS
};

function activityRule() {
  return buildRule({ workspaceId: "w", chainId: 369, kind: "address_activity", address: ADDR });
}
function erc20Rule(over = {}) {
  return buildRule({ workspaceId: "w", chainId: 369, kind: "erc20_transfer", contractAddress: WPLS, ...over });
}

beforeEach(() => {
  vi.clearAllMocks();
  isRpcOverridden.mockReturnValue(false); // backend path by default
});

describe("watcher/engine — fetchRuleItems", () => {
  it("returns nothing for a non-actionable rule (no fetch)", async () => {
    const bare = buildRule({ workspaceId: "w", chainId: 369, kind: "erc20_transfer" }); // no token
    expect(await fetchRuleItems(bare)).toEqual([]);
    expect(fetchTokenTransfers).not.toHaveBeenCalled();
  });

  it("address_activity (backend): maps txs to items keyed by hash and fires the matcher", async () => {
    fetchAddressTransactions.mockResolvedValue({ transactions: [NATIVE_TX], total: 1 });

    const items = await fetchRuleItems(activityRule());

    expect(fetchAddressTransactions).toHaveBeenCalledWith(ADDR, 1, 25, 369);
    expect(items).toHaveLength(1);
    expect(items[0]!.key).toBe("0xnative1");
    expect(items[0]!.contents).toHaveLength(1);
    expect(renderWatchSummary(items[0]!.contents[0]!)).toContain("sent 1 ");
  });

  it("address_activity (BYO): reads the node scan instead of the backend", async () => {
    isRpcOverridden.mockReturnValue(true);
    fetchAddressActivityViaRpc.mockResolvedValue([NATIVE_TX]);

    const items = await fetchRuleItems(activityRule());

    expect(fetchAddressActivityViaRpc).toHaveBeenCalledWith(ADDR, 369);
    expect(fetchAddressTransactions).not.toHaveBeenCalled();
    expect(items[0]!.key).toBe("0xnative1");
  });

  it("erc20_transfer (backend): maps the real WPLS transfer, keyed txHash:logIndex, scaled by meta", async () => {
    getTokenMeta.mockResolvedValue({ decimals: 18, symbol: "WPLS" });
    fetchTokenTransfers.mockResolvedValue(wplsWindow);

    const items = await fetchRuleItems(erc20Rule());

    expect(getTokenMeta).toHaveBeenCalledWith(369, WPLS);
    expect(fetchTokenTransfers).toHaveBeenCalledWith(WPLS, "24h", 369);
    expect(items).toHaveLength(1);
    expect(items[0]!.key).toBe(`${WPLS_RECORD.txHash}:271`);
    const summary = renderWatchSummary(items[0]!.contents[0]!);
    expect(summary).toContain("5456.50"); // 5456.5075… WPLS, scaled at the render edge
    expect(summary).toContain("WPLS");
  });

  it("erc20_transfer (BYO): reads transfers from the node, same mapping", async () => {
    isRpcOverridden.mockReturnValue(true);
    getTokenMeta.mockResolvedValue({ decimals: 18, symbol: "WPLS" });
    fetchTransfersViaRpc.mockResolvedValue(wplsWindow);

    const items = await fetchRuleItems(erc20Rule());

    expect(fetchTransfersViaRpc).toHaveBeenCalledWith(WPLS, "24h", 369);
    expect(fetchTokenTransfers).not.toHaveBeenCalled();
    expect(items[0]!.key).toBe(`${WPLS_RECORD.txHash}:271`);
  });

  it("erc20_transfer: a counterparty filter that doesn't match yields an empty-content item", async () => {
    getTokenMeta.mockResolvedValue({ decimals: 18, symbol: "WPLS" });
    fetchTokenTransfers.mockResolvedValue(wplsWindow);

    const other = "0x9999999999999999999999999999999999999999";
    const items = await fetchRuleItems(erc20Rule({ counterparty: other }));

    expect(items).toHaveLength(1); // the record is still listed…
    expect(items[0]!.contents).toEqual([]); // …but the rule didn't fire on it
  });
});
