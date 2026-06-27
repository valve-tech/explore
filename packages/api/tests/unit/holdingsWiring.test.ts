/**
 * End-to-end wiring test for the holdings gateway: proves that setting
 * HOLDINGS_GRAPHQL_URL flows through the chain registry → balanceSource.queryBalances
 * → fetchHoldingsViaGraphql → getHoldings, producing indexed holdings. The
 * gateway HTTP call is mocked; token metadata + native balance (the RPC legs)
 * are injected, so this isolates the config/transport wiring with no live RPC.
 *
 * Env must be set BEFORE the registry module loads, so the registry-dependent
 * modules are pulled in via dynamic import after the assignments below.
 *
 * Fixture: WPLS 0xA1077a294dDE1B09bB078844df40758a5D0f9a27 on PulseChain (369).
 *   https://scan.pulsechain.com/address/0xA1077a294dDE1B09bB078844df40758a5D0f9a27
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

process.env.HOLDINGS_GRAPHQL_URL = "https://mock-gw.test/v1/graphql";
process.env.HOLDINGS_GRAPHQL_SECRET = "vault-admin-secret";
// A keyed valve RPC so the registry builds chain 1's client lazily without throwing.
process.env.PULSECHAIN_RPC_URL =
  process.env.PULSECHAIN_RPC_URL || "https://rpc.valve.city/v1/test/evm/369";

const { getHoldings } = await import("../../src/services/portfolio/holdings.js");
const { queryBalances } = await import("../../src/services/portfolio/balanceSource.js");

const WPLS_BARE = "a1077a294dde1b09bb078844df40758a5d0f9a27";
const HOLDER = "0x9cd83be15a79646a3d22b81fc8ddf7b7240a62cb";

let calls: Array<{ url: string; init: { headers?: Record<string, string>; body?: string } }>;
let origFetch: typeof fetch;

before(() => {
  origFetch = globalThis.fetch;
  calls = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init: init as never });
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({
        data: { current_balances: [{ contract: WPLS_BARE, balance: "5456507558918974858760" }] },
      }),
    } as unknown as Response;
  }) as unknown as typeof fetch;
});

after(() => {
  globalThis.fetch = origFetch;
});

describe("holdings wiring: env → registry → queryBalances → getHoldings", () => {
  it("serves indexed holdings from the configured gateway, hitting the URL + admin secret", async () => {
    const res = await getHoldings(HOLDER, 369, {
      queryBalances, // the REAL transport — reads getChain(369).holdingsGraphqlUrl
      readMetadata: async (_chainId, tokens) =>
        tokens.map((t) => ({ token: t, decimals: 18, symbol: "WPLS", name: "Wrapped Pulse" })),
      nativeBalance: async () => 1_000_000_000_000_000_000n,
    });

    assert.equal(res.indexed, true);
    assert.equal(res.holdings.length, 1);
    assert.equal(res.holdings[0]?.symbol, "WPLS");
    assert.equal(res.native.balance, "1000000000000000000");

    // The configured gateway URL + vault secret header were actually used.
    assert.equal(calls[0]?.url, "https://mock-gw.test/v1/graphql");
    assert.equal(calls[0]?.init.headers?.["x-hasura-admin-secret"], "vault-admin-secret");
    // owner is sent 0x-prefixed lowercase, matching the balance_changes DDL.
    const sent = JSON.parse(calls[0]!.init.body!);
    assert.equal(sent.variables.owner, HOLDER.toLowerCase());
  });
});
