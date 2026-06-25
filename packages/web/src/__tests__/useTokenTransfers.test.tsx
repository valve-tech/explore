import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { Providers } from "./_test-utils";

/**
 * useTokenTransfers — picks the chifra-backed API reader or the BYO-RPC reader
 * based on isRpcOverridden, widens the window on loadMore (24h→7d→30d), and
 * projects query state into the LoadStatus shape. We mock both readers + the
 * override/active-chain seams.
 *
 * Fixture: WPLS Transfer in block 26804224, value "5456507558918974858760".
 *   https://scan.pulsechain.com/block/26804224
 *   https://scan.pulsechain.com/address/0xA1077a294dDE1B09bB078844df40758a5D0f9a27
 */

const fetchTokenTransfers = vi.fn();
const fetchTransfersViaRpc = vi.fn();
const isRpcOverridden = vi.fn();

vi.mock("../api/explorer", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchTokenTransfers: (...a: unknown[]) => fetchTokenTransfers(...a),
}));
vi.mock("../lib/byoTransfers", () => ({
  fetchTransfersViaRpc: (...a: unknown[]) => fetchTransfersViaRpc(...a),
}));
vi.mock("../lib/rpcEndpoint", () => ({
  isRpcOverridden: (...a: unknown[]) => isRpcOverridden(...a),
}));
vi.mock("../lib/activeChain", () => ({ useActiveChainId: () => 369 }));

import { useTokenTransfers } from "../hooks/useTokenTransfers";

const WPLS = "0xA1077a294dDE1B09bB078844df40758a5D0f9a27";
const WIN = {
  records: [
    {
      blockNumber: 26804224,
      blockTimestamp: 1700000000,
      txHash: "0xdead",
      logIndex: 0,
      from: "0x0000000000000000000000000000000000000000",
      to: "0x1111111111111111111111111111111111111111",
      value: "5456507558918974858760",
      variant: "erc20" as const,
    },
  ],
  firstBlock: 26804000,
  lastBlock: 26804224,
  truncated: false,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useTokenTransfers", () => {
  it("backend path: reads chifra transfers, projects success state", async () => {
    isRpcOverridden.mockReturnValue(false);
    fetchTokenTransfers.mockResolvedValue(WIN);

    const { result } = renderHook(() => useTokenTransfers(WPLS), {
      wrapper: Providers,
    });

    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(fetchTokenTransfers).toHaveBeenCalledWith(WPLS, "24h", 369);
    expect(fetchTransfersViaRpc).not.toHaveBeenCalled();
    expect(result.current.records[0]?.value).toBe("5456507558918974858760");
    expect(result.current.headBlock).toBe(26804224);
    expect(result.current.fromBlock).toBe(26804000);
    expect(result.current.window).toBe("24h");
    expect(result.current.canLoadMore).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it("BYO path: reads transfers via the user's RPC", async () => {
    isRpcOverridden.mockReturnValue(true);
    fetchTransfersViaRpc.mockResolvedValue(WIN);

    const { result } = renderHook(() => useTokenTransfers(WPLS), {
      wrapper: Providers,
    });
    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(fetchTransfersViaRpc).toHaveBeenCalledWith(WPLS, "24h", 369);
    expect(fetchTokenTransfers).not.toHaveBeenCalled();
  });

  it("loadMore widens the window 24h → 7d → 30d, then canLoadMore is false", async () => {
    isRpcOverridden.mockReturnValue(false);
    fetchTokenTransfers.mockResolvedValue(WIN);

    const { result } = renderHook(() => useTokenTransfers(WPLS), {
      wrapper: Providers,
    });
    await waitFor(() => expect(result.current.status).toBe("success"));

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.window).toBe("7d"));

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.window).toBe("30d"));
    expect(result.current.canLoadMore).toBe(false);

    // loadMore past the widest window is a no-op.
    act(() => result.current.loadMore());
    expect(result.current.window).toBe("30d");
  });

  it("surfaces the query error message", async () => {
    isRpcOverridden.mockReturnValue(false);
    fetchTokenTransfers.mockRejectedValue(new Error("boom"));

    const { result } = renderHook(() => useTokenTransfers(WPLS), {
      wrapper: Providers,
    });
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toBe("boom");
  });

  it("falls back to a generic message when the error is not an Error", async () => {
    isRpcOverridden.mockReturnValue(false);
    // Reject with a non-Error value → the `query.error instanceof Error`
    // branch is false, so the generic fallback string is used.
    fetchTokenTransfers.mockRejectedValue("string failure");

    const { result } = renderHook(() => useTokenTransfers(WPLS), {
      wrapper: Providers,
    });
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toBe("Failed to load transfers");
  });
});
