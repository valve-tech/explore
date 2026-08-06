import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  fetchContractSourceWithRetry,
  fetchTraceSourceMap,
  SOURCE_RETRY_BACKOFF_MS,
} from "../api/source";

/**
 * The client must stop retrying when the API says retrying cannot help.
 *
 * On a chain whose only verified-source provider is down (943: Sourcify does not
 * index it, and its Blockscout backend 500s on every surface), each contract was
 * costing a full retry budget — 3 attempts with backoff — and a debugger page
 * renders ~9 contracts across two endpoints. That is the 63 failed requests seen
 * in the live console. The API now marks those responses `retryable: false`.
 *
 * The important subtlety: a 503 never reaches the JSON body in the old client —
 * `if (!res.ok) return transient` short-circuits first — so these tests pin that
 * the flag is read on the ERROR path, not just the 200-with-ok:false path.
 */

const ADDR = "0xb81513eee23fca64e86772ec0c3b541a70ae72d5";

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Run a promise to completion while auto-advancing the backoff timers. */
async function settle<T>(p: Promise<T>): Promise<T> {
  const raced = p.catch((e) => ({ __err: e }) as never);
  await vi.runAllTimersAsync();
  const out = (await raced) as T | { __err: unknown };
  if (out && typeof out === "object" && "__err" in out) {
    throw (out as { __err: unknown }).__err;
  }
  return out as T;
}

describe("fetchContractSourceWithRetry honors retryable:false", () => {
  it("makes exactly ONE request for a 503 marked non-retryable", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(503, {
        ok: false,
        error: "No verified-source provider available",
        retryable: false,
      }),
    );

    const result = await settle(fetchContractSourceWithRetry(ADDR));

    // Definitive "no source" — not a thrown transient, so the caller caches it
    // under the unverified TTL and re-checks in 15 minutes instead of spinning.
    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("still burns the full budget on a genuine transient 503", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(503, {
        ok: false,
        error: "Verification source temporarily unavailable",
        retryable: true,
      }),
    );

    await expect(settle(fetchContractSourceWithRetry(ADDR))).rejects.toThrow(
      /gave up/,
    );
    expect(fetchMock).toHaveBeenCalledTimes(SOURCE_RETRY_BACKOFF_MS.length);
  });

  it("treats a flagless 503 as retryable (back-compat with an older API)", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(503, { ok: false, error: "Something went wrong" }),
    );

    await expect(settle(fetchContractSourceWithRetry(ADDR))).rejects.toThrow(
      /gave up/,
    );
    expect(fetchMock).toHaveBeenCalledTimes(SOURCE_RETRY_BACKOFF_MS.length);
  });

  it("reads the flag on a 200 + ok:false envelope too", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        ok: false,
        error: "No verified-source provider available",
        retryable: false,
      }),
    );

    expect(await settle(fetchContractSourceWithRetry(ADDR))).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("fetchTraceSourceMap honors retryable:false", () => {
  it("makes exactly ONE request and reports unmappable", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(503, {
        ok: false,
        error: "No verified-source provider available",
        retryable: false,
      }),
    );

    const result = await settle(fetchTraceSourceMap(ADDR, [0, 2, 4]));

    // Unmappable is a real answer (empty mappings), not a null "give up".
    expect(result).not.toBeNull();
    expect(result?.mappings).toEqual({});
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("still retries a genuine transient failure", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(503, {
        ok: false,
        error: "Verification source temporarily unavailable",
        retryable: true,
      }),
    );

    await settle(fetchTraceSourceMap(ADDR, [0, 2, 4]));
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
  });
});
