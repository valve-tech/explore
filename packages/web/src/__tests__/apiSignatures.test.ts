import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * Tests for src/api/signatures.ts — selector → text-signature lookup (single +
 * batch) and the bounded-retry batch wrapper that distinguishes transient
 * (5xx/network) from fatal (400/malformed) outcomes.
 *
 * Real-world fixture: the ERC-20 `transfer(address,uint256)` selector
 * `0xa9059cbb` and `decimals()` selector `0x313ce567` are canonical 4byte
 * entries. Verify a selector at https://www.4byte.directory/signatures/?bytes4_signature=0xa9059cbb
 */

import {
  lookupSignature,
  batchLookupSignatures,
  fetchSignaturesBatch,
} from "../api/signatures";

const TRANSFER_SEL = "0xa9059cbb";
const TRANSFER_SIG = "transfer(address,uint256)";

function okRes(json: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => json } as Response;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.restoreAllMocks();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("lookupSignature", () => {
  it("builds the selector URL and returns matches", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      okRes({
        ok: true,
        matches: [
          { selector: TRANSFER_SEL, textSignature: TRANSFER_SIG, sigType: "function" },
        ],
      }),
    );
    const out = await lookupSignature(TRANSFER_SEL);
    expect(fetchSpy.mock.calls[0]![0]).toBe(`/api/signatures/${TRANSFER_SEL}`);
    expect(out[0]!.textSignature).toBe(TRANSFER_SIG);
  });

  it("returns [] when the envelope has no matches", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(okRes({ ok: true }));
    expect(await lookupSignature(TRANSFER_SEL)).toEqual([]);
  });
});

describe("batchLookupSignatures", () => {
  it("POSTs the selectors and returns the results map", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      okRes({ ok: true, results: { [TRANSFER_SEL]: [] } }),
    );
    const out = await batchLookupSignatures([TRANSFER_SEL]);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("/api/signatures/batch");
    expect(JSON.parse(init!.body as string)).toEqual({ selectors: [TRANSFER_SEL] });
    expect(out).toEqual({ [TRANSFER_SEL]: [] });
  });

  it("returns {} when results is absent", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(okRes({ ok: true }));
    expect(await batchLookupSignatures([])).toEqual({});
  });
});

describe("fetchSignaturesBatch — outcomes", () => {
  it("returns results on a definitive ok response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      okRes({ ok: true, results: { [TRANSFER_SEL]: [] } }),
    );
    const out = await fetchSignaturesBatch([TRANSFER_SEL]);
    expect(out).toEqual({ results: { [TRANSFER_SEL]: [] } });
  });

  it("defaults results to {} when ok:true but results missing", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(okRes({ ok: true }));
    const out = await fetchSignaturesBatch([TRANSFER_SEL]);
    expect(out).toEqual({ results: {} });
  });

  it("returns null (fatal) on a 400", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockResolvedValue(okRes(null, 400));
    expect(await fetchSignaturesBatch([])).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/non-retryable/));
  });

  it("returns null (fatal) on malformed JSON", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("bad");
      },
    } as unknown as Response);
    expect(await fetchSignaturesBatch([])).toBeNull();
  });

  it("retries then null on sustained 5xx", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(okRes(null, 503));
    const pending = fetchSignaturesBatch([TRANSFER_SEL]);
    await vi.runAllTimersAsync();
    expect(await pending).toBeNull();
    // SIG_RETRY_BACKOFF_MS has length 2 → 3 attempts total.
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("treats a non-5xx, non-400 error status as transient", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(okRes(null, 429));
    const pending = fetchSignaturesBatch([TRANSFER_SEL]);
    await vi.runAllTimersAsync();
    expect(await pending).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("treats a network throw as transient", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("ENOTFOUND"));
    const pending = fetchSignaturesBatch([TRANSFER_SEL]);
    await vi.runAllTimersAsync();
    expect(await pending).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("treats a non-Error throw as transient", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockRejectedValue("nope");
    const pending = fetchSignaturesBatch([TRANSFER_SEL]);
    await vi.runAllTimersAsync();
    expect(await pending).toBeNull();
  });

  it("treats ok:false as transient", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(okRes({ ok: false, error: "cache down" }));
    const pending = fetchSignaturesBatch([TRANSFER_SEL]);
    await vi.runAllTimersAsync();
    expect(await pending).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("treats ok:false with no error string as transient", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockResolvedValue(okRes({ ok: false }));
    const pending = fetchSignaturesBatch([TRANSFER_SEL]);
    await vi.runAllTimersAsync();
    expect(await pending).toBeNull();
  });

  it("recovers when a transient attempt is followed by an ok one", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(okRes(null, 500))
      .mockResolvedValueOnce(okRes({ ok: true, results: {} }));
    const pending = fetchSignaturesBatch([TRANSFER_SEL]);
    await vi.runAllTimersAsync();
    expect(await pending).toEqual({ results: {} });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
