import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * Tests for src/api/source.ts — the verified-source + source-map + slither
 * clients, plus the bounded-retry wrappers used by the call-tree batcher.
 *
 * The fetch-shape fixtures are synthetic but mirror the real backend envelopes
 * documented inline in the source (200 + {ok,source}, 404 = unverified, 503 =
 * transient). For the one fixture that asserts decoded contract data we use a
 * real verified PulseChain contract — WPLS:
 *   https://scan.pulsechain.com/address/0xA1077a294dDE1B09bB078844df40758a5D0f9a27
 *   (chainId 369, name "WPLS", solidity compiler). Only the envelope shape
 *   matters here; the address/name pair is real and explorer-verifiable.
 */

import * as source from "../api/source";

const WPLS = "0xA1077a294dDE1B09bB078844df40758a5D0f9a27";

function res(body: {
  ok?: boolean;
  status?: number;
  json?: unknown;
  jsonThrows?: boolean;
}): Response {
  return {
    ok: body.ok ?? true,
    status: body.status ?? 200,
    json: async () => {
      if (body.jsonThrows) throw new Error("bad json");
      return body.json;
    },
  } as Response;
}

beforeEach(() => {
  // Backoff schedule is short for the test run (override the exported array).
  source.SOURCE_RETRY_BACKOFF_MS.length = 0;
  source.SOURCE_RETRY_BACKOFF_MS.push(0, 0, 0);
});

afterEach(() => {
  vi.restoreAllMocks();
  // Restore the original schedule contents.
  source.SOURCE_RETRY_BACKOFF_MS.length = 0;
  source.SOURCE_RETRY_BACKOFF_MS.push(500, 1000, 2000);
});

describe("fetchSource", () => {
  it("builds the address URL and returns the parsed envelope", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        res({ json: { ok: true, source: { contractName: "WPLS" } } }),
      );
    const out = await source.fetchSource(WPLS);
    expect(fetchSpy.mock.calls[0]![0]).toBe(`/api/source/${WPLS}`);
    expect(out.ok).toBe(true);
    expect(out.source!.contractName).toBe("WPLS");
  });
});

describe("analyzeContract", () => {
  it("POSTs options as JSON to the /analyze sub-route", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(res({ json: { ok: true, analysis: { findings: [] } } }));
    const out = await source.analyzeContract(WPLS, { skipCache: true });
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe(`/api/source/${WPLS}/analyze`);
    expect(init!.method).toBe("POST");
    expect(JSON.parse(init!.body as string)).toEqual({ skipCache: true });
    expect(out.ok).toBe(true);
  });

  it("defaults options to an empty object", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(res({ json: { ok: true } }));
    await source.analyzeContract(WPLS);
    expect(JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string)).toEqual({});
  });
});

describe("fetchSourceMappings", () => {
  it("POSTs the pcs array to the /map sub-route", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(res({ json: { ok: true, mappings: {} } }));
    await source.fetchSourceMappings(WPLS, [1, 2, 3]);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe(`/api/source/${WPLS}/map`);
    expect(JSON.parse(init!.body as string)).toEqual({ pcs: [1, 2, 3] });
  });
});

