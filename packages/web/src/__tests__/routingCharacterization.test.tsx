import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { MemoryRouter, useSearchParams } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { getActiveChainId } from "../lib/activeChain";
import { scanPath } from "../lib/scanRoutes";
import { scoped } from "../api/chainScope";
import { DEFAULT_CHAIN_ID } from "../lib/chains";
import { useResolvedChainRedirect } from "../lib/useResolvedChainRedirect";

/**
 * Characterization tests. These pin behaviour that already ships, so the
 * multichain routing refactor cannot change it by accident. They are not
 * aspirational — if one fails, the refactor broke something real.
 */

const resolveMock = vi.hoisted(() => vi.fn());
vi.mock("../api/resolve", () => ({ resolveEntity: resolveMock }));

const original = window.location.href;
afterEach(() => {
  window.history.replaceState({}, "", original);
  resolveMock.mockReset();
});

function wrapper(initialEntry: string) {
  return function Wrapper({ children }: { children: ReactNode }) {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    return (
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[initialEntry]}>{children}</MemoryRouter>
      </QueryClientProvider>
    );
  };
}

describe("getActiveChainId — both router shapes", () => {
  it("reads chainid from location.search (BrowserRouter build)", () => {
    window.history.replaceState({}, "", "/tx/0xabc?chainid=1");
    expect(getActiveChainId()).toBe(1);
  });

  it("reads chainid from the hash query (HashRouter / IPFS build)", () => {
    window.history.replaceState({}, "", "/#/tx/0xabc?chainid=943");
    expect(getActiveChainId()).toBe(943);
  });

  it("treats an empty chainid as the default, not as absent", () => {
    window.history.replaceState({}, "", "/tx/0xabc?chainid=");
    expect(getActiveChainId()).toBe(DEFAULT_CHAIN_ID);
  });
});

describe("scanPath — EIP-3091 shapes", () => {
  it("builds today's bare paths", () => {
    expect(scanPath("tx", "0xabc")).toBe("/tx/0xabc");
    expect(scanPath("block", "123")).toBe("/block/123");
    expect(scanPath("address", "0xdef")).toBe("/address/0xdef");
    expect(scanPath("contract", "0xdef")).toBe("/token/0xdef");
  });
});

describe("scoped — API transport", () => {
  it("omits chainid for the default chain", () => {
    expect(scoped("/api/tx/0xabc", DEFAULT_CHAIN_ID)).toBe("/api/tx/0xabc");
  });

  it("appends chainid for any other chain, respecting an existing query", () => {
    expect(scoped("/api/tx/0xabc", 1)).toBe("/api/tx/0xabc?chainid=1");
    expect(scoped("/api/tx/0xabc?limit=5", 1)).toBe("/api/tx/0xabc?limit=5&chainid=1");
  });
});

describe("useResolvedChainRedirect — the three invariants", () => {
  it("invariant 1: does not run when the URL already names a chain", async () => {
    const { result } = renderHook(() => useResolvedChainRedirect("0xabc"), {
      wrapper: wrapper("/tx/0xabc?chainid=1"),
    });
    expect(result.current).toBe("idle");
    expect(resolveMock).not.toHaveBeenCalled();
  });

  it("invariant 2: never reports 'settled' while a redirect to a non-default chain is pending", async () => {
    resolveMock.mockResolvedValue({ kind: "tx", query: "0xabc", matches: [{ chainId: 943 }] });
    // Sampling `result.current` at one moment cannot catch a regression here:
    // the redirect effect and the data arrival land in the same flushed
    // cycle, so an intermediate "settled" render is overwritten by "idle"
    // before a single read could see it. Record every render instead.
    const seenStates: string[] = [];
    const seenChainIds: (string | null)[] = [];
    function Probe() {
      const [params] = useSearchParams();
      const state = useResolvedChainRedirect("0xabc");
      seenStates.push(state);
      seenChainIds.push(params.get("chainid"));
      return state;
    }
    const { result } = renderHook(() => Probe(), { wrapper: wrapper("/tx/0xabc") });
    // Once the redirect writes `chainid=943`, `urlNamesChain` flips and the
    // hook's own terminal state for this case is "idle" — see the hook's
    // docblock. Wait for that, then check the full history.
    await waitFor(() => expect(result.current).toBe("idle"));
    expect(seenStates).not.toContain("settled");
    expect(seenChainIds).toContain("943");
  });

  it("invariant 3: does not redirect when the entity is on the default chain", async () => {
    resolveMock.mockResolvedValue({
      kind: "tx",
      query: "0xabc",
      matches: [{ chainId: DEFAULT_CHAIN_ID }],
    });
    const seen: string[] = [];
    function Probe() {
      const [params] = useSearchParams();
      seen.push(params.get("chainid") ?? "absent");
      return useResolvedChainRedirect("0xabc");
    }
    const { result } = renderHook(() => Probe(), { wrapper: wrapper("/tx/0xabc") });
    await waitFor(() => expect(result.current).toBe("settled"));
    expect(seen.every((v) => v === "absent")).toBe(true);
  });
});
