/**
 * Unit tests for the holdings GraphQL adapter (services/portfolio/balanceSource).
 * The gateway fronts the `balance_changes` archive; we mock fetch and assert the
 * request shape + row→HeldBalance mapping + error semantics, plus that an
 * unconfigured chain reports "not indexed" (null).
 *
 * Fixture: WPLS `0xA1077a294dDE1B09bB078844df40758a5D0f9a27` on PulseChain (369),
 * a verified ERC-20 (decimals 18). Verify the token:
 *   https://scan.pulsechain.com/address/0xA1077a294dDE1B09bB078844df40758a5D0f9a27
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  fetchHoldingsViaGraphql,
  queryBalances,
  HOLDINGS_GQL_ROOT,
} from "../../src/services/portfolio/balanceSource.js";

const WPLS_BARE = "a1077a294dde1b09bb078844df40758a5d0f9a27";
const HOLDER_BARE = "9cd83be15a79646a3d22b81fc8ddf7b7240a62cb";

/** Build a fake `fetch` returning a Hasura-shaped JSON body. */
function fakeFetch(
  body: unknown,
  init: { ok?: boolean; status?: number } = {},
): { fetchImpl: typeof fetch; calls: Array<{ url: string; init: RequestInit }> } {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (url: string, reqInit: RequestInit) => {
    calls.push({ url, init: reqInit });
    return {
      ok: init.ok ?? true,
      status: init.status ?? 200,
      statusText: "OK",
      json: async () => body,
    };
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe("fetchHoldingsViaGraphql", () => {
  it("maps gateway rows to HeldBalance (bare-hex token, bigint balance)", async () => {
    const { fetchImpl, calls } = fakeFetch({
      data: {
        [HOLDINGS_GQL_ROOT]: [
          { contract: WPLS_BARE, balance: "5456507558918974858760" },
          { contract: `0x${"b".repeat(40)}`, balance: "1000" },
        ],
      },
    });

    const held = await fetchHoldingsViaGraphql(
      "https://gw.example/v1/graphql",
      HOLDER_BARE,
      { fetchImpl },
    );

    assert.equal(held.length, 2);
    assert.deepEqual(held[0], {
      token: WPLS_BARE,
      balance: 5456507558918974858760n,
    });
    // 0x-prefixed contracts are normalized to the bare archive key form.
    assert.equal(held[1]?.token, "b".repeat(40));

    // Request carries the holder as the `owner` variable + JSON content type.
    const sent = JSON.parse(String(calls[0]?.init.body));
    assert.equal(sent.variables.owner, HOLDER_BARE);
    assert.match(sent.query, new RegExp(HOLDINGS_GQL_ROOT));
  });

  it("forwards the admin secret header when provided", async () => {
    const { fetchImpl, calls } = fakeFetch({ data: { [HOLDINGS_GQL_ROOT]: [] } });
    await fetchHoldingsViaGraphql("https://gw.example/v1/graphql", HOLDER_BARE, {
      fetchImpl,
      secret: "s3cr3t",
    });
    const headers = calls[0]?.init.headers as Record<string, string>;
    assert.equal(headers["x-hasura-admin-secret"], "s3cr3t");
  });

  it("returns [] when the holder has no positive balances (indexed, empty)", async () => {
    const { fetchImpl } = fakeFetch({ data: { [HOLDINGS_GQL_ROOT]: [] } });
    const held = await fetchHoldingsViaGraphql("https://gw.example", HOLDER_BARE, {
      fetchImpl,
    });
    assert.deepEqual(held, []);
  });

  it("drops zero/negative and malformed rows defensively", async () => {
    const { fetchImpl } = fakeFetch({
      data: {
        [HOLDINGS_GQL_ROOT]: [
          { contract: WPLS_BARE, balance: "0" },
          { contract: null, balance: "5" },
          { contract: "cc", balance: "7" },
        ],
      },
    });
    const held = await fetchHoldingsViaGraphql("https://gw.example", HOLDER_BARE, {
      fetchImpl,
    });
    assert.deepEqual(held, [{ token: "cc", balance: 7n }]);
  });

  it("throws on a non-2xx status", async () => {
    const { fetchImpl } = fakeFetch({}, { ok: false, status: 502 });
    await assert.rejects(
      () => fetchHoldingsViaGraphql("https://gw.example", HOLDER_BARE, { fetchImpl }),
      /502/,
    );
  });

  it("throws on GraphQL errors", async () => {
    const { fetchImpl } = fakeFetch({
      errors: [{ message: "field 'owner' not found" }],
    });
    await assert.rejects(
      () => fetchHoldingsViaGraphql("https://gw.example", HOLDER_BARE, { fetchImpl }),
      /owner/,
    );
  });

  it("throws on an unexpected response shape", async () => {
    const { fetchImpl } = fakeFetch({ data: { somethingElse: [] } });
    await assert.rejects(
      () => fetchHoldingsViaGraphql("https://gw.example", HOLDER_BARE, { fetchImpl }),
      /unexpected shape/,
    );
  });
});

describe("queryBalances", () => {
  it("returns null (not indexed) when the chain has no gateway configured", async () => {
    // No HOLDINGS_GRAPHQL_URL in the test env → chain 369 has no gateway.
    assert.equal(await queryBalances(369, HOLDER_BARE), null);
  });
});
