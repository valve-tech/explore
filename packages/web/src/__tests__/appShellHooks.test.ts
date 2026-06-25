import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, fireEvent } from "@testing-library/react";
import { useSidebarState } from "../components/AppShell/useSidebarState";
import { useCommandPaletteShortcut } from "../components/AppShell/useCommandPaletteShortcut";

const SIDEBAR_KEY = "valvetech-shell-sidebar-collapsed";

describe("useSidebarState", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults to expanded (collapsed=false) with no stored value", () => {
    const { result } = renderHook(() => useSidebarState());
    expect(result.current.collapsed).toBe(false);
  });

  it("reads a persisted collapsed=true from localStorage on mount", () => {
    localStorage.setItem(SIDEBAR_KEY, "true");
    const { result } = renderHook(() => useSidebarState());
    expect(result.current.collapsed).toBe(true);
  });

  it("toggles and persists the collapsed flag", () => {
    const { result } = renderHook(() => useSidebarState());
    act(() => result.current.onToggleCollapse());
    expect(result.current.collapsed).toBe(true);
    expect(localStorage.getItem(SIDEBAR_KEY)).toBe("true");

    act(() => result.current.onToggleCollapse());
    expect(result.current.collapsed).toBe(false);
    expect(localStorage.getItem(SIDEBAR_KEY)).toBe("false");
  });

  it("falls back to false when localStorage.getItem throws", () => {
    const spy = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    const { result } = renderHook(() => useSidebarState());
    expect(result.current.collapsed).toBe(false);
    spy.mockRestore();
  });

  it("swallows a setItem failure when persisting", () => {
    const spy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("quota");
      });
    const { result } = renderHook(() => useSidebarState());
    // Toggle triggers the effect, whose setItem throws — must not blow up.
    expect(() => act(() => result.current.onToggleCollapse())).not.toThrow();
    spy.mockRestore();
  });
});

describe("useCommandPaletteShortcut", () => {
  it("toggles open on ⌘K (metaKey)", () => {
    const setOpen = vi.fn();
    renderHook(() => useCommandPaletteShortcut(setOpen));
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(setOpen).toHaveBeenCalledTimes(1);
    // The setter receives a toggling updater fn — verify it flips state.
    const updater = setOpen.mock.calls[0]![0] as (o: boolean) => boolean;
    expect(updater(false)).toBe(true);
    expect(updater(true)).toBe(false);
  });

  it("toggles open on Ctrl+K (ctrlKey)", () => {
    const setOpen = vi.fn();
    renderHook(() => useCommandPaletteShortcut(setOpen));
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(setOpen).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape (sets false)", () => {
    const setOpen = vi.fn();
    renderHook(() => useCommandPaletteShortcut(setOpen));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(setOpen).toHaveBeenCalledWith(false);
  });

  it("ignores a plain 'k' without a modifier", () => {
    const setOpen = vi.fn();
    renderHook(() => useCommandPaletteShortcut(setOpen));
    fireEvent.keyDown(window, { key: "k" });
    expect(setOpen).not.toHaveBeenCalled();
  });

  it("removes the keydown listener on unmount", () => {
    const setOpen = vi.fn();
    const { unmount } = renderHook(() => useCommandPaletteShortcut(setOpen));
    unmount();
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(setOpen).not.toHaveBeenCalled();
  });
});
