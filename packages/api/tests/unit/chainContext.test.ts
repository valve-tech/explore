/**
 * Unit tests for the chain-routing core: the `chainContext` middleware resolves
 * `?chainid` / a body `chainid` once and binds it to an AsyncLocalStorage scope
 * so deep service code (`currentChainId()` / `chainClient()`) routes to the
 * right per-chain RPC without threading the id through every signature.
 *
 * This is the "verify" half of the multichain-routing work: it proves a
 * cross-chain request (chain 1) actually surfaces chain 1 inside the handler,
 * and that the middleware's deliberately-lenient fallback (bad/unsupported →
 * default) holds — the strict 400 lives in the separate strictChainId guard.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { Request, Response } from "express";
import { chainContext } from "../../src/middleware/chainContext.js";
import { currentChainId } from "../../src/services/chains/context.js";
import { DEFAULT_CHAIN_ID } from "../../src/services/chains/registry.js";

/** Drive the middleware and capture the chain id visible inside `next()`. */
function chainSeenFor(opts: {
  query?: Record<string, unknown>;
  body?: unknown;
}): number {
  const req = { query: opts.query ?? {}, body: opts.body } as unknown as Request;
  let seen = -1;
  chainContext(req, {} as Response, () => {
    seen = currentChainId();
  });
  return seen;
}

describe("chainContext routing", () => {
  it("binds a supported cross-chain request to that chain (Ethereum = 1)", () => {
    assert.equal(chainSeenFor({ query: { chainid: "1" } }), 1);
  });

  it("binds each launch-set chain from the query", () => {
    for (const id of [1, 369, 943]) {
      assert.equal(chainSeenFor({ query: { chainid: String(id) } }), id);
    }
  });

  it("reads the chain from a body field when the query omits it", () => {
    assert.equal(chainSeenFor({ body: { chainid: 1 } }), 1);
  });

  it("defaults to PulseChain (369) when chainid is omitted", () => {
    assert.equal(chainSeenFor({}), DEFAULT_CHAIN_ID);
    assert.equal(DEFAULT_CHAIN_ID, 369);
  });

  it("falls back to the default on an unsupported chain (lenient — strict 400 is the guard's job)", () => {
    assert.equal(chainSeenFor({ query: { chainid: "8453" } }), DEFAULT_CHAIN_ID);
  });

  it("falls back to the default on malformed input", () => {
    assert.equal(chainSeenFor({ query: { chainid: "abc" } }), DEFAULT_CHAIN_ID);
    assert.equal(chainSeenFor({ query: { chainid: "-1" } }), DEFAULT_CHAIN_ID);
  });

  it("resolves to the default outside any request scope", () => {
    assert.equal(currentChainId(), DEFAULT_CHAIN_ID);
  });
});
