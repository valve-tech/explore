import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useTxDecode } from "../useTxDecode";
import * as api from "../../api/explorer";

describe("useTxDecode", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("starts pending, then ready with decode", async () => {
    vi.spyOn(api, "fetchTransactionDecode").mockResolvedValue({
      decodedInput: { functionName: "swap", args: [] },
      decodedLogs: [],
    });
    const { result } = renderHook(() => useTxDecode("0xabc", 369));
    expect(result.current.state).toBe("pending");
    await waitFor(() => expect(result.current.state).toBe("ready"));
    expect(result.current.decodedInput?.functionName).toBe("swap");
  });

  it("reports unavailable when the decode fetch rejects", async () => {
    vi.spyOn(api, "fetchTransactionDecode").mockRejectedValue(new Error("504"));
    const { result } = renderHook(() => useTxDecode("0xabc", 369));
    await waitFor(() => expect(result.current.state).toBe("unavailable"));
    expect(result.current.decodedInput).toBeNull();
    expect(result.current.decodedLogs).toEqual([]);
  });

  it("does not fetch when disabled (BYO mode)", async () => {
    const spy = vi.spyOn(api, "fetchTransactionDecode").mockResolvedValue({
      decodedInput: null,
      decodedLogs: [],
    });
    const { result } = renderHook(() => useTxDecode("0xabc", 369, false));
    expect(result.current.state).toBe("ready");
    expect(spy).not.toHaveBeenCalled();
  });

  it("ignores a stale response after the hash changes", async () => {
    const slow = { decodedInput: { functionName: "old", args: [] }, decodedLogs: [] };
    const fast = { decodedInput: { functionName: "new", args: [] }, decodedLogs: [] };
    // Resolve the OLD (first) call only AFTER the new one has resolved, so the
    // stale response lands last. Without the hook's cancelled-flag guard, that
    // late arrival would clobber the new result — this ordering is the only one
    // that exercises the guard.
    let resolveOld!: (v: typeof slow) => void;
    vi.spyOn(api, "fetchTransactionDecode")
      .mockImplementationOnce(() => new Promise((r) => { resolveOld = r; }))
      .mockResolvedValueOnce(fast as never);

    const { result, rerender } = renderHook(
      ({ h }) => useTxDecode(h, 369),
      { initialProps: { h: "0xold" } },
    );
    rerender({ h: "0xnew" });

    // New hash resolves first…
    await waitFor(() => expect(result.current.decodedInput?.functionName).toBe("new"));
    // …then the stale old-hash promise resolves late and must be ignored. Wrap
    // in act() (not a bare microtask tick) so any resulting state update is
    // actually flushed before we assert — otherwise a scheduled-but-unflushed
    // update would let this assertion pass even without the cancelled guard.
    await act(async () => {
      resolveOld(slow);
      await Promise.resolve();
    });
    expect(result.current.decodedInput?.functionName).toBe("new");
  });
});