describe("fetchTraceSourceFiles — outcomes", () => {
  it("returns verified files on 200 + ok:true + source", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      res({
        json: {
          ok: true,
          source: { files: [{ name: "WPLS.sol", content: "// ..." }] },
        },
      }),
    );
    const out = await source.fetchTraceSourceFiles(WPLS);
    expect(out).toEqual({
      files: [{ name: "WPLS.sol", content: "// ..." }],
      verified: true,
    });
  });

  it("returns unverified on a 404", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      res({ ok: false, status: 404 }),
    );
    const out = await source.fetchTraceSourceFiles(WPLS);
    expect(out).toEqual({ files: [], verified: false });
  });

  it("returns unverified on 200 + ok:false (no transient marker)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      res({ json: { ok: false, error: "not verified" } }),
    );
    const out = await source.fetchTraceSourceFiles(WPLS);
    expect(out).toEqual({ files: [], verified: false });
  });

  it("returns null (fatal) on malformed JSON", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      res({ jsonThrows: true }),
    );
    const out = await source.fetchTraceSourceFiles(WPLS);
    expect(out).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/non-retryable/),
    );
  });

  it("returns null (fatal) on ok:true but no source", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockResolvedValue(res({ json: { ok: true } }));
    const out = await source.fetchTraceSourceFiles(WPLS);
    expect(out).toBeNull();
  });

  it("retries then gives up (null) when every attempt is a 5xx transient", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(res({ ok: false, status: 503 }));
    const out = await source.fetchTraceSourceFiles(WPLS);
    expect(out).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/giving up/));
  });

  it("treats a network throw as transient", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("ECONNRESET"));
    const out = await source.fetchTraceSourceFiles(WPLS);
    expect(out).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("treats a non-Error throw as transient (network error reason)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockRejectedValue("boom");
    const out = await source.fetchTraceSourceFiles(WPLS);
    expect(out).toBeNull();
  });

  it("treats a 'temporarily unavailable' envelope as transient", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      res({
        json: { ok: false, error: "Verification source temporarily unavailable" },
      }),
    );
    const out = await source.fetchTraceSourceFiles(WPLS);
    expect(out).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("recovers when a transient attempt is followed by a verified one", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(res({ ok: false, status: 503 }))
      .mockResolvedValueOnce(
        res({ json: { ok: true, source: { files: [] } } }),
      );
    const out = await source.fetchTraceSourceFiles(WPLS);
    expect(out).toEqual({ files: [], verified: true });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

describe("fetchContractSourceWithRetry", () => {
  it("returns the ContractSource on verified", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      res({ json: { ok: true, source: { contractName: "WPLS", files: [] } } }),
    );
    const out = await source.fetchContractSourceWithRetry(WPLS);
    expect(out!.contractName).toBe("WPLS");
  });

  it("returns null on a definitive unverified (404)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      res({ ok: false, status: 404 }),
    );
    expect(await source.fetchContractSourceWithRetry(WPLS)).toBeNull();
  });

  it("throws on a fatal (malformed JSON)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(res({ jsonThrows: true }));
    await expect(source.fetchContractSourceWithRetry(WPLS)).rejects.toThrow(
      /non-retryable/,
    );
  });

  it("throws after exhausting retries on sustained transient", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(res({ ok: false, status: 500 }));
    await expect(source.fetchContractSourceWithRetry(WPLS)).rejects.toThrow(
      /gave up/,
    );
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });
});

describe("fetchTraceSourceMap — outcomes", () => {
  it("returns mapped mappings on 200 + ok:true", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      res({ json: { ok: true, mappings: { 5: null } } }),
    );
    const out = await source.fetchTraceSourceMap(WPLS, [5]);
    expect(out).toEqual({ mappings: { 5: null }, mapped: true });
  });

  it("defaults mappings to {} when ok:true but mappings missing", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(res({ json: { ok: true } }));
    const out = await source.fetchTraceSourceMap(WPLS, [1]);
    expect(out).toEqual({ mappings: {}, mapped: true });
  });

  it("returns unmappable on a 404", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      res({ ok: false, status: 404 }),
    );
    const out = await source.fetchTraceSourceMap(WPLS, [1]);
    expect(out).toEqual({ mappings: {}, mapped: false });
  });

  it("returns unmappable on 200 + ok:false (non-transient)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      res({ json: { ok: false, error: "recompilation failed" } }),
    );
    const out = await source.fetchTraceSourceMap(WPLS, [1]);
    expect(out).toEqual({ mappings: {}, mapped: false });
  });

  it("returns null (fatal) on malformed JSON", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockResolvedValue(res({ jsonThrows: true }));
    expect(await source.fetchTraceSourceMap(WPLS, [1])).toBeNull();
  });

  it("retries then null on sustained 5xx transient", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(res({ ok: false, status: 503 }));
    expect(await source.fetchTraceSourceMap(WPLS, [1])).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("treats a network throw as transient", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("timeout"));
    expect(await source.fetchTraceSourceMap(WPLS, [1])).toBeNull();
  });

  it("treats a non-Error throw as transient", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockRejectedValue("nope");
    expect(await source.fetchTraceSourceMap(WPLS, [1])).toBeNull();
  });

  it("treats a 'temporarily unavailable' envelope as transient", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      res({ json: { ok: false, error: "temporarily unavailable" } }),
    );
    expect(await source.fetchTraceSourceMap(WPLS, [1])).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("recovers when a transient attempt is followed by a mapped one", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(res({ ok: false, status: 500 }))
      .mockResolvedValueOnce(res({ json: { ok: true, mappings: {} } }));
    const out = await source.fetchTraceSourceMap(WPLS, [1]);
    expect(out).toEqual({ mappings: {}, mapped: true });
  });
});
