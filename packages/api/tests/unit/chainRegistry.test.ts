import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_CHAIN_ID,
  getChain,
  isSupportedChain,
  listChains,
} from "../../src/services/chains/registry.js";

/** An id that is deliberately NOT in the launch set (Base mainnet). */
const UNREGISTERED_CHAIN_ID = 8453;

/**
 * Unit tests for the per-chain ChainConfig registry. Pure data + three
 * lookups — no daemon, no network. Pins the served set (1/369/943/11155111), the
 * chifra slugs (the load-bearing field for portfolio holdings), and the
 * throw-vs-guard contract on unknown ids.
 */

describe("chain registry — served set", () => {
  it("registers exactly chains 1, 369, 943, 11155111", () => {
    const ids = listChains().map((c) => c.chainId);
    assert.deepEqual(ids, [1, 369, 943, 11155111]);
  });

  it("defaults to PulseChain (369)", () => {
    assert.equal(DEFAULT_CHAIN_ID, 369);
    assert.equal(isSupportedChain(DEFAULT_CHAIN_ID), true);
  });

  it("carries the chifra daemon slugs verified against status?chains=true", () => {
    assert.equal(getChain(1).chifraChain, "mainnet");
    assert.equal(getChain(369).chifraChain, "pulsechain");
    assert.equal(getChain(943).chifraChain, "pulsechain-v4");
    // Sepolia's is TrueBlocks' canonical slug but is NOT confirmed against the
    // valve daemon (status?chains=true 403s) — see the note in defaults.ts.
    assert.equal(getChain(11155111).chifraChain, "sepolia");
  });

  it("every chain carries a non-empty chifra slug (holdings depends on it)", () => {
    for (const c of listChains()) {
      assert.ok(c.chifraChain.length > 0, `missing chifraChain for ${c.chainId}`);
    }
  });

  it("uses the daemon/viem native symbols (943 is v4PLS, not tPLS)", () => {
    assert.equal(getChain(1).nativeSymbol, "ETH");
    assert.equal(getChain(369).nativeSymbol, "PLS");
    assert.equal(getChain(943).nativeSymbol, "v4PLS");
    assert.equal(getChain(11155111).nativeSymbol, "ETH");
  });

  it("binds each entry to the matching viem chain definition", () => {
    for (const c of listChains()) {
      assert.equal(c.viemChain.id, c.chainId, `viemChain.id mismatch for ${c.chainId}`);
    }
  });

  it("PulseChain chains and Sepolia ship a blockscoutBase; Ethereum omits it", () => {
    assert.ok(getChain(369).blockscoutBase, "369 should have a blockscout base");
    assert.ok(getChain(943).blockscoutBase, "943 should have a blockscout base");
    assert.ok(
      getChain(11155111).blockscoutBase,
      "11155111 should have a blockscout base",
    );
    assert.equal(getChain(1).blockscoutBase, undefined);
  });

  it("names a substreams endpoint only where one exists, in the canonical form", () => {
    // The field is optional and MUST stay omitted rather than guessed: a chain
    // without a substreams deployment (Sepolia — evm-11155111-substreams.
    // valve.city does not resolve) buys a connect timeout instead of a clean
    // "not indexed here" if we invent the hostname. Where it IS set, it must
    // follow the evm-{id}-substreams.valve.city pattern.
    assert.equal(getChain(11155111).substreamsEndpoint, undefined);
    for (const c of listChains()) {
      if (c.substreamsEndpoint === undefined) continue;
      assert.equal(c.substreamsEndpoint, `evm-${c.chainId}-substreams.valve.city`);
    }
  });

  it("flags the testnet", () => {
    assert.equal(getChain(1).testnet, false);
    assert.equal(getChain(369).testnet, false);
    assert.equal(getChain(943).testnet, true);
  });
});

describe("chain registry — lookup contract", () => {
  it("isSupportedChain is false for unknown ids", () => {
    assert.equal(isSupportedChain(UNREGISTERED_CHAIN_ID), false);
    assert.equal(isSupportedChain(0), false);
  });

  it("getChain throws on an unregistered id (callers must gate first)", () => {
    assert.throws(
      () => getChain(UNREGISTERED_CHAIN_ID),
      /Unsupported chainId: 8453/,
    );
  });
});
