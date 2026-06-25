import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

/**
 * useRecentDebuggerTxs / useRecentEntities / useTrackedTxs — thin
 * useSyncExternalStore views over their localStorage-backed stores. We drive
 * the real store mutators and assert the hook re-renders with the new snapshot.
 *
 * Pure-UI stores, so realistic fixtures (a tx hash, an address) suffice — no
 * on-chain assertions needed.
 */

import { useRecentDebuggerTxs } from "../hooks/useRecentDebuggerTxs";
import {
  recordDebuggerTx,
  removeDebuggerTx,
  clearDebuggerTxs,
} from "../lib/recentDebuggerTxs";
import { useRecentEntities } from "../hooks/useRecentEntities";
import {
  recordVisit,
  removeEntity,
  togglePin,
  clearRecent,
} from "../lib/recentEntities";
import { useTrackedTxs } from "../hooks/useTrackedTxs";
import { trackTx, untrackTx, clearResolved } from "../lib/trackedTxs";

const HASH = "0xabc0000000000000000000000000000000000000000000000000000000000001";

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  localStorage.clear();
});

describe("useRecentDebuggerTxs", () => {
  it("reflects recorded txs and updates on mutation", () => {
    clearDebuggerTxs();
    const { result } = renderHook(() => useRecentDebuggerTxs());
    expect(result.current).toEqual([]);

    act(() => recordDebuggerTx(HASH));
    expect(result.current).toHaveLength(1);
    expect(result.current[0]!.hash).toBe(HASH);

    act(() => removeDebuggerTx(HASH));
    expect(result.current).toEqual([]);
  });
});

describe("useRecentEntities", () => {
  it("reflects visits, pins, and removals", () => {
    clearRecent();
    // start clean: clearRecent keeps pins, so remove any leftover too
    act(() => removeEntity("address", HASH));
    const { result } = renderHook(() => useRecentEntities());

    act(() => recordVisit({ kind: "address", value: HASH, label: "Test" }));
    expect(result.current.some((e) => e.value === HASH.toLowerCase())).toBe(true);

    act(() => togglePin("address", HASH.toLowerCase()));
    expect(result.current.find((e) => e.value === HASH.toLowerCase())?.pinned).toBe(
      true,
    );

    act(() => removeEntity("address", HASH.toLowerCase()));
    expect(result.current.some((e) => e.value === HASH.toLowerCase())).toBe(false);
  });
});

describe("useTrackedTxs", () => {
  it("reflects tracked txs and updates on mutation", () => {
    clearResolved();
    act(() => untrackTx(HASH));
    const { result } = renderHook(() => useTrackedTxs());

    act(() => trackTx(HASH));
    expect(result.current.some((t) => t.hash === HASH)).toBe(true);

    act(() => untrackTx(HASH));
    expect(result.current.some((t) => t.hash === HASH)).toBe(false);
  });
});
