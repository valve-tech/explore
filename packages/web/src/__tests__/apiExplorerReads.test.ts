import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * Tests for the simpler GET-based clients in src/api/explorer.ts not already
 * covered by fetchAddressInfo/fetchBlock/fetchTransaction tests:
 * fetchAddressTransactions, fetchAddressTokens, fetchTokenMeta,
 * fetchTokenTransfers, fetchContractInfo — plus the shared `apiFetch` error
 * branches (non-ok JSON error, non-ok raw text, ok:false envelope).
 *
 * Real-world fixture: WPLS token meta —
 *   address 0xA1077a294dDE1B09bB078844df40758a5D0f9a27, decimals 18, symbol WPLS.
 *   Verify: https://scan.pulsechain.com/address/0xA1077a294dDE1B09bB078844df40758a5D0f9a27
 */

import {
  fetchAddressTransactions,
  fetchAddressTokens,
  fetchTokenMeta,
  fetchTokenTransfers,
  fetchContractInfo,
  fetchTransaction,
  fetchBlock,
} from "../api/explorer";
import { setRpcOverride, clearRpcOverride } from "../lib/rpcEndpoint";
import { DEFAULT_CHAIN_ID } from "../lib/chains";

const WPLS = "0xA1077a294dDE1B09bB078844df40758a5D0f9a27";

function okRes(json: unknown): Response {
  return { ok: true, status: 200, json: async () => json } as Response;
}
function errRes(text: string, status = 500): Response {
  return { ok: false, status, text: async () => text } as Response;
}

beforeEach(() => {
  // No RPC override in localStorage → isRpcOverridden is false, so reads take
  // the dispatcher (non-BYO) path.
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("fetchAddressTransactions", () => {
  it("builds the paginated URL and unwraps result", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      okRes({ ok: true, result: { transactions: [], total: 0 } }),
    );
    const out = await fetchAddressTransactions("0xabc", 2, 50);
    expect(fetchSpy.mock.calls[0]![0]).toBe(
      "/api/address/0xabc/txs?page=2&limit=50",
    );
    expect(out.total).toBe(0);
  });

  it("uses default page/limit and scopes chainid", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      okRes({ ok: true, result: { transactions: [], total: 0 } }),
    );
    await fetchAddressTransactions("0xabc", 1, 25, 1);
    expect(fetchSpy.mock.calls[0]![0]).toBe(
      "/api/address/0xabc/txs?page=1&limit=25&chainid=1",
    );
  });
});

describe("fetchAddressTokens", () => {
  it("returns the token list", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(okRes({ ok: true, result: [{ symbol: "WPLS" }] }));
    const out = await fetchAddressTokens("0xabc");
    expect(fetchSpy.mock.calls[0]![0]).toBe("/api/address/0xabc/tokens");
    expect(out[0]!.symbol).toBe("WPLS");
  });
});

describe("fetchTokenMeta", () => {
  it("returns the WPLS metadata", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      okRes({
        ok: true,
        result: { address: WPLS, decimals: 18, symbol: "WPLS", name: "Wrapped Pulse" },
      }),
    );
    const out = await fetchTokenMeta(WPLS);
    expect(fetchSpy.mock.calls[0]![0]).toBe(`/api/token/${WPLS}/meta`);
    expect(out.decimals).toBe(18);
    expect(out.symbol).toBe("WPLS");
  });
});

describe("fetchTokenTransfers", () => {
  it("uses the default 24h window", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      okRes({
        ok: true,
        result: { records: [], firstBlock: 0, lastBlock: 0, truncated: false },
      }),
    );
    await fetchTokenTransfers(WPLS);
    expect(fetchSpy.mock.calls[0]![0]).toBe(
      `/api/chifra/transfers?token=${WPLS}&window=24h`,
    );
  });

  it("threads a custom window + chainid", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      okRes({
        ok: true,
        result: { records: [], firstBlock: 0, lastBlock: 0, truncated: false },
      }),
    );
    await fetchTokenTransfers(WPLS, "30d", 1);
    expect(fetchSpy.mock.calls[0]![0]).toBe(
      `/api/chifra/transfers?token=${WPLS}&window=30d&chainid=1`,
    );
  });
});

describe("fetchContractInfo", () => {
  it("returns the contract info", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(okRes({ ok: true, result: { address: WPLS, isVerified: true } }));
    const out = await fetchContractInfo(WPLS);
    expect(fetchSpy.mock.calls[0]![0]).toBe(`/api/contract/${WPLS}`);
    expect(out.isVerified).toBe(true);
  });
});

