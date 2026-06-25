import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { Providers } from "./_test-utils";

/**
 * useWatchRules — read-write hook over the IDB-backed watch-rule store. We mock
 * the pure rule helpers + the IDB load/persist seam (lib/watcher/rules) so the
 * hook's mutate→persist→setQueryData→invalidate flow is what's under test, not
 * IDB. add/toggle/remove/setWorkspaceEnabled each transform the list and write.
 *
 * Pure-UI store — rule fixtures are realistic (a PulseChain 369 address rule).
 */

const loadRules = vi.fn();
const persistRules = vi.fn();
const buildRule = vi.fn();
const toggleRule = vi.fn();
const removeRule = vi.fn();
const setEnabledForWorkspace = vi.fn();

vi.mock("../lib/watcher/rules", () => ({
  loadRules: (...a: unknown[]) => loadRules(...a),
  persistRules: (...a: unknown[]) => persistRules(...a),
  buildRule: (...a: unknown[]) => buildRule(...a),
  toggleRule: (...a: unknown[]) => toggleRule(...a),
  removeRule: (...a: unknown[]) => removeRule(...a),
  setEnabledForWorkspace: (...a: unknown[]) => setEnabledForWorkspace(...a),
}));

import { useWatchRules } from "../hooks/useWatchRules";

const RULE = {
  id: "r1",
  workspaceId: "ws1",
  chainId: 369,
  kind: "address_activity" as const,
  enabled: true,
  address: "0xa1077a294dde1b09bb078844df40758a5d0f9a27",
  direction: "both" as const,
  createdAt: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  loadRules.mockResolvedValue([]);
  persistRules.mockResolvedValue(undefined);
});

describe("useWatchRules", () => {
  it("loads rules from the store", async () => {
    loadRules.mockResolvedValue([RULE]);
    const { result } = renderHook(() => useWatchRules(), { wrapper: Providers });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.rules).toEqual([RULE]);
  });

  it("add: builds, prepends, and persists the rule", async () => {
    loadRules.mockResolvedValue([]);
    buildRule.mockReturnValue(RULE);
    const { result } = renderHook(() => useWatchRules(), { wrapper: Providers });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.add.mutateAsync({
        workspaceId: "ws1",
        chainId: 369,
        kind: "address_activity",
        address: RULE.address,
      });
    });

    expect(buildRule).toHaveBeenCalled();
    expect(persistRules).toHaveBeenCalledWith([RULE]);
  });

  it("toggle: applies toggleRule and persists", async () => {
    loadRules.mockResolvedValue([RULE]);
    toggleRule.mockReturnValue([{ ...RULE, enabled: false }]);
    const { result } = renderHook(() => useWatchRules(), { wrapper: Providers });
    await waitFor(() => expect(result.current.rules).toHaveLength(1));

    await act(async () => {
      await result.current.toggle.mutateAsync("r1");
    });
    expect(toggleRule).toHaveBeenCalledWith([RULE], "r1");
    expect(persistRules).toHaveBeenCalledWith([{ ...RULE, enabled: false }]);
  });

  it("remove: applies removeRule and persists", async () => {
    loadRules.mockResolvedValue([RULE]);
    removeRule.mockReturnValue([]);
    const { result } = renderHook(() => useWatchRules(), { wrapper: Providers });
    await waitFor(() => expect(result.current.rules).toHaveLength(1));

    await act(async () => {
      await result.current.remove.mutateAsync("r1");
    });
    expect(removeRule).toHaveBeenCalledWith([RULE], "r1");
    expect(persistRules).toHaveBeenCalledWith([]);
  });

  it("setWorkspaceEnabled: bulk-flips and persists", async () => {
    loadRules.mockResolvedValue([RULE]);
    setEnabledForWorkspace.mockReturnValue([{ ...RULE, enabled: false }]);
    const { result } = renderHook(() => useWatchRules(), { wrapper: Providers });
    await waitFor(() => expect(result.current.rules).toHaveLength(1));

    await act(async () => {
      await result.current.setWorkspaceEnabled.mutateAsync({
        workspaceId: "ws1",
        enabled: false,
      });
    });
    expect(setEnabledForWorkspace).toHaveBeenCalledWith([RULE], "ws1", false);
    expect(persistRules).toHaveBeenCalledWith([{ ...RULE, enabled: false }]);
  });

  it("add works against the loaded list (persists the prepended rule)", async () => {
    loadRules.mockResolvedValue([]);
    buildRule.mockReturnValue(RULE);
    const { result } = renderHook(() => useWatchRules(), { wrapper: Providers });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => {
      await result.current.add.mutateAsync({
        workspaceId: "ws1",
        chainId: 369,
        kind: "address_activity",
      });
    });
    expect(persistRules).toHaveBeenCalledWith([RULE]);
  });
});
