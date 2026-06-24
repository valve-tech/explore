import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * useNetworkHealth — the hook that chooses backend vs BYO-RPC and, for BYO,
 * streams a window's first load into the query cache via onProgress→setQueryData
 * (background refetches replace silently). We mock the data sources and the
 * active-chain/override seams and drive the streaming wiring directly.
 */

const fetchNetworkHealth = vi.fn();
const fetchBlockLadder = vi.fn();
const fetchNetworkHealthViaRpc = vi.fn();
const fetchBlockLadderViaRpc = vi.fn();
const isRpcOverridden = vi.fn();

vi.mock("../api/networkHealth", () => ({
  fetchNetworkHealth: (...a: unknown[]) => fetchNetworkHealth(...a),
  fetchBlockLadder: (...a: unknown[]) => fetchBlockLadder(...a),
}));
vi.mock("../lib/byoNetworkHealth", () => ({
  fetchNetworkHealthViaRpc: (...a: unknown[]) => fetchNetworkHealthViaRpc(...a),
  fetchBlockLadderViaRpc: (...a: unknown[]) => fetchBlockLadderViaRpc(...a),
}));
vi.mock("../lib/activeChain", () => ({ useActiveChainId: () => 369 }));
vi.mock("../lib/rpcEndpoint", () => ({
  isRpcOverridden: (...a: unknown[]) => isRpcOverridden(...a),
}));

import { useNetworkHealth, useBlockLadder } from "../hooks/useNetworkHealth";

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}
function wrap(client: QueryClient) {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

const RESULT = (n: number) => ({
  chainId: 369,
  burnsBaseFee: true,
  headBlock: "100",
  hasMore: true,
  aggregate: { blocksAnalyzed: n },
  miners: [],
  blocks: [],
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useNetworkHealth", () => {
  it("backend path: calls fetchNetworkHealth(chainId, limit), not the BYO reader", async () => {
    isRpcOverridden.mockReturnValue(false);
    fetchNetworkHealth.mockResolvedValue(RESULT(64));

    const { result } = renderHook(() => useNetworkHealth(64), { wrapper: wrap(makeClient()) });

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(fetchNetworkHealth).toHaveBeenCalledWith(369, 64);
    expect(fetchNetworkHealthViaRpc).not.toHaveBeenCalled();
  });

  it("BYO cold load: streams via onProgress, then resolves the full result", async () => {
    isRpcOverridden.mockReturnValue(true);
    let onProgress: ((p: unknown) => void) | undefined;
    let resolveFinal: ((v: unknown) => void) | undefined;
    fetchNetworkHealthViaRpc.mockImplementation(
      (_cid, _lim, _burns, opts: { onProgress?: (p: unknown) => void; signal?: AbortSignal }) => {
        onProgress = opts.onProgress;
        return new Promise((res) => {
          resolveFinal = res;
        });
      },
    );

    const { result } = renderHook(() => useNetworkHealth(512), { wrapper: wrap(makeClient()) });

    // burnsBaseFee (true for chain 369) is passed; streaming opts are present.
    await waitFor(() => expect(fetchNetworkHealthViaRpc).toHaveBeenCalled());
    const call = fetchNetworkHealthViaRpc.mock.calls[0]!;
    expect(call[0]).toBe(369);
    expect(call[1]).toBe(512);
    expect(call[2]).toBe(true);
    expect(typeof call[3].onProgress).toBe("function"); // streaming enabled on cold load
    expect(call[3].signal).toBeInstanceOf(AbortSignal);

    // A partial chunk paints immediately via setQueryData.
    act(() => onProgress!(RESULT(64)));
    await waitFor(() => expect(result.current.data?.aggregate.blocksAnalyzed).toBe(64));

    // The final full window replaces the partial on resolve.
    act(() => resolveFinal!(RESULT(512)));
    await waitFor(() => expect(result.current.data?.aggregate.blocksAnalyzed).toBe(512));
  });

  it("BYO refetch over loaded data: no streaming (onProgress undefined)", async () => {
    isRpcOverridden.mockReturnValue(true);
    const client = makeClient();
    // Seed the exact key so the queryFn sees existing data on refetch.
    client.setQueryData(["network-health", 369, 64, "byo"], RESULT(64));
    fetchNetworkHealthViaRpc.mockResolvedValue(RESULT(64));

    const { result } = renderHook(() => useNetworkHealth(64), { wrapper: wrap(client) });

    await act(async () => {
      await result.current.refetch();
    });

    const lastCall = fetchNetworkHealthViaRpc.mock.calls.at(-1)!;
    expect(lastCall[3].onProgress).toBeUndefined();
  });
});

describe("useBlockLadder", () => {
  it("backend by default; BYO reader (with signal) when overridden", async () => {
    isRpcOverridden.mockReturnValue(false);
    fetchBlockLadder.mockResolvedValue({ number: "100", txs: [] });
    const { result } = renderHook(() => useBlockLadder("100"), { wrapper: wrap(makeClient()) });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(fetchBlockLadder).toHaveBeenCalledWith(369, "100");

    vi.clearAllMocks();
    isRpcOverridden.mockReturnValue(true);
    fetchBlockLadderViaRpc.mockResolvedValue({ number: "100", txs: [] });
    const { result: r2 } = renderHook(() => useBlockLadder("100"), { wrapper: wrap(makeClient()) });
    await waitFor(() => expect(r2.current.data).toBeDefined());
    const call = fetchBlockLadderViaRpc.mock.calls[0]!;
    expect(call[0]).toBe(369);
    expect(call[1]).toBe("100");
    expect(call[2]).toBe(true); // burnsBaseFee
    expect(call[3]).toBeInstanceOf(AbortSignal);
  });

  it("is disabled when no block number is given", () => {
    isRpcOverridden.mockReturnValue(false);
    const { result } = renderHook(() => useBlockLadder(null), { wrapper: wrap(makeClient()) });
    expect(result.current.fetchStatus).toBe("idle");
    expect(fetchBlockLadder).not.toHaveBeenCalled();
  });
});
