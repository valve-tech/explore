import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { Providers } from "./_test-utils";

/**
 * useWorkspaces — read-write hook over the IDB-backed Workspace store. We mock
 * the pure store helpers + load/persist seam (lib/workspace/store) so the
 * mutate→persist→setQueryData→invalidate flow is under test. Covers
 * create/remove/rename/addToWorkspace/removeFromWorkspace.
 *
 * Pure-UI store — workspace/item fixtures are realistic (a PulseChain 369 addr).
 */

const loadStore = vi.fn();
const persistWorkspaces = vi.fn();
const createWorkspace = vi.fn();
const renameWorkspace = vi.fn();
const addItem = vi.fn();
const removeItem = vi.fn();

vi.mock("../lib/workspace/store", () => ({
  loadStore: (...a: unknown[]) => loadStore(...a),
  persistWorkspaces: (...a: unknown[]) => persistWorkspaces(...a),
  createWorkspace: (...a: unknown[]) => createWorkspace(...a),
  renameWorkspace: (...a: unknown[]) => renameWorkspace(...a),
  addItem: (...a: unknown[]) => addItem(...a),
  removeItem: (...a: unknown[]) => removeItem(...a),
}));

import { useWorkspaces } from "../hooks/useWorkspaces";

const WS = {
  id: "ws1",
  name: "My Watchlist",
  items: [],
  createdAt: 1,
  updatedAt: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  loadStore.mockResolvedValue({ workspaces: [] });
  persistWorkspaces.mockResolvedValue(undefined);
});

