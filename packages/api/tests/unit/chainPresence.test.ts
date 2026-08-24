import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  getChainPresence,
  hasPresence,
  clearPresenceCache,
  type PresenceDeps,
} from "../../src/services/multichain/chainPresence.js";
import { resolveEntity } from "../../src/services/resolve/resolveEntity.js";

const ADDR = "0x11490e0f8050fa8a3f40c5aa9bb20fb76b010b68";
const OTHER = "0x00000000219ab540356cbb839cbe05303d7705fa";

/**
 * Unit tests for the cross-chain presence probe. Deps are injected, so no live
 * RPC is involved. The cache key is the interesting part: chain id must be in
 * it, because migrations 009 and 012 both exist to fix caches that left it out.
 */

function deps(overrides: Partial<PresenceDeps> = {}): PresenceDeps {
  return {
    chainIds: () => [1, 369, 943, 11155111],
    getClient: (chainId: number) =>
      ({
        getCode: async () => (chainId === 1 ? "0x6080" : undefined),
        getBalance: async () => (chainId === 369 ? 5n : 0n),
        getTransactionCount: async () => (chainId === 369 ? 94 : 0),
      }) as never,
    timeoutMs: 50,
    ...overrides,
  };
}

describe("getChainPresence", () => {
  beforeEach(() => clearPresenceCache());

  it("reports one row per chain, ascending", async () => {
    const rows = await getChainPresence(ADDR, undefined, deps());
    assert.deepEqual(rows.map((r) => r.chainId), [1, 369, 943, 11155111]);
  });

  it("marks a chain present when it has code, a balance, or a nonce", async () => {
    const rows = await getChainPresence(ADDR, undefined, deps());
    assert.equal(hasPresence(rows.find((r) => r.chainId === 1)!), true);   // code
    assert.equal(hasPresence(rows.find((r) => r.chainId === 369)!), true); // balance + nonce
    assert.equal(hasPresence(rows.find((r) => r.chainId === 943)!), false);
  });

  it("serializes the balance as a string, never a BigInt", async () => {
    const rows = await getChainPresence(ADDR, undefined, deps());
    assert.equal(typeof rows.find((r) => r.chainId === 369)!.balance, "string");
    assert.equal(rows.find((r) => r.chainId === 369)!.balance, "5");
  });

  it("marks a failing chain as errored rather than absent", async () => {
    const rows = await getChainPresence(ADDR, undefined, deps({
      getClient: (chainId: number) => {
        if (chainId === 11155111) throw new Error("rpc unconfigured");
        return {
          getCode: async () => undefined,
          getBalance: async () => 0n,
          getTransactionCount: async () => 0,
        } as never;
      },
    }));
    const sepolia = rows.find((r) => r.chainId === 11155111)!;
    assert.equal(sepolia.error, true);
    assert.equal(hasPresence(sepolia), false);
  });

  it("does not fail the whole probe when one chain times out", async () => {
    const rows = await getChainPresence(ADDR, undefined, deps({
      timeoutMs: 5,
      getClient: (chainId: number) =>
        ({
          getCode: async () =>
            chainId === 1 ? new Promise((r) => setTimeout(() => r(undefined), 50)) : undefined,
          getBalance: async () => 0n,
          getTransactionCount: async () => 0,
        }) as never,
    }));
    assert.equal(rows.length, 4);
    assert.equal(rows.find((r) => r.chainId === 1)!.error, true);
  });

  it("honours an explicit chain allowlist", async () => {
    const rows = await getChainPresence(ADDR, [1, 369], deps());
    assert.deepEqual(rows.map((r) => r.chainId), [1, 369]);
  });

  it("caches by chain id AND address, never by address alone", async () => {
    let calls = 0;
    const counting = deps({
      getClient: () =>
        ({
          getCode: async () => { calls++; return undefined; },
          getBalance: async () => 0n,
          getTransactionCount: async () => 0,
        }) as never,
    });
    await getChainPresence(ADDR, [1, 369], counting);
    assert.equal(calls, 2);
    await getChainPresence(ADDR, [1, 369], counting); // served from cache
    assert.equal(calls, 2);
    await getChainPresence(OTHER, [1, 369], counting); // different address
    assert.equal(calls, 4);
    await getChainPresence(ADDR, [943], counting);     // different chain
    assert.equal(calls, 5);
  });

  it("normalizes the address so case does not split the cache", async () => {
    let calls = 0;
    const counting = deps({
      getClient: () =>
        ({
          getCode: async () => { calls++; return undefined; },
          getBalance: async () => 0n,
          getTransactionCount: async () => 0,
        }) as never,
    });
    await getChainPresence(ADDR, [1], counting);
    await getChainPresence(ADDR.toUpperCase().replace("0X", "0x"), [1], counting);
    assert.equal(calls, 1);
  });

  it("does not cache an errored probe", async () => {
    let calls = 0;
    const failing = deps({
      chainIds: () => [1],
      getClient: () =>
        ({
          getCode: async () => { calls++; throw new Error("down"); },
          getBalance: async () => 0n,
          getTransactionCount: async () => 0,
        }) as never,
    });
    await getChainPresence(ADDR, [1], failing);
    await getChainPresence(ADDR, [1], failing);
    assert.equal(calls, 2); // a failure must be retried, not pinned
  });
});

describe("resolve shares the presence cache", () => {
  it("does not re-probe a chain the presence service already answered for", async () => {
    clearPresenceCache();
    let calls = 0;
    const counting = deps({
      chainIds: () => [1, 369],
      getClient: () =>
        ({
          getCode: async () => { calls++; return "0x6080"; },
          getBalance: async () => 0n,
          getTransactionCount: async () => 0,
        }) as never,
    });

    await getChainPresence(ADDR, [1, 369], counting);
    assert.equal(calls, 2);

    // resolveEntity's address branch reads the same cache, so this costs zero
    // further RPC calls.
    const result = await resolveEntity(ADDR, {
      chainIds: () => [1, 369],
      getClient: counting.getClient,
      timeoutMs: 50,
    });
    assert.equal(calls, 2);
    assert.deepEqual(result.matches.map((m) => m.chainId), [1, 369]);
    assert.equal(result.matches[0]!.isContract, true);
  });
});
