import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { MemoryRouter, useSearchParams } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useResolvedChainRedirect } from "../lib/useResolvedChainRedirect";

/**
 * Task 13 fix round.
 *
 * The hook's own "the URL already names a chain" guard checked only the
 * `?chainid=` query parameter, so a chain-SCOPED PATH (`/eip155/943/tx/0xabc`)
 * still looked chain-less to it. That fanned a needless four-chain resolve out
 * on every scoped page load, then wrote `?chainid=943` on top of a path that
 * already named the chain — the chain named twice in one URL.
 *
 * The hook must treat a path prefix exactly like the query param: either one
 * is an explicit, stated scope, and both disable the resolve.
 */

const resolveMock = vi.hoisted(() => vi.fn());
vi.mock("../api/resolve", () => ({ resolveEntity: resolveMock }));

afterEach(() => resolveMock.mockReset());

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

describe("useResolvedChainRedirect — a path prefix is also a stated scope", () => {
  it("never resolves on a chain-scoped path, and writes no chainid param", () => {
    const seenChainIds: (string | null)[] = [];
    function Probe() {
      const [params] = useSearchParams();
      const state = useResolvedChainRedirect("0xabc");
      seenChainIds.push(params.get("chainid"));
      return state;
    }
    const { result } = renderHook(() => Probe(), {
      wrapper: wrapper("/eip155/943/tx/0xabc"),
    });

    expect(result.current).toBe("idle");
    expect(resolveMock).not.toHaveBeenCalled();
    expect(seenChainIds.every((v) => v === null)).toBe(true);
  });
});

describe("useResolvedChainRedirect — an empty chainid is not a stated scope", () => {
  it("resolves /tx/0xabc?chainid= (empty value) and writes a real chain", async () => {
    // `?chainid=` carries no value, so `parseChainScope` maps it to "all" —
    // the same as no param at all. Treating it as a scope would strand the
    // page on PulseChain with no way to reach the entity's real chain; a real
    // resolve is strictly more useful, and it still terminates cleanly
    // because writing the real chain id is what disables the hook.
    resolveMock.mockResolvedValue({
      kind: "tx",
      query: "0xabc",
      matches: [{ chainId: 943 }],
    });

    const seenChainIds: (string | null)[] = [];
    function Probe() {
      const [params] = useSearchParams();
      const state = useResolvedChainRedirect("0xabc");
      seenChainIds.push(params.get("chainid"));
      return state;
    }
    const { result } = renderHook(() => Probe(), {
      wrapper: wrapper("/tx/0xabc?chainid="),
    });

    await waitFor(() => expect(resolveMock).toHaveBeenCalledWith("0xabc"));
    await waitFor(() => expect(seenChainIds).toContain("943"));
    await waitFor(() => expect(result.current).toBe("idle"));
  });
});
