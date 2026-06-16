/**
 * Unit tests for packages/api/src/services/tracer/debugRpc.ts
 *
 * Pure surface — mocks globalThis.fetch and inspects the request
 * shape. The point is to lock down the auth-header behavior so a
 * future refactor that drops `Authorization: Bearer <token>` from
 * the request can't slip past CI: without the bearer, traces against
 * header-auth-gated debug RPCs (e.g. direct-a-evm-369-rpc.valve.city
 * in the valve fleet) 401 silently and the failure surfaces three
 * fallbacks later as a BlockScout-5xx.
 */

import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";

import { makeDebugRpc, debugRpcUrl, debugRpcBearer } from "../../src/services/tracer/debugRpc.js";
import { getChain, DEFAULT_CHAIN_ID } from "../../src/services/chains/registry.js";

interface CapturedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

const captureFetch = (response: { status: number; body: unknown }): {
  calls: CapturedRequest[];
  restore: () => void;
} => {
  const calls: CapturedRequest[] = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const rawHeaders = (init?.headers ?? {}) as Record<string, string>;
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(rawHeaders)) {
      // Normalize to lowercase keys so tests don't depend on header case.
      headers[k.toLowerCase()] = String(v);
    }
    calls.push({
      url,
      method: init?.method ?? "GET",
      headers,
      body: typeof init?.body === "string" ? init.body : "",
    });
    return new Response(JSON.stringify(response.body), {
      status: response.status,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  return {
    calls,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
};

describe("debugRpc env resolution", () => {
  const originalDebugUrl = process.env.DEBUG_RPC_URL;
  const originalPlsUrl = process.env.PULSECHAIN_RPC_URL;
  const originalBearer = process.env.DEBUG_RPC_BEARER;

  afterEach(() => {
    if (originalDebugUrl === undefined) delete process.env.DEBUG_RPC_URL;
    else process.env.DEBUG_RPC_URL = originalDebugUrl;
    if (originalPlsUrl === undefined) delete process.env.PULSECHAIN_RPC_URL;
    else process.env.PULSECHAIN_RPC_URL = originalPlsUrl;
    if (originalBearer === undefined) delete process.env.DEBUG_RPC_BEARER;
    else process.env.DEBUG_RPC_BEARER = originalBearer;
  });

  it("debugRpcUrl prefers DEBUG_RPC_URL over PULSECHAIN_RPC_URL", () => {
    process.env.DEBUG_RPC_URL = "https://example.test/debug";
    process.env.PULSECHAIN_RPC_URL = "https://example.test/pls";
    assert.equal(debugRpcUrl(), "https://example.test/debug");
  });

  it("debugRpcUrl falls back to PULSECHAIN_RPC_URL when DEBUG_RPC_URL is unset", () => {
    delete process.env.DEBUG_RPC_URL;
    process.env.PULSECHAIN_RPC_URL = "https://example.test/pls";
    assert.equal(debugRpcUrl(), "https://example.test/pls");
  });

  it("debugRpcUrl falls back to the registry's default-chain endpoint when nothing is set", () => {
    delete process.env.DEBUG_RPC_URL;
    delete process.env.PULSECHAIN_RPC_URL;
    // No env overrides → the default chain's registry rpcUrl (whatever keyed
    // valve endpoint it was configured with), never rpc.pulsechain.com.
    assert.equal(debugRpcUrl(), getChain(DEFAULT_CHAIN_ID).rpcUrl);
  });

  it("debugRpcBearer is empty by default", () => {
    delete process.env.DEBUG_RPC_BEARER;
    assert.equal(debugRpcBearer(), "");
  });

  it("debugRpcBearer reads DEBUG_RPC_BEARER from env", () => {
    process.env.DEBUG_RPC_BEARER = "0xabc";
    assert.equal(debugRpcBearer(), "0xabc");
  });

  it("debugRpcBearer treats explicit empty string as no auth (matches '||' fallback)", () => {
    process.env.DEBUG_RPC_BEARER = "";
    assert.equal(debugRpcBearer(), "");
  });
});

describe("makeDebugRpc fetch shape", () => {
  const originalDebugUrl = process.env.DEBUG_RPC_URL;
  const originalBearer = process.env.DEBUG_RPC_BEARER;
  let captured: ReturnType<typeof captureFetch> | undefined;

  beforeEach(() => {
    process.env.DEBUG_RPC_URL = "https://example.test/debug";
  });

  afterEach(() => {
    captured?.restore();
    captured = undefined;
    if (originalDebugUrl === undefined) delete process.env.DEBUG_RPC_URL;
    else process.env.DEBUG_RPC_URL = originalDebugUrl;
    if (originalBearer === undefined) delete process.env.DEBUG_RPC_BEARER;
    else process.env.DEBUG_RPC_BEARER = originalBearer;
  });

  it("sends a JSON-RPC POST to DEBUG_RPC_URL with the right body", async () => {
    delete process.env.DEBUG_RPC_BEARER;
    captured = captureFetch({ status: 200, body: { result: "0x171" } });

    const out = await makeDebugRpc("eth_chainId", []);

    assert.deepEqual(out, { result: "0x171" });
    assert.equal(captured.calls.length, 1);
    const [call] = captured.calls;
    assert.equal(call.url, "https://example.test/debug");
    assert.equal(call.method, "POST");
    assert.equal(call.headers["content-type"], "application/json");
    assert.deepEqual(JSON.parse(call.body), {
      jsonrpc: "2.0",
      id: 1,
      method: "eth_chainId",
      params: [],
    });
  });

  it("OMITS Authorization header when DEBUG_RPC_BEARER is unset", async () => {
    delete process.env.DEBUG_RPC_BEARER;
    captured = captureFetch({ status: 200, body: { result: null } });

    await makeDebugRpc("debug_traceTransaction", ["0xabc"]);

    const [call] = captured.calls;
    assert.equal(
      call.headers["authorization"],
      undefined,
      "no Authorization header should be sent when bearer is unset",
    );
  });

  it("OMITS Authorization header when DEBUG_RPC_BEARER is empty string", async () => {
    process.env.DEBUG_RPC_BEARER = "";
    captured = captureFetch({ status: 200, body: { result: null } });

    await makeDebugRpc("debug_traceTransaction", ["0xabc"]);

    const [call] = captured.calls;
    assert.equal(
      call.headers["authorization"],
      undefined,
      "empty string bearer must not emit `Authorization: Bearer `",
    );
  });

  it("SENDS Authorization: Bearer <token> when DEBUG_RPC_BEARER is set", async () => {
    process.env.DEBUG_RPC_BEARER = "0xdeadbeef";
    captured = captureFetch({ status: 200, body: { result: null } });

    await makeDebugRpc("debug_traceTransaction", ["0xabc"]);

    const [call] = captured.calls;
    assert.equal(
      call.headers["authorization"],
      "Bearer 0xdeadbeef",
      "should send `Authorization: Bearer 0xdeadbeef`",
    );
  });

  it("does NOT leak the bearer into the request body", async () => {
    process.env.DEBUG_RPC_BEARER = "0xdeadbeef";
    captured = captureFetch({ status: 200, body: { result: null } });

    await makeDebugRpc("debug_traceTransaction", ["0xabc"]);

    const [call] = captured.calls;
    assert.ok(
      !call.body.includes("0xdeadbeef"),
      "bearer must not appear in the JSON-RPC body",
    );
  });

  it("re-reads the bearer per call (changing env between calls flips the header)", async () => {
    captured = captureFetch({ status: 200, body: { result: null } });

    delete process.env.DEBUG_RPC_BEARER;
    await makeDebugRpc("eth_chainId", []);

    process.env.DEBUG_RPC_BEARER = "0xnewbearer";
    await makeDebugRpc("eth_chainId", []);

    assert.equal(captured.calls[0].headers["authorization"], undefined);
    assert.equal(captured.calls[1].headers["authorization"], "Bearer 0xnewbearer");
  });

  it("throws on non-2xx HTTP status from upstream", async () => {
    delete process.env.DEBUG_RPC_BEARER;
    captured = captureFetch({ status: 502, body: { error: "bad gateway" } });

    await assert.rejects(
      () => makeDebugRpc("debug_traceTransaction", ["0xabc"]),
      /RPC HTTP error: 502/,
    );
  });
});
