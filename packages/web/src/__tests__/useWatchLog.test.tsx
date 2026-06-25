import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { Providers } from "./_test-utils";

/**
 * useWatchLog — read-write hook over the IDB-backed match log. We mock the pure
 * log helpers + IDB load/persist (lib/watcher/log). append() stamps a match,
 * dedupes via appendMatches, skips the write on a no-op (reference equality),
 * and clear() empties the log.
 *
 * Pure-UI store — match fixture is realistic.
 */

const loadMatches = vi.fn();
const persistMatches = vi.fn();
const appendMatches = vi.fn();
const toMatch = vi.fn();

vi.mock("../lib/watcher/log", () => ({
  loadMatches: (...a: unknown[]) => loadMatches(...a),
  persistMatches: (...a: unknown[]) => persistMatches(...a),
  appendMatches: (...a: unknown[]) => appendMatches(...a),
  toMatch: (...a: unknown[]) => toMatch(...a),
}));

import { useWatchLog } from "../hooks/useWatchLog";

const RULE = {
  id: "r1",
  workspaceId: "ws1",
  chainId: 369,
  kind: "address_activity" as const,
  enabled: true,
  createdAt: 1,
};
const CONTENT = { lead: "0xabc sent ", amount: null, trail: " → 0xdef" };
const MATCH = {
  ...CONTENT,
  id: "m1",
  ruleId: "r1",
  workspaceId: "ws1",
  chainId: 369,
  kind: "address_activity" as const,
  label: "Address activity",
  at: 1700000000,
};

beforeEach(() => {
  vi.clearAllMocks();
  loadMatches.mockResolvedValue([]);
  persistMatches.mockResolvedValue(undefined);
});

describe("useWatchLog", () => {
  it("loads existing matches", async () => {
    loadMatches.mockResolvedValue([MATCH]);
    const { result } = renderHook(() => useWatchLog(), { wrapper: Providers });
    await waitFor(() => expect(result.current.matches).toEqual([MATCH]));
  });

  it("append: persists a fresh match and returns the stamped match", async () => {
    loadMatches.mockResolvedValue([]);
    toMatch.mockReturnValue(MATCH);
    appendMatches.mockReturnValue([MATCH]); // not reference-equal to []
    const { result } = renderHook(() => useWatchLog(), { wrapper: Providers });
    await waitFor(() => expect(result.current.matches).toEqual([]));

    let returned: unknown;
    await act(async () => {
      returned = await result.current.append.mutateAsync({
        rule: RULE,
        content: CONTENT,
      });
    });
    expect(toMatch).toHaveBeenCalledWith(RULE, CONTENT);
    expect(persistMatches).toHaveBeenCalledWith([MATCH]);
    expect(returned).toBe(MATCH);
  });

  it("append: returns null and skips the write on a duplicate (reference equal)", async () => {
    const current: typeof MATCH[] = [];
    loadMatches.mockResolvedValue(current);
    toMatch.mockReturnValue(MATCH);
    // appendMatches returns the SAME reference → dedupe no-op
    appendMatches.mockImplementation((existing: unknown) => existing);
    const { result } = renderHook(() => useWatchLog(), { wrapper: Providers });
    await waitFor(() => expect(result.current.matches).toEqual(current));

    let returned: unknown = "sentinel";
    await act(async () => {
      returned = await result.current.append.mutateAsync({
        rule: RULE,
        content: CONTENT,
      });
    });
    expect(returned).toBeNull();
    expect(persistMatches).not.toHaveBeenCalled();
  });

  it("clear: persists an empty log", async () => {
    loadMatches.mockResolvedValue([MATCH]);
    const { result } = renderHook(() => useWatchLog(), { wrapper: Providers });
    await waitFor(() => expect(result.current.matches).toEqual([MATCH]));

    await act(async () => {
      await result.current.clear.mutateAsync();
    });
    expect(persistMatches).toHaveBeenCalledWith([]);
  });
});
