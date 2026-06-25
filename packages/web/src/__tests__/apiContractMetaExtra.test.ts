import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * Supplementary coverage for src/api/contractMeta.ts — the branches the existing
 * contractMeta.test.ts leaves uncovered: the FATAL envelope error (status:"0"
 * with a NON-"temporarily unavailable" message → give up immediately, no retry)
 * and the malformed-ABI-string fall-through (verified record whose ABI string
 * fails JSON.parse → still cached as a definitive answer, just with no selectors).
 *
 * Uses the Etherscan-shaped getsourcecode envelope (module=contract&action=
 * getsourcecode), the same surface external tooling (hardhat-verify/foundry) hits.
 */

describe("resolveContractMeta — fatal + malformed-ABI branches", () => {
  type ResolveFn = (typeof import("../api/contractMeta"))["resolveContractMeta"];
  let resolveContractMeta: ResolveFn;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    ({ resolveContractMeta } = await import("../api/contractMeta"));
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function envelope(json: unknown): Response {
    return { ok: true, status: 200, json: async () => json } as Response;
  }

  it("gives up immediately (no retry) on a fatal envelope error string", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      envelope({ status: "0", message: "NOTOK", result: "Invalid address format" }),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const addr = "0x0000000000000000000000000000000000000bad";
    const pending = resolveContractMeta([addr]);
    await vi.runAllTimersAsync();
    const out = await pending;

    expect(out[addr]).toBeUndefined();
    // Fatal → exactly one attempt, no backoff retries.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/non-retryable error.*Invalid address format/i),
    );
  });

  it("treats a non-string envelope error as fatal (Etherscan envelope error)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      envelope({ status: "0", message: "NOTOK", result: { unexpected: true } }),
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const addr = "0x0000000000000000000000000000000000000abc";
    const pending = resolveContractMeta([addr]);
    await vi.runAllTimersAsync();
    expect((await pending)[addr]).toBeUndefined();
  });

  it("caches a verified record whose ABI string is malformed (no selectors)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      envelope({
        status: "1",
        message: "OK",
        result: [
          { SourceCode: "// x", ABI: "{not valid json", ContractName: "Broken" },
        ],
      }),
    );

    const addr = "0x0000000000000000000000000000000000000fff";
    const pending = resolveContractMeta([addr]);
    await vi.runAllTimersAsync();
    const out = await pending;

    // Definitive (verified) answer despite the unparseable ABI: name kept,
    // empty selector/event maps.
    expect(out[addr]).toEqual({ name: "Broken", selectors: {}, events: {} });

    // Cached — second resolve makes no further fetch.
    const pending2 = resolveContractMeta([addr]);
    await vi.runAllTimersAsync();
    await pending2;
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("treats a fetch throw (network error) as transient and retries", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("ECONNREFUSED"));
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const addr = "0x0000000000000000000000000000000000000111";
    const pending = resolveContractMeta([addr]);
    await vi.runAllTimersAsync();
    const out = await pending;

    expect(out[addr]).toBeUndefined();
    // RETRY_BACKOFF_MS has length 3 → 3 attempts on sustained transient.
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("treats a non-Error fetch throw as transient (network error reason)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue("socket hang up");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const addr = "0x0000000000000000000000000000000000000222";
    const pending = resolveContractMeta([addr]);
    await vi.runAllTimersAsync();
    expect((await pending)[addr]).toBeUndefined();
  });

  it("returns an empty meta (no record) when result array is empty", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      envelope({ status: "1", message: "OK", result: [] }),
    );
    const addr = "0x0000000000000000000000000000000000000eee";
    const pending = resolveContractMeta([addr]);
    await vi.runAllTimersAsync();
    expect((await pending)[addr]).toEqual({ name: null, selectors: {}, events: {} });
  });
});
