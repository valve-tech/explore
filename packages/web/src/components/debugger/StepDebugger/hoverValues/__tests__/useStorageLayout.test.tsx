import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useStorageLayout } from "../useStorageLayout";
import pepe from "./fixtures/pepeToken.json";

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, Wrapper };
}
const mockFetch = (body: unknown) => {
  const fn = vi.fn(async (_url: string) => ({ ok: true, json: async () => body }) as Response);
  vi.stubGlobal("fetch", fn);
  return fn;
};

afterEach(() => vi.unstubAllGlobals());

describe("useStorageLayout", () => {
  // The body is the real answer for PepeToken on Ethereum.
  const body = { ok: true, storageLayout: pepe.storageLayout, contractName: "PepeToken", source: "compiled" };

  it("fetches the layout for the chain and keys the cache by chain and address", async () => {
    const fn = mockFetch(body);
    const { client, Wrapper } = wrapper();
    const { result } = renderHook(() => useStorageLayout(pepe.address, 1), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.layout).not.toBeNull());
    expect(result.current.contractName).toBe("PepeToken");
    expect(result.current.layout?.storage[0]?.label).toBe("_owner");
    const url = String(fn.mock.calls[0]![0]);
    expect(url).toContain(`/api/source/${pepe.address}/storage-layout`);
    expect(url).toContain("chainid=1");
    expect(client.getQueryData(["storage-layout", 1, pepe.address.toLowerCase()])).toBeTruthy();
    expect(client.getQueryData(["storage-layout", 369, pepe.address.toLowerCase()])).toBeUndefined();
  });

  it("fetches again for the same address on another chain", async () => {
    const fn = mockFetch(body);
    const { Wrapper } = wrapper();
    const { result, rerender } = renderHook(({ chain }) => useStorageLayout(pepe.address, chain), {
      wrapper: Wrapper, initialProps: { chain: 1 },
    });
    await waitFor(() => expect(result.current.layout).not.toBeNull());
    rerender({ chain: 369 });
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(2));
    // scoped() leaves the parameter out for the default chain (369).
    expect(String(fn.mock.calls[1]![0])).not.toContain("chainid=1");
  });

  it("gives no layout for a decompiled answer or an error answer", async () => {
    mockFetch({ ok: true, source: "decompiled", decompiled: { slots: [], pseudoSource: null, inferredAbi: null } });
    const a = wrapper();
    const first = renderHook(() => useStorageLayout(pepe.address, 1), { wrapper: a.Wrapper });
    await waitFor(() => expect(first.result.current.isLoading).toBe(false));
    expect(first.result.current).toMatchObject({ layout: null, contractName: null });

    mockFetch({ ok: false, error: "Storage layout not available (compiler may be too old)" });
    const b = wrapper();
    const second = renderHook(() => useStorageLayout(pepe.address, 1), { wrapper: b.Wrapper });
    await waitFor(() => expect(second.result.current.isLoading).toBe(false));
    expect(second.result.current.layout).toBeNull();
  });

  it("does not fetch without a valid address", () => {
    const fn = mockFetch(body);
    const { Wrapper } = wrapper();
    renderHook(() => useStorageLayout(null, 1), { wrapper: Wrapper });
    renderHook(() => useStorageLayout("0x1234", 1), { wrapper: Wrapper });
    expect(fn).not.toHaveBeenCalled();
  });
});
