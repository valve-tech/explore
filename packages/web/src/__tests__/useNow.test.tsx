import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

/**
 * useNowSeconds — shared once-per-second clock over useSyncExternalStore. We
 * fake timers, advance the clock, and assert the snapshot ticks in whole
 * seconds and that the shared interval is torn down when the last subscriber
 * unmounts. Pure UI clock — no chain data.
 */

import { useNowSeconds } from "../hooks/useNow";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-25T00:00:00.000Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

describe("useNowSeconds", () => {
  it("ticks once per second and tears the timer down on unmount", () => {
    const { result, unmount } = renderHook(() => useNowSeconds());

    // The module snapshot is seeded at import time (real clock); the first tick
    // under fake time re-reads Date.now() and snaps to our faked clock.
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    const after1 = result.current;

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(result.current).toBe(after1 + 2);

    // Last subscriber gone → interval cleared.
    const clearSpy = vi.spyOn(globalThis, "clearInterval");
    unmount();
    expect(clearSpy).toHaveBeenCalled();
  });

  it("shares one timer across multiple subscribers", () => {
    const setSpy = vi.spyOn(globalThis, "setInterval");
    const a = renderHook(() => useNowSeconds());
    const b = renderHook(() => useNowSeconds());
    // Only the first subscriber starts the interval.
    expect(setSpy).toHaveBeenCalledTimes(1);
    a.unmount();
    b.unmount();
  });
});
