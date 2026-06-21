import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchGasOracle } from "./gas";
import { fetchPending } from "./mempool";

/**
 * Chain-coverage pass: gas / mempool API clients must append `?chainid=N` for
 * non-default chains and stay byte-identical (no param) for the default chain
 * (369) — matching explorer.ts's private `scoped` helper. (The raw JSON-RPC
 * proxy + playground endpoints were removed; raw reads are BYO-RPC only and go
 * to the user's node verbatim, so there's nothing chain-scoped to assert there.)
 */

const DEFAULT_CHAIN = 369;
const OTHER_CHAIN = 943;

function okResponse(): Response {
  return {
    ok: true,
    json: async () => ({ ok: true, result: {}, methods: [], response: {} }),
    text: async () => "",
  } as unknown as Response;
}

function lastUrl(spy: ReturnType<typeof vi.fn>): string {
  const call = spy.mock.calls.at(-1);
  return String(call?.[0]);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("gas oracle chain scoping", () => {
  it("omits chainid for the default chain", async () => {
    const spy = vi.fn(async () => okResponse());
    vi.stubGlobal("fetch", spy);
    await fetchGasOracle(DEFAULT_CHAIN);
    expect(lastUrl(spy)).toBe("/api/gas/oracle");
  });

  it("defaults to the default chain when no arg is given", async () => {
    const spy = vi.fn(async () => okResponse());
    vi.stubGlobal("fetch", spy);
    await fetchGasOracle();
    expect(lastUrl(spy)).toBe("/api/gas/oracle");
  });

  it("appends chainid for a non-default chain", async () => {
    const spy = vi.fn(async () => okResponse());
    vi.stubGlobal("fetch", spy);
    await fetchGasOracle(OTHER_CHAIN);
    expect(lastUrl(spy)).toBe(`/api/gas/oracle?chainid=${OTHER_CHAIN}`);
  });
});

describe("mempool chain scoping", () => {
  it("omits chainid for the default chain", async () => {
    const spy = vi.fn(async () => okResponse());
    vi.stubGlobal("fetch", spy);
    await fetchPending(DEFAULT_CHAIN);
    expect(lastUrl(spy)).toBe("/api/mempool/pending");
  });

  it("appends chainid for a non-default chain", async () => {
    const spy = vi.fn(async () => okResponse());
    vi.stubGlobal("fetch", spy);
    await fetchPending(OTHER_CHAIN);
    expect(lastUrl(spy)).toBe(`/api/mempool/pending?chainid=${OTHER_CHAIN}`);
  });
});
