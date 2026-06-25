import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { Providers } from "./_test-utils";

/**
 * useContractSource — the verified-source query (sibling useSourceMappings is
 * covered in useContractSource.test.tsx). Exercises the disabled gate, the
 * verified path, and the cached-null (definitively-unverified) staleTime
 * branch. We mock api/source + the active-chain seam.
 *
 * Fixture address: WPLS on PulseChain 369.
 *   https://scan.pulsechain.com/address/0xA1077a294dDE1B09bB078844df40758a5D0f9a27
 */

const fetchContractSourceWithRetry = vi.fn();
const fetchTraceSourceMap = vi.fn();

vi.mock("../api/source", () => ({
  fetchContractSourceWithRetry: (...a: unknown[]) =>
    fetchContractSourceWithRetry(...a),
  fetchTraceSourceMap: (...a: unknown[]) => fetchTraceSourceMap(...a),
}));
vi.mock("../lib/activeChain", () => ({ useActiveChainId: () => 369 }));

import { useContractSource, useSourceMappings } from "../hooks/useContractSource";

const WPLS = "0xA1077a294dDE1B09bB078844df40758a5D0f9a27";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useContractSource", () => {
  it("is disabled with no address", () => {
    const { result } = renderHook(() => useContractSource(null), {
      wrapper: Providers,
    });
    expect(result.current.fetchStatus).toBe("idle");
    expect(fetchContractSourceWithRetry).not.toHaveBeenCalled();
  });

  it("returns a verified source for an address (cached ∞)", async () => {
    fetchContractSourceWithRetry.mockResolvedValue({ contractName: "WPLS", files: [] });
    const { result } = renderHook(() => useContractSource(WPLS), {
      wrapper: Providers,
    });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(fetchContractSourceWithRetry).toHaveBeenCalledWith(WPLS);
    expect(result.current.data?.contractName).toBe("WPLS");
  });

  it("caches null (definitively unverified) without throwing — 15min TTL branch", async () => {
    fetchContractSourceWithRetry.mockResolvedValue(null);
    const { result } = renderHook(() => useContractSource(WPLS), {
      wrapper: Providers,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });
});

describe("useSourceMappings (staleTime + throw branches)", () => {
  it("throws when fetchTraceSourceMap returns null (transient)", async () => {
    fetchTraceSourceMap.mockResolvedValue(null);
    const { result } = renderHook(() => useSourceMappings(WPLS, [1]), {
      wrapper: Providers,
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
  });

  it("returns an empty (unmappable) map — TTL staleTime branch", async () => {
    fetchTraceSourceMap.mockResolvedValue({ mappings: {} });
    const { result } = renderHook(() => useSourceMappings(WPLS, [1]), {
      wrapper: Providers,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({});
  });

  it("returns a non-empty map — ∞ staleTime branch", async () => {
    fetchTraceSourceMap.mockResolvedValue({
      mappings: { 7: { start: 0, length: 4, fileIndex: 0 } },
    });
    const { result } = renderHook(() => useSourceMappings(WPLS, [7, 1]), {
      wrapper: Providers,
    });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data?.[7]).toBeTruthy();
  });
});
