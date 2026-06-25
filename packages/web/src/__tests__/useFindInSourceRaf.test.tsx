import { describe, it, expect, vi, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useRef } from "react";
import { useFindInSource } from "../components/debugger/SoliditySourceViewer/useFindInSource";

/**
 * Supplemental: the Cmd/Ctrl+F interceptor schedules a requestAnimationFrame
 * that focuses+selects the find input. jsdom never fires rAF on its own, so
 * the existing useFindInSource.test.tsx leaves that callback uncovered — here
 * we drive rAF synchronously to exercise the select() path. The internal
 * inputRef is unattached (current === null), so the optional-chained
 * `.select()` no-ops, but the scheduled callback body still runs.
 */
function useWithRef(lines: string[]) {
  const ref = useRef<HTMLDivElement | null>(null);
  return useFindInSource(lines, ref);
}

afterEach(() => vi.restoreAllMocks());

describe("useFindInSource — Cmd+F schedules an input select via rAF", () => {
  it("runs the requestAnimationFrame callback when the bar opens", () => {
    const raf = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((cb: FrameRequestCallback) => {
        cb(0);
        return 1;
      });

    const { result } = renderHook(() => useWithRef(["contract C {}"]));
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "f", metaKey: true }));
    });

    expect(result.current.open).toBe(true);
    expect(raf).toHaveBeenCalledTimes(1);
  });
});
