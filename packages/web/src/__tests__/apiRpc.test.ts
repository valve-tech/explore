import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * Tests for src/api/rpc.ts — sendRpcRequest, the BYO-RPC-only raw JSON-RPC poster.
 * It resolves the user's per-chain override via rpcEndpoint (real localStorage
 * here, no mocking) and throws when no override is set (there is no shared proxy)
 * or when the HTTP response is non-ok. fetch is stubbed.
 *
 * The override key shape is `explore:rpcUrl:<chainId>` (see lib/rpcEndpoint.ts).
 * Default chain is 369 (PulseChain).
 */

import { sendRpcRequest } from "../api/rpc";
import { setRpcOverride, clearRpcOverride } from "../lib/rpcEndpoint";

const RPC_URL = "https://rpc.example.com/v2/KEY";
const CHAIN = 369;

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});
afterEach(() => {
  clearRpcOverride(CHAIN);
  localStorage.clear();
});

describe("sendRpcRequest", () => {
  it("throws when no per-chain RPC override is configured", async () => {
    await expect(
      sendRpcRequest(
        { jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] },
        CHAIN,
      ),
    ).rejects.toThrow(/No RPC endpoint for chain 369/);
  });

  it("POSTs to the override endpoint and returns the parsed JSON-RPC response", async () => {
    setRpcOverride(CHAIN, RPC_URL);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ jsonrpc: "2.0", id: 1, result: "0x10" }),
    } as Response);

    const out = await sendRpcRequest(
      { jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] },
      CHAIN,
    );

    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe(RPC_URL);
    expect(init!.method).toBe("POST");
    expect(JSON.parse(init!.body as string)).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_blockNumber",
      params: [],
    });
    expect(out).toEqual({ jsonrpc: "2.0", id: 1, result: "0x10" });
  });

  it("forwards an AbortSignal to fetch", async () => {
    setRpcOverride(CHAIN, RPC_URL);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => [{ jsonrpc: "2.0", id: 1, result: "0x1" }],
    } as Response);
    const controller = new AbortController();

    await sendRpcRequest(
      [{ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }],
      CHAIN,
      controller.signal,
    );

    expect(fetchSpy.mock.calls[0]![1]!.signal).toBe(controller.signal);
  });

  it("throws with statusText on a non-ok HTTP response", async () => {
    setRpcOverride(CHAIN, RPC_URL);
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 502,
      statusText: "Bad Gateway",
      json: async () => ({}),
    } as Response);

    await expect(
      sendRpcRequest(
        { jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] },
        CHAIN,
      ),
    ).rejects.toThrow("RPC request failed: Bad Gateway");
  });
});
