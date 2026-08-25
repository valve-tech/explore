import { describe, it, expect, vi, afterEach } from "vitest";
import { probeArchive } from "../lib/rpcArchive";

/**
 * The probe exists because no dataset carries this fact. chainlist records a
 * provider's logging claim and nothing about pruning, so `collectRpcs` has no
 * archive option — the only way to know is to read state at block 1 and see
 * what comes back.
 *
 * The shapes below are the real ones, captured 2026-08-24 from the endpoints
 * the settings page was suggesting:
 *   -32000 "missing trie node …"        pulsechain-rpc.publicnode.com
 *   -32000 "historical state …"         1rpc.io, rpc.pulsechainrpc.com
 *   -32601 "Historical state query blocked on free tier…"  rpc.hairylabs.io
 *   HTTP 403 / 401                      publicnode, nodeflare, getblock
 */
const URL = "https://node.example/rpc";

function mockFetch(impl: () => Promise<unknown> | never) {
  vi.stubGlobal("fetch", vi.fn(impl));
}

/** A JSON-RPC response with the given body, over HTTP 200. */
function jsonRpc(body: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
}

afterEach(() => vi.unstubAllGlobals());

describe("probeArchive", () => {
  it("calls the state read at block 1, not eth_blockNumber", async () => {
    const fetchMock = vi.fn((_url: string, init: RequestInit) => {
      void init;
      return jsonRpc({ result: "0x0" });
    });
    vi.stubGlobal("fetch", fetchMock);
    await probeArchive(URL);

    const init = fetchMock.mock.calls[0]![1];
    const body = JSON.parse(init.body as string) as {
      method: string;
      params: string[];
    };
    // A liveness check would pass on a pruned node. That is exactly the gap
    // `probeEndpoints` leaves, and the reason this module exists.
    expect(body.method).toBe("eth_getBalance");
    expect(body.params[1]).toBe("0x1");
  });

  it("reads a zero balance as proof of history, not as absence", async () => {
    // Block 1's zero-address balance IS 0x0 on every chain we serve. Treating
    // a falsy result as failure would fail every archive node there is.
    mockFetch(() => jsonRpc({ result: "0x0" }));
    expect(await probeArchive(URL)).toEqual({
      verdict: "archive",
      detail: "read state at block 1",
    });
  });

  it("reads a pruned node's trie-node error as recent-only", async () => {
    mockFetch(() =>
      jsonRpc({ error: { code: -32000, message: "missing trie node d67e4d45" } }),
    );
    const probe = await probeArchive(URL);
    expect(probe.verdict).toBe("recent-only");
    expect(probe.detail).toBe("missing trie node d67e4d45");
  });

  it("reads a free-tier block as recent-only, whatever code it uses", async () => {
    // hairylabs answers -32601 (method not found) for a method it plainly
    // has. Classifying on the code alone would have called this archive.
    mockFetch(() =>
      jsonRpc({ error: { code: -32601, message: "Historical state query blocked" } }),
    );
    expect((await probeArchive(URL)).verdict).toBe("recent-only");
  });

  it("separates rate limiting from missing history", async () => {
    // A throttled archive node is not a pruned node. Striking it off the list
    // for being busy would be wrong, and would stick until the page reloads.
    mockFetch(() => jsonRpc({ error: { code: -32005, message: "limit exceeded" } }));
    expect(await probeArchive(URL)).toEqual({
      verdict: "unreachable",
      detail: "rate limited",
    });
  });

  it("truncates a provider's error text so a chip stays a chip", async () => {
    mockFetch(() => jsonRpc({ error: { code: -32000, message: "x".repeat(200) } }));
    const { detail } = await probeArchive(URL);
    expect(detail).toHaveLength(64);
    expect(detail.endsWith("…")).toBe(true);
  });

  it("reports an HTTP refusal by its status", async () => {
    mockFetch(() => Promise.resolve({ ok: false, status: 403, json: () => Promise.resolve({}) }));
    expect(await probeArchive(URL)).toEqual({
      verdict: "unreachable",
      detail: "HTTP 403",
    });
  });

  it("reports a CORS refusal as blocked, since a browser cannot see why", async () => {
    mockFetch(() => Promise.reject(new TypeError("Failed to fetch")));
    expect(await probeArchive(URL)).toEqual({
      verdict: "unreachable",
      detail: "blocked or offline",
    });
  });

  it("names a timeout separately, because it is worth retrying", async () => {
    const err = new Error("timed out");
    err.name = "TimeoutError";
    mockFetch(() => Promise.reject(err));
    expect((await probeArchive(URL)).detail).toBe("timed out");
  });

  it("treats a non-JSON body as unreachable rather than throwing", async () => {
    mockFetch(() =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.reject(new Error("bad")) }),
    );
    expect((await probeArchive(URL)).verdict).toBe("unreachable");
  });
});
