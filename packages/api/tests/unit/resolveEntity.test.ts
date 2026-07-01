import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { PublicClient } from "viem";

import {
  classify,
  resolveEntity,
  type ResolveDeps,
} from "../../src/services/resolve/resolveEntity.js";

/**
 * Service-level tests for the cross-chain resolver with injected deps (no live
 * RPC). Exercises shape classification, the per-kind probes (tx = exact match,
 * address = presence via code/nonce/balance, block = head height), and the
 * "a per-chain failure means not-here, never a whole-request failure" contract
 * (unconfigured client, rejected probe, and timeout are all swallowed).
 */

const TX = `0x${"a".repeat(64)}`;
const ADDR = `0x${"b".repeat(40)}`;

/** A viem-ish client that reports "nothing here" unless overridden. */
function fakeClient(over: Partial<Record<string, unknown>> = {}): PublicClient {
  const notFound = () => Promise.reject(new Error("not found"));
  return {
    getTransaction: over.getTransaction ?? notFound,
    getCode: over.getCode ?? (() => Promise.resolve(undefined)),
    getBalance: over.getBalance ?? (() => Promise.resolve(0n)),
    getTransactionCount: over.getTransactionCount ?? (() => Promise.resolve(0)),
    getBlockNumber: over.getBlockNumber ?? (() => Promise.resolve(0n)),
  } as unknown as PublicClient;
}

function makeDeps(
  clients: Record<number, PublicClient>,
  timeoutMs = 1_000,
): ResolveDeps {
  return {
    chainIds: () => Object.keys(clients).map(Number),
    getClient: (id) => {
      const c = clients[id];
      if (!c) throw new Error(`no client for ${id}`); // simulates unconfigured RPC
      return c;
    },
    timeoutMs,
  };
}

describe("classify", () => {
  it("recognizes each shape", () => {
    assert.equal(classify(`0x${"1".repeat(64)}`), "tx");
    assert.equal(classify(`0x${"1".repeat(40)}`), "address");
    assert.equal(classify("0xdeadbeef"), "selector");
    assert.equal(classify("12345"), "block");
    assert.equal(classify("hello"), "unknown");
    assert.equal(classify(""), "unknown");
  });

  it("normalizes case + whitespace", () => {
    assert.equal(classify(`  0x${"A".repeat(40)}  `), "address");
  });
});

describe("resolveEntity — tx", () => {
  it("matches exactly the chain(s) that return the tx", async () => {
    const deps = makeDeps({
      1: fakeClient(), // not found
      369: fakeClient({ getTransaction: () => Promise.resolve({ hash: TX }) }),
      943: fakeClient(), // not found
    });
    const r = await resolveEntity(TX, deps);
    assert.equal(r.kind, "tx");
    assert.equal(r.query, TX);
    assert.deepEqual(r.matches, [{ chainId: 369 }]);
  });

  it("returns no matches when found nowhere", async () => {
    const deps = makeDeps({ 1: fakeClient(), 369: fakeClient() });
    const r = await resolveEntity(TX, deps);
    assert.deepEqual(r.matches, []);
  });
});

describe("resolveEntity — address", () => {
  it("reports presence via code, nonce, or balance; skips empty chains", async () => {
    const deps = makeDeps({
      1: fakeClient({ getCode: () => Promise.resolve("0x6001") }), // contract
      369: fakeClient({ getTransactionCount: () => Promise.resolve(3) }), // used EOA
      943: fakeClient({ getBalance: () => Promise.resolve(5n) }), // funded EOA
      100: fakeClient(), // untouched → skipped
    });
    const r = await resolveEntity(ADDR, deps);
    assert.equal(r.kind, "address");
    assert.deepEqual(r.matches, [
      { chainId: 1, isContract: true },
      { chainId: 369, isContract: false },
      { chainId: 943, isContract: false },
    ]);
  });

  it("treats 0x code as not-a-contract", async () => {
    const deps = makeDeps({
      1: fakeClient({
        getCode: () => Promise.resolve("0x"),
        getBalance: () => Promise.resolve(1n),
      }),
    });
    const r = await resolveEntity(ADDR, deps);
    assert.deepEqual(r.matches, [{ chainId: 1, isContract: false }]);
  });
});

describe("resolveEntity — block", () => {
  it("matches chains whose head has reached the height", async () => {
    const deps = makeDeps({
      1: fakeClient({ getBlockNumber: () => Promise.resolve(50n) }),
      369: fakeClient({ getBlockNumber: () => Promise.resolve(200n) }),
    });
    const r = await resolveEntity("100", deps);
    assert.equal(r.kind, "block");
    assert.deepEqual(r.matches, [{ chainId: 369 }]);
  });
});

describe("resolveEntity — non-locatable kinds", () => {
  it("returns empty matches for selectors and unknown without probing", async () => {
    let probed = false;
    const deps: ResolveDeps = {
      chainIds: () => {
        probed = true;
        return [1];
      },
      getClient: () => fakeClient(),
      timeoutMs: 1_000,
    };
    assert.deepEqual((await resolveEntity("0xdeadbeef", deps)).matches, []);
    assert.deepEqual((await resolveEntity("nope", deps)).matches, []);
    assert.equal(probed, false, "should not fan out for non-locatable input");
  });
});

describe("resolveEntity — per-chain failures are swallowed", () => {
  it("skips an unconfigured chain rather than failing the request", async () => {
    // chain 1 has no client (getClient throws); 369 has the tx.
    const deps: ResolveDeps = {
      chainIds: () => [1, 369],
      getClient: (id) => {
        if (id === 1) throw new Error("no RPC configured");
        return fakeClient({ getTransaction: () => Promise.resolve({ hash: TX }) });
      },
      timeoutMs: 1_000,
    };
    const r = await resolveEntity(TX, deps);
    assert.deepEqual(r.matches, [{ chainId: 369 }]);
  });

  it("times out a hung probe instead of hanging", async () => {
    const deps = makeDeps(
      {
        1: fakeClient({ getTransaction: () => new Promise(() => {}) }), // never settles
        369: fakeClient({ getTransaction: () => Promise.resolve({ hash: TX }) }),
      },
      20, // 20ms budget
    );
    const r = await resolveEntity(TX, deps);
    assert.deepEqual(r.matches, [{ chainId: 369 }]);
  });
});
