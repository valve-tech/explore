import { describe, it, expect } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderHook, act } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { useMobileNav } from "../useMobileNav";

// Plain `.ts` (not `.tsx`) — esbuild's default loader for `.ts` doesn't parse
// JSX, so the wrapper is built with `createElement` instead.
function wrapper({ children }: { children: ReactNode }) {
  return createElement(MemoryRouter, { initialEntries: ["/a"] }, children);
}

describe("useMobileNav", () => {
  it("starts closed and opens/closes", () => {
    const { result } = renderHook(() => useMobileNav(), { wrapper });
    expect(result.current.drawerOpen).toBe(false);
    act(() => result.current.openDrawer());
    expect(result.current.drawerOpen).toBe(true);
    act(() => result.current.closeDrawer());
    expect(result.current.drawerOpen).toBe(false);
  });

  it("closes automatically when the route changes", () => {
    const { result } = renderHook(
      () => {
        const nav = useMobileNav();
        const navigate = useNavigate();
        return { nav, navigate };
      },
      { wrapper },
    );
    act(() => result.current.nav.openDrawer());
    expect(result.current.nav.drawerOpen).toBe(true);
    act(() => result.current.navigate("/b"));
    expect(result.current.nav.drawerOpen).toBe(false);
  });

  it("locks body scroll while open and restores it on close", () => {
    const { result } = renderHook(() => useMobileNav(), { wrapper });
    expect(document.body.style.overflow).toBe("");
    act(() => result.current.openDrawer());
    expect(document.body.style.overflow).toBe("hidden");
    act(() => result.current.closeDrawer());
    expect(document.body.style.overflow).toBe("");
  });
});