describe("useWorkspaces", () => {
  it("loads workspaces from the store", async () => {
    loadStore.mockResolvedValue({ workspaces: [WS] });
    const { result } = renderHook(() => useWorkspaces(), { wrapper: Providers });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.workspaces).toEqual([WS]);
  });

  it("create: builds, prepends, persists, returns the fresh workspace", async () => {
    loadStore.mockResolvedValue({ workspaces: [] });
    createWorkspace.mockReturnValue(WS);
    const { result } = renderHook(() => useWorkspaces(), { wrapper: Providers });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let returned: unknown;
    await act(async () => {
      returned = await result.current.create.mutateAsync({
        name: "My Watchlist",
        description: "x",
      });
    });
    expect(createWorkspace).toHaveBeenCalledWith("My Watchlist", "x");
    expect(persistWorkspaces).toHaveBeenCalledWith([WS]);
    expect(returned).toBe(WS);
  });

  it("remove: filters out by id and persists", async () => {
    loadStore.mockResolvedValue({ workspaces: [WS] });
    const { result } = renderHook(() => useWorkspaces(), { wrapper: Providers });
    await waitFor(() => expect(result.current.workspaces).toHaveLength(1));

    await act(async () => {
      await result.current.remove.mutateAsync("ws1");
    });
    expect(persistWorkspaces).toHaveBeenCalledWith([]);
  });

  it("rename: maps the matching workspace through renameWorkspace", async () => {
    loadStore.mockResolvedValue({ workspaces: [WS] });
    const renamed = { ...WS, name: "Renamed" };
    renameWorkspace.mockReturnValue(renamed);
    const { result } = renderHook(() => useWorkspaces(), { wrapper: Providers });
    await waitFor(() => expect(result.current.workspaces).toHaveLength(1));

    await act(async () => {
      await result.current.rename.mutateAsync({ id: "ws1", name: "Renamed" });
    });
    expect(renameWorkspace).toHaveBeenCalledWith(WS, "Renamed", undefined);
    expect(persistWorkspaces).toHaveBeenCalledWith([renamed]);
  });

  it("rename: leaves non-matching workspaces untouched", async () => {
    const other = { ...WS, id: "ws2" };
    loadStore.mockResolvedValue({ workspaces: [WS, other] });
    renameWorkspace.mockReturnValue({ ...other, name: "R2" });
    const { result } = renderHook(() => useWorkspaces(), { wrapper: Providers });
    await waitFor(() => expect(result.current.workspaces).toHaveLength(2));

    await act(async () => {
      await result.current.rename.mutateAsync({ id: "ws2", name: "R2" });
    });
    expect(renameWorkspace).toHaveBeenCalledWith(other, "R2", undefined);
    expect(persistWorkspaces).toHaveBeenCalledWith([WS, { ...other, name: "R2" }]);
  });

  it("addToWorkspace: adds an item to the matching workspace", async () => {
    loadStore.mockResolvedValue({ workspaces: [WS] });
    const withItem = { ...WS, items: [{ id: "i1" }] };
    addItem.mockReturnValue(withItem);
    const { result } = renderHook(() => useWorkspaces(), { wrapper: Providers });
    await waitFor(() => expect(result.current.workspaces).toHaveLength(1));

    await act(async () => {
      await result.current.addToWorkspace.mutateAsync({
        id: "ws1",
        kind: "address",
        value: "0xA1077a294dDE1B09bB078844df40758a5D0f9a27",
        chainId: 369,
      });
    });
    expect(addItem).toHaveBeenCalledWith(WS, {
      kind: "address",
      value: "0xA1077a294dDE1B09bB078844df40758a5D0f9a27",
      chainId: 369,
      label: undefined,
    });
    expect(persistWorkspaces).toHaveBeenCalledWith([withItem]);
  });

  it("addToWorkspace: leaves non-matching workspaces untouched", async () => {
    const other = { ...WS, id: "ws2" };
    loadStore.mockResolvedValue({ workspaces: [WS, other] });
    const withItem = { ...other, items: [{ id: "i1" }] };
    addItem.mockReturnValue(withItem);
    const { result } = renderHook(() => useWorkspaces(), { wrapper: Providers });
    await waitFor(() => expect(result.current.workspaces).toHaveLength(2));

    await act(async () => {
      await result.current.addToWorkspace.mutateAsync({
        id: "ws2",
        kind: "address",
        value: "0xA1077a294dDE1B09bB078844df40758a5D0f9a27",
      });
    });
    expect(addItem).toHaveBeenCalledWith(other, {
      kind: "address",
      value: "0xA1077a294dDE1B09bB078844df40758a5D0f9a27",
      chainId: undefined,
      label: undefined,
    });
    // WS (non-matching) stays as-is; only ws2 is replaced.
    expect(persistWorkspaces).toHaveBeenCalledWith([WS, withItem]);
  });

  it("removeFromWorkspace: removes an item from the matching workspace", async () => {
    const withItem = { ...WS, items: [{ id: "i1" }] };
    loadStore.mockResolvedValue({ workspaces: [withItem] });
    removeItem.mockReturnValue(WS);
    const { result } = renderHook(() => useWorkspaces(), { wrapper: Providers });
    await waitFor(() => expect(result.current.workspaces).toHaveLength(1));

    await act(async () => {
      await result.current.removeFromWorkspace.mutateAsync({
        id: "ws1",
        itemId: "i1",
      });
    });
    expect(removeItem).toHaveBeenCalledWith(withItem, "i1");
    expect(persistWorkspaces).toHaveBeenCalledWith([WS]);
  });

  it("removeFromWorkspace: leaves non-matching workspaces untouched", async () => {
    const target = { ...WS, items: [{ id: "i1" }] };
    const other = { ...WS, id: "ws2" };
    loadStore.mockResolvedValue({ workspaces: [target, other] });
    removeItem.mockReturnValue(WS);
    const { result } = renderHook(() => useWorkspaces(), { wrapper: Providers });
    await waitFor(() => expect(result.current.workspaces).toHaveLength(2));

    await act(async () => {
      await result.current.removeFromWorkspace.mutateAsync({
        id: "ws1",
        itemId: "i1",
      });
    });
    expect(removeItem).toHaveBeenCalledWith(target, "i1");
    // other (non-matching) is preserved unchanged.
    expect(persistWorkspaces).toHaveBeenCalledWith([WS, other]);
  });
});
