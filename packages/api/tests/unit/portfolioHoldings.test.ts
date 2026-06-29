import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { getHoldings, type HoldingsDeps } from "../../src/services/portfolio/holdings.js";
import { invalidateChifraCache } from "../../src/services/chifra/index.js";
import type { HeldBalance, TokenMeta } from "../../src/services/portfolio/transforms.js";

/**
 * Service-level tests for getHoldings with injected deps (no data source, no
 * RPC). The HYBRID model: queryBalances DISCOVERS which tokens a holder has
 * touched (archive), readBalances reads EXACT balanceOf for those tokens
 * (chain). Exercises discovery → exact balance → metadata → mapping, the
 * indexed-vs-not signal, balanceOf overriding the archive (incl. fully-exited
 * tokens), the readMetadata skip, graceful native failure, and the cache.
 */

const HOLDER = "0x9cd83be15a79646a3d22b81fc8ddf7b7240a62cb";
const HEX = "2b591e99afe9f32eaa6214f7b7629768c40eeb39"; // curated 369, 8 decimals
const WPLS = "a1077a294dde1b09bb078844df40758a5d0f9a27"; // curated 369, 18 decimals
const RANDOM = "dead00000000000000000000000000000000beef"; // not curated

const balance = (token: string, value: bigint): HeldBalance => ({ token, balance: value });
const meta = (over: Partial<TokenMeta> & { token: string }): TokenMeta => ({
  decimals: 18,
  symbol: "",
  name: "",
  ...over,
});

interface FakeOpts {
  /** queryBalances — token discovery (the archive). `null` = not indexed. */
  discovered?: HeldBalance[] | null;
  /** readBalances — exact balanceOf per token. Defaults to echoing discovery. */
  exact?: HeldBalance[];
  metas?: TokenMeta[];
  native?: bigint;
  nativeThrows?: boolean;
}

function makeDeps(opts: FakeOpts): {
  deps: HoldingsDeps;
  counts: { b: number; rb: number; m: number; n: number };
} {
  const counts = { b: 0, rb: 0, m: 0, n: 0 };
  const deps: HoldingsDeps = {
    async queryBalances() {
      counts.b++;
      return opts.discovered === undefined ? [] : opts.discovered;
    },
    async readBalances(_chainId, _holder, tokens) {
      counts.rb++;
      const src = opts.exact ?? opts.discovered ?? [];
      return src.filter((b) => tokens.includes(b.token));
    },
    async readMetadata() {
      counts.m++;
      return opts.metas ?? [];
    },
    async nativeBalance() {
      counts.n++;
      if (opts.nativeThrows) throw new Error("rpc down");
      return opts.native ?? 0n;
    },
  };
  return { deps, counts };
}

beforeEach(() => invalidateChifraCache());

describe("getHoldings — happy path", () => {
  it("discovers tokens, reads exact balances + metadata, maps (sorted desc) + native", async () => {
    const { deps } = makeDeps({
      discovered: [balance(HEX, 100000000n), balance(WPLS, 5_000000000000000000n)],
      metas: [
        meta({ token: HEX, decimals: 8, symbol: "HEX", name: "HEX" }),
        meta({ token: WPLS, decimals: 18, symbol: "WPLS", name: "Wrapped Pulse" }),
      ],
      native: 40_000000000000000000n, // 40 PLS
    });
    const r = await getHoldings(HOLDER, 369, deps);
    assert.equal(r.chainId, 369);
    assert.equal(r.address, HOLDER);
    assert.equal(r.indexed, true);
    assert.equal(r.holdings.length, 2);
    assert.equal(r.holdings[0]!.symbol, "WPLS"); // 5 > 1
    assert.equal(r.holdings[0]!.balance, "5000000000000000000"); // raw, unscaled
    assert.equal(r.holdings[1]!.symbol, "HEX");
    assert.equal(r.native.symbol, "PLS");
    assert.equal(r.native.balance, "40000000000000000000");
  });

  it("includes non-curated tokens (all tokens, not an allowlist)", async () => {
    const { deps } = makeDeps({
      discovered: [balance(RANDOM, 7n)],
      metas: [meta({ token: RANDOM, decimals: 0, symbol: "RND", name: "Random" })],
    });
    const r = await getHoldings(HOLDER, 369, deps);
    assert.equal(r.holdings.length, 1);
    assert.equal(r.holdings[0]!.symbol, "RND");
  });

  it("keeps a held token via curated decimals when its metadata read failed", async () => {
    const { deps } = makeDeps({ discovered: [balance(HEX, 150000000n)], metas: [] });
    const r = await getHoldings(HOLDER, 369, deps);
    assert.equal(r.holdings.length, 1);
    assert.equal(r.holdings[0]!.symbol, "HEX");
    assert.equal(r.holdings[0]!.balance, "150000000"); // raw 1.5e8; UI scales 8dp
  });

  it("drops a held token with no curated override and no resolvable decimals", async () => {
    const { deps } = makeDeps({ discovered: [balance(RANDOM, 5n)], metas: [] });
    const r = await getHoldings(HOLDER, 369, deps);
    assert.equal(r.indexed, true);
    assert.equal(r.holdings.length, 0);
  });
});