describe("fetchTransaction (non-override dispatcher GET path)", () => {
  it("GETs /api/tx/:hash and unwraps the result envelope", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(okRes({ ok: true, result: { hash: "0xtx", status: "success" } }));
    const out = await fetchTransaction("0xtx");
    expect(fetchSpy.mock.calls[0]![0]).toBe("/api/tx/0xtx");
    expect(out.status).toBe("success");
  });
});

describe("fetchBlock (dispatcher path) — per-tx mapping", () => {
  it("derives methodId from input and maps a hex value", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      okRes({
        jsonrpc: "2.0",
        result: {
          number: "0x1",
          hash: "0xblock",
          parentHash: "0xparent",
          timestamp: "0x64",
          miner: "0xminer",
          gasUsed: "0x5208",
          gasLimit: "0x1c9c380",
          baseFeePerGas: "0x7",
          size: "0x100",
          transactions: [
            {
              hash: "0xtx",
              from: "0xfrom",
              to: "0xto",
              value: "0x0",
              input: "0xa9059cbb0000",
              type: "0x2",
            },
          ],
        },
      }),
    );
    const out = await fetchBlock("1");
    expect(out.transactions[0]!.valuePLS).toBe("0");
    expect(out.transactions[0]!.methodId).toBe("0xa9059cbb");
  });

  it("uses methodId '0x' when input is too short", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      okRes({
        jsonrpc: "2.0",
        result: {
          number: "0x2",
          hash: "0xblock2",
          parentHash: "0xp",
          timestamp: "0x64",
          miner: "0xm",
          gasUsed: "0x0",
          gasLimit: "0x0",
          baseFeePerGas: null,
          size: "0x10",
          transactions: [
            { hash: "0xtx2", from: "0xf", to: null, value: "0x0", input: "0x" },
          ],
        },
      }),
    );
    const out = await fetchBlock("2");
    expect(out.transactions[0]!.methodId).toBe("0x");
    expect(out.baseFeePerGas).toBeNull();
  });
});

describe("fetchTransaction — BYO-RPC error branches", () => {
  // With a per-chain RPC override set, fetchTransaction reads raw tx+receipt
  // straight from the node; an error envelope on either read throws.
  const OVERRIDE = "https://rpc.example.com/v2/KEY";
  const ERR = (msg: string) => ({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: msg } });
  const OK = (result: unknown) => ({ jsonrpc: "2.0", id: 1, result });

  afterEach(() => clearRpcOverride(DEFAULT_CHAIN_ID));

  it("throws when eth_getTransactionByHash errors", async () => {
    setRpcOverride(DEFAULT_CHAIN_ID, OVERRIDE);
    vi.spyOn(globalThis, "fetch").mockImplementation((async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const method = (JSON.parse(String(init!.body)) as { method: string }).method;
      const body = method === "eth_getTransactionByHash" ? ERR("bad hash") : OK(null);
      return { ok: true, status: 200, json: async () => body } as Response;
    }) as typeof fetch);
    await expect(fetchTransaction("0xtx")).rejects.toThrow(
      "eth_getTransactionByHash: bad hash",
    );
  });

  it("throws when eth_getTransactionReceipt errors", async () => {
    setRpcOverride(DEFAULT_CHAIN_ID, OVERRIDE);
    vi.spyOn(globalThis, "fetch").mockImplementation((async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const method = (JSON.parse(String(init!.body)) as { method: string }).method;
      const body =
        method === "eth_getTransactionReceipt" ? ERR("no receipt") : OK({ hash: "0xtx" });
      return { ok: true, status: 200, json: async () => body } as Response;
    }) as typeof fetch);
    await expect(fetchTransaction("0xtx")).rejects.toThrow(
      "eth_getTransactionReceipt: no receipt",
    );
  });
});

describe("apiFetch error branches (via fetchContractInfo)", () => {
  it("throws the JSON error on a non-ok HTTP status", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      errRes(JSON.stringify({ error: "not found" }), 404),
    );
    await expect(fetchContractInfo(WPLS)).rejects.toThrow("not found");
  });

  it("throws the raw text when the error body isn't JSON", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(errRes("plain text 500"));
    await expect(fetchContractInfo(WPLS)).rejects.toThrow("plain text 500");
  });

  it("throws on ok:false envelope", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      okRes({ ok: false, error: "lookup failed" }),
    );
    await expect(fetchContractInfo(WPLS)).rejects.toThrow("lookup failed");
  });

  it("throws the generic message on ok:false with no error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(okRes({ ok: false }));
    await expect(fetchContractInfo(WPLS)).rejects.toThrow("Unknown API error");
  });
});
