import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
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
    vi.spyOn(api, "fetchTransactionDecode")
      .mockResolvedValueOnce(slow as never)
      .mockResolvedValueOnce(fast as never);
    const { result, rerender } = renderHook(
      ({ h }) => useTxDecode(h, 369),
      { initialProps: { h: "0xold" } },
    );
    rerender({ h: "0xnew" });
    await waitFor(() => expect(result.current.state).toBe("ready"));
    expect(result.current.decodedInput?.functionName).toBe("new");
  });
});
