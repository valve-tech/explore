import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Tests for src/api/debugger.ts — the trace/opcode/gas-profile/simulated-trace
 * clients. These build chain-scoped URLs (?chainid=N for non-default chains,
 * bare for the default 369) and unwrap the `{ok, ...}` envelope, with a shared
 * error-parsing path that recovers `error` + `debugAvailable` from a JSON 4xx/5xx
 * body or falls back to raw text.
 *
 * Fixtures are synthetic-but-realistic: a tx hash + minimal RawCallFrame shape.
 * The default chain is 369 (PulseChain); 1 = Ethereum is used to assert scoping.
 */

import {
  fetchTrace,
  fetchOpcodes,
  fetchOpcodeDetail,
  fetchGasProfile,
  fetchSimulatedTrace,
} from "../api/debugger";

const HASH =
  "0xd515ef07d4308c389b05fe13c55ac1ebe3270bd8bbf4470b0a134a1766fe3c81";

function okRes(json: unknown): Response {
  return { ok: true, status: 200, json: async () => json } as Response;
}
function errRes(text: string, status = 500): Response {
  return { ok: false, status, text: async () => text } as Response;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("fetchTrace", () => {
  it("builds the bare URL for the default chain and returns the envelope", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(okRes({ ok: true, trace: { type: "CALL" } }));
    const out = await fetchTrace(HASH);
    expect(fetchSpy.mock.calls[0]![0]).toBe(`/api/debug/tx/${HASH}/trace`);
    expect(out.ok).toBe(true);
  });

  it("appends ?chainid for a non-default chain", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(okRes({ ok: true }));
    await fetchTrace(HASH, 1);
    expect(fetchSpy.mock.calls[0]![0]).toBe(
      `/api/debug/tx/${HASH}/trace?chainid=1`,
    );
  });

  it("extracts the error string from a JSON error body", async () => {
    // parseError unwraps `{error}` to the bare string; the re-parse of that
    // string isn't JSON, so debugAvailable stays undefined (real behavior).
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      errRes(JSON.stringify({ error: "no debug node", debugAvailable: false })),
    );
    const out = await fetchTrace(HASH);
    expect(out).toEqual({
      ok: false,
      error: "no debug node",
      debugAvailable: undefined,
    });
  });

  it("recovers debugAvailable when the body has no `error` field", async () => {
    // No top-level `error` → parseError returns the full JSON text, which the
    // caller re-parses, surfacing body.error + body.debugAvailable.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      errRes(JSON.stringify({ debugAvailable: false })),
    );
    const out = await fetchTrace(HASH);
    expect(out.debugAvailable).toBe(false);
    // body.error is undefined → falls back to the (full-JSON) error text.
    expect(out.error).toContain("debugAvailable");
  });

  it("falls back to raw text when the error body is not JSON", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(errRes("plain failure"));
    const out = await fetchTrace(HASH);
    expect(out).toEqual({
      ok: false,
      error: "plain failure",
      debugAvailable: undefined,
    });
  });

  it("handles an error body that parses to a non-object (JSON number)", async () => {
    // parseError → "42"; the caller re-parses to 42, a non-object, so the
    // `typeof body === "object"` guards take their false branch.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(errRes("42"));
    const out = await fetchTrace(HASH);
    expect(out).toEqual({ ok: false, error: "42", debugAvailable: undefined });
  });
});

describe("fetchOpcodes", () => {
  it("threads the limit into the query string", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(okRes({ ok: true, steps: [] }));
    await fetchOpcodes(HASH, 500);
    expect(fetchSpy.mock.calls[0]![0]).toBe(
      `/api/debug/tx/${HASH}/opcodes?limit=500`,
    );
  });

  it("uses the default limit and scopes chainid (combining ? and &)", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(okRes({ ok: true }));
    await fetchOpcodes(HASH, 10000, 1);
    expect(fetchSpy.mock.calls[0]![0]).toBe(
      `/api/debug/tx/${HASH}/opcodes?limit=10000&chainid=1`,
    );
  });

  it("unwraps the error string from a JSON error body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      errRes(JSON.stringify({ error: "boom", debugAvailable: true })),
    );
    const out = await fetchOpcodes(HASH);
    expect(out.error).toBe("boom");
    expect(out.debugAvailable).toBeUndefined();
  });

  it("recovers debugAvailable when the body has no `error` field", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      errRes(JSON.stringify({ debugAvailable: true })),
    );
    const out = await fetchOpcodes(HASH);
    expect(out.debugAvailable).toBe(true);
  });

  it("falls back to raw text on a non-JSON error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(errRes("oops"));
    const out = await fetchOpcodes(HASH);
    expect(out.error).toBe("oops");
  });

  it("handles an error body that parses to a non-object", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(errRes("7"));
    const out = await fetchOpcodes(HASH);
    expect(out).toEqual({ ok: false, error: "7", debugAvailable: undefined });
  });
});