describe("getHoldings — hybrid: on-chain balanceOf is authoritative", () => {
  it("uses the exact balanceOf, not the archive's (stale) balance", async () => {
    const { deps } = makeDeps({
      discovered: [balance(HEX, 100000000n)], // archive says 1 HEX
      exact: [balance(HEX, 250000000n)], // chain says 2.5 HEX
      metas: [meta({ token: HEX, decimals: 8, symbol: "HEX" })],
    });
    const r = await getHoldings(HOLDER, 369, deps);
    assert.equal(r.holdings.length, 1);
    assert.equal(r.holdings[0]!.balance, "250000000"); // exact, not 100000000
  });

  it("drops a token the holder has fully exited (archive stale-positive, balanceOf 0)", async () => {
    const { deps, counts } = makeDeps({
      discovered: [balance(WPLS, 5_000000000000000000n)], // archive thinks 5 WPLS
      exact: [balance(WPLS, 0n)], // chain: exited
      metas: [meta({ token: WPLS, decimals: 18, symbol: "WPLS" })],
    });
    const r = await getHoldings(HOLDER, 369, deps);
    assert.equal(r.holdings.length, 0);
    assert.equal(counts.rb, 1); // discovery → balanceOf read happened
    assert.equal(counts.m, 0); // nothing positive → no metadata read
  });
});

describe("getHoldings — not indexed vs empty", () => {
  it("queryBalances null → indexed=false, native still returned, no balanceOf/metadata read", async () => {
    const { deps, counts } = makeDeps({ discovered: null, native: 1000000000000000000n });
    const r = await getHoldings(HOLDER, 369, deps);
    assert.equal(r.indexed, false);
    assert.equal(r.holdings.length, 0);
    assert.equal(r.native.balance, "1000000000000000000");
    assert.equal(counts.rb, 0); // nothing discovered → don't read balances
    assert.equal(counts.m, 0);
  });

  it("queryBalances [] → indexed=true, no balanceOf/metadata read, no holdings", async () => {
    const { deps, counts } = makeDeps({ discovered: [], native: 0n });
    const r = await getHoldings(HOLDER, 369, deps);
    assert.equal(r.indexed, true);
    assert.equal(r.holdings.length, 0);
    assert.equal(counts.rb, 0);
    assert.equal(counts.m, 0);
  });
});

describe("getHoldings — native is non-fatal", () => {
  it("native RPC failure degrades to zero, holdings still returned", async () => {
    const { deps } = makeDeps({
      discovered: [balance(HEX, 100000000n)],
      metas: [meta({ token: HEX, decimals: 8, symbol: "HEX" })],
      nativeThrows: true,
    });
    const r = await getHoldings(HOLDER, 369, deps);
    assert.equal(r.holdings.length, 1);
    assert.equal(r.native.balance, "0");
  });
});

describe("getHoldings — cache", () => {
  it("serves the second call from cache (no re-query)", async () => {
    const { deps, counts } = makeDeps({
      discovered: [balance(HEX, 100000000n)],
      metas: [meta({ token: HEX, decimals: 8, symbol: "HEX" })],
      native: 0n,
    });
    await getHoldings(HOLDER, 369, deps);
    await getHoldings(HOLDER, 369, deps);
    assert.equal(counts.b, 1);
    assert.equal(counts.rb, 1);
    assert.equal(counts.m, 1);
    assert.equal(counts.n, 1);
  });
});
