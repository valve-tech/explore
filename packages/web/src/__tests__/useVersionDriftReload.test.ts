import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useVersionDriftReload, RELOAD_DELAY_MS } from "../hooks/useVersionDriftReload";

// BUILD_INFO.sha is a vite `define`d compile-time constant (see
// packages/web/src/lib/buildInfo.ts) — vitest replaces __BUILD_INFO__ the same
// way vite does, so this baked sha is whatever vite.config.ts stamps in test
// mode (the real HEAD sha via resolveBuildInfo()). We only need "the currently
// baked sha" and "some other, definitely-different sha" to drive hasDrifted,
// so read the baked value back off the module rather than guessing at it.
import { BUILD_INFO } from "../lib/buildInfo";

const BAKED = BUILD_INFO.sha;
const DEPLOYED = `not-${BAKED}-deployed`;

describe("useVersionDriftReload", () => {
  let reloadSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    reloadSpy = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, reload: reloadSpy },
    });
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  it("never reloads when there is no drift, even well past the delay", () => {
    const { rerender } = renderHook(
      ({ busy }) => useVersionDriftReload(BAKED, busy),
      { initialProps: { busy: false } },
    );
    for (let i = 0; i < 5; i++) {
      act(() => rerender({ busy: i % 2 === 0 }));
      act(() => vi.advanceTimersByTime(RELOAD_DELAY_MS));
    }
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  it("reloads after the delay once drifted and idle, not before", () => {
    renderHook(() => useVersionDriftReload(DEPLOYED, false));

    act(() => vi.advanceTimersByTime(RELOAD_DELAY_MS - 1));
    expect(reloadSpy).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it("regression: still reloads when busy flaps true/false faster than the delay", () => {
    // Mirrors Landing's two 5s pollers: busy toggles on a cadence AT OR BELOW
    // the reload delay, so a naive effect keyed on `busy` never gets an
    // uninterrupted window to complete its timer. Flip every 2s (< the 5s
    // delay) for 16s total — long enough that the delay must have elapsed at
    // least once, but never with 5s of uninterrupted quiet under the old
    // [servedSha, busy]-dep shape, since every flip (busy or !busy) tore that
    // timer down and rescheduled it. Keying on `drifted` alone must survive
    // this and reload anyway.
    //
    // In production, window.location.reload() unloads the page, so the effect
    // never runs a second time. jsdom can't unload, so once the latch is armed
    // a later idle instant can re-invoke the (stubbed) reload — that's a test
    // artifact of not actually navigating away, not a behavior bug. What
    // matters, and what the old implementation gets wrong, is that reload
    // fires AT ALL despite the continuous flapping.
    const flipMs = 2_000;
    expect(flipMs).toBeLessThan(RELOAD_DELAY_MS);

    const { rerender } = renderHook(
      ({ busy }) => useVersionDriftReload(DEPLOYED, busy),
      { initialProps: { busy: false } },
    );

    let busy = false;
    for (let i = 0; i < 8; i++) {
      busy = !busy;
      act(() => rerender({ busy }));
      act(() => vi.advanceTimersByTime(flipMs));
    }

    expect(reloadSpy).toHaveBeenCalled();
  });

  it("does not reload while continuously busy — the guard still protects in-flight work", () => {
    renderHook(() => useVersionDriftReload(DEPLOYED, true));

    act(() => vi.advanceTimersByTime(RELOAD_DELAY_MS * 3));
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  it("does not reload if drift clears before the delay elapses", () => {
    const { rerender } = renderHook(
      ({ served }) => useVersionDriftReload(served, false),
      { initialProps: { served: DEPLOYED as string | null } },
    );

    act(() => vi.advanceTimersByTime(RELOAD_DELAY_MS / 2));
    act(() => rerender({ served: BAKED }));
    act(() => vi.advanceTimersByTime(RELOAD_DELAY_MS * 3));

    expect(reloadSpy).not.toHaveBeenCalled();
  });

  it("loop guard: reloads at most once for a given served sha, even across a simulated post-reload remount", () => {
    // First mount: drift persists across many polls/rerenders — the delay
    // elapses, the tab reloads exactly once.
    const first = renderHook(
      ({ busy }) => useVersionDriftReload(DEPLOYED, busy),
      { initialProps: { busy: false } },
    );
    for (let i = 0; i < 10; i++) {
      act(() => first.rerender({ busy: false }));
      act(() => vi.advanceTimersByTime(RELOAD_DELAY_MS));
    }
    expect(reloadSpy).toHaveBeenCalledTimes(1);

    // In production window.location.reload() unloads the page and a fresh
    // page load re-runs the whole app from scratch — simulate that by
    // unmounting and mounting a brand new hook instance with the SAME served
    // sha and the SAME (still-stale) baked sha, exactly as would happen if
    // the reload loaded the identical stale bundle again.
    first.unmount();
    const second = renderHook(() => useVersionDriftReload(DEPLOYED, false));
    act(() => vi.advanceTimersByTime(RELOAD_DELAY_MS * 3));
    second.unmount();

    // Still just the one reload — the sessionStorage guard remembers this sha.
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it("loop guard does not disable the feature: a genuinely newer deploy reloads again", () => {
    const first = renderHook(() => useVersionDriftReload(DEPLOYED, false));
    act(() => vi.advanceTimersByTime(RELOAD_DELAY_MS));
    expect(reloadSpy).toHaveBeenCalledTimes(1);
    first.unmount();

    const NEXT_DEPLOYED = `${DEPLOYED}-next`;
    const second = renderHook(() => useVersionDriftReload(NEXT_DEPLOYED, false));
    act(() => vi.advanceTimersByTime(RELOAD_DELAY_MS));
    second.unmount();

    expect(reloadSpy).toHaveBeenCalledTimes(2);
  });

  it("a throwing sessionStorage does not crash and does not reload", () => {
    const proto = Object.getPrototypeOf(window.sessionStorage) as Storage;
    const getSpy = vi.spyOn(proto, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    const setSpy = vi.spyOn(proto, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });

    expect(() => {
      renderHook(() => useVersionDriftReload(DEPLOYED, false));
      act(() => vi.advanceTimersByTime(RELOAD_DELAY_MS * 3));
    }).not.toThrow();

    expect(reloadSpy).not.toHaveBeenCalled();

    getSpy.mockRestore();
    setSpy.mockRestore();
  });
});