describe("fetchOpcodeDetail", () => {
  it("builds the from/to window URL and returns the envelope", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(okRes({ ok: true, detail: {} }));
    const out = await fetchOpcodeDetail(HASH, 0, 64);
    expect(fetchSpy.mock.calls[0]![0]).toBe(
      `/api/debug/tx/${HASH}/opcodes/detail?from=0&to=64`,
    );
    expect(out.ok).toBe(true);
  });

  it("returns {ok:false, error} (raw text) on a non-ok response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(errRes("range error"));
    const out = await fetchOpcodeDetail(HASH, 0, 1, 1);
    expect(out).toEqual({ ok: false, error: "range error" });
  });

  it("parses an error string out of a JSON error body via parseError", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      errRes(JSON.stringify({ error: "bad window" })),
    );
    const out = await fetchOpcodeDetail(HASH, 0, 1);
    expect(out.error).toBe("bad window");
  });
});

describe("fetchGasProfile", () => {
  it("builds the gas-profile URL and returns the envelope", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(okRes({ ok: true, gasProfile: { totalGas: 21000 } }));
    const out = await fetchGasProfile(HASH);
    expect(fetchSpy.mock.calls[0]![0]).toBe(
      `/api/debug/tx/${HASH}/gas-profile`,
    );
    expect(out.gasProfile!.totalGas).toBe(21000);
  });

  it("unwraps the error string from a JSON error body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      errRes(JSON.stringify({ error: "no trace", debugAvailable: false })),
    );
    const out = await fetchGasProfile(HASH, 1);
    expect(out.error).toBe("no trace");
    expect(out.debugAvailable).toBeUndefined();
  });

  it("recovers debugAvailable when the body has no `error` field", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      errRes(JSON.stringify({ debugAvailable: false })),
    );
    const out = await fetchGasProfile(HASH);
    expect(out.debugAvailable).toBe(false);
  });

  it("falls back to raw text on a non-JSON error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(errRes("502 bad gateway"));
    const out = await fetchGasProfile(HASH);
    expect(out.error).toBe("502 bad gateway");
  });

  it("handles an error body that parses to a non-object", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(errRes("9"));
    const out = await fetchGasProfile(HASH);
    expect(out).toEqual({ ok: false, error: "9", debugAvailable: undefined });
  });
});

describe("fetchSimulatedTrace", () => {
  it("POSTs the params and returns the envelope", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(okRes({ ok: true, trace: { type: "CALL" } }));
    const params = { from: "0xfrom", to: "0xto", value: "0x0", data: "0x" };
    const out = await fetchSimulatedTrace(params);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("/api/debug/trace");
    expect(init!.method).toBe("POST");
    expect(JSON.parse(init!.body as string)).toEqual(params);
    expect(out.ok).toBe(true);
  });

  it("unwraps the error string from a JSON error body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      errRes(JSON.stringify({ error: "revert", debugAvailable: true })),
    );
    const out = await fetchSimulatedTrace({ to: "0xto" });
    expect(out.error).toBe("revert");
    expect(out.debugAvailable).toBeUndefined();
  });

  it("recovers debugAvailable when the body has no `error` field", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      errRes(JSON.stringify({ debugAvailable: true })),
    );
    const out = await fetchSimulatedTrace({ to: "0xto" });
    expect(out.debugAvailable).toBe(true);
  });

  it("falls back to raw text on a non-JSON error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(errRes("nope"));
    const out = await fetchSimulatedTrace({ to: "0xto" });
    expect(out.error).toBe("nope");
  });

  it("handles an error body that parses to a non-object", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(errRes("3"));
    const out = await fetchSimulatedTrace({ to: "0xto" });
    expect(out).toEqual({ ok: false, error: "3", debugAvailable: undefined });
  });
});
