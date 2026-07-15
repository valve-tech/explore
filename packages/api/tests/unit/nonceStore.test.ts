import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createSiweMessage, parseSiweMessage } from "viem/siwe";

import {
  createNonceStore,
  sweepExpired,
  issueNonce,
  consumeNonce,
} from "../../src/services/auth/nonceStore.js";

/**
 * Unit tests for the SIWE nonce store.
 *
 * The store is ours rather than `@valve-tech/siwe-store`'s memory store for
 * two reasons, both pinned by tests below:
 *
 *  1. That store mints via viem's `generateSiweNonce()` = `uid(96)`, which
 *     slices a shared `Math.random()` buffer advancing ONE char per call —
 *     consecutive nonces overlap in 95 of 96 chars, so holding one nonce
 *     gives you the next. See "unpredictability".
 *  2. It only evicts on `consume()`, so an issued-but-never-verified nonce
 *     stays in the Map forever. See "sweepExpired".
 */

describe("nonce unpredictability", () => {
  it("does not emit a sliding window (the viem uid regression)", () => {
    const store = createNonceStore();
    const nonces = Array.from({ length: 50 }, () => store.issue());

    for (let i = 1; i < nonces.length; i++) {
      const prev = nonces[i - 1]!;
      const next = nonces[i]!;
      assert.notEqual(
        next.slice(0, -1),
        prev.slice(1),
        "nonce is a 1-char shift of its predecessor — sliding-window PRNG regressed",
      );
    }
  });

  it("emits no shared 16-char run between consecutive nonces", () => {
    const store = createNonceStore();
    const prev = store.issue();
    const next = store.issue();

    // Any 16-hex-char (64-bit) run shared between two independent nonces is
    // astronomically unlikely; under viem's uid it is guaranteed.
    for (let i = 0; i + 16 <= prev.length; i++) {
      assert.ok(
        !next.includes(prev.slice(i, i + 16)),
        `next nonce reuses a 16-char run from the previous at offset ${i}`,
      );
    }
  });

  it("issues unique nonces across a large batch", () => {
    const store = createNonceStore();
    const seen = new Set(Array.from({ length: 1000 }, () => store.issue()));
    assert.equal(seen.size, 1000);
  });
});

describe("SIWE grammar", () => {
  it("round-trips through createSiweMessage / parseSiweMessage", () => {
    const store = createNonceStore();
    const nonce = store.issue();

    // createSiweMessage throws if the nonce violates /^[a-zA-Z0-9]{8,}$/.
    const message = createSiweMessage({
      address: "0xA1077a294dDE1B09bB078844df40758a5D0f9a27",
      chainId: 369,
      domain: "explore.valve.city",
      nonce,
      uri: "https://explore.valve.city",
      version: "1",
    });

    assert.equal(parseSiweMessage(message).nonce, nonce);
  });
});

describe("single-use consume", () => {
  it("accepts a nonce exactly once", () => {
    const store = createNonceStore();
    const nonce = store.issue();

    assert.equal(store.consume(nonce), true);
    assert.equal(store.consume(nonce), false, "replay must fail");
  });

  it("rejects a nonce it never issued", () => {
    assert.equal(createNonceStore().consume("neverissuedbythisstore"), false);
  });

  it("rejects an expired nonce", () => {
    let clock = 1_000_000;
    const store = createNonceStore({ ttlSeconds: 300, now: () => clock });
    const nonce = store.issue();

    clock += 301 * 1000;
    assert.equal(store.consume(nonce), false);
  });

  it("deletes before the TTL check so a race-loser cannot reuse", () => {
    let clock = 1_000_000;
    const store = createNonceStore({ ttlSeconds: 300, now: () => clock });
    const nonce = store.issue();

    assert.equal(store.consume(nonce), true);
    // Even back-dated, the entry is gone — not merely time-invalid.
    clock -= 1000;
    assert.equal(store.consume(nonce), false);
  });
});

describe("sweepExpired", () => {
  it("drops only entries past their expiry", () => {
    const issued = new Map([
      ["stale", 500],
      ["alsoStale", 999],
      ["fresh", 2000],
    ]);

    const dropped = sweepExpired(issued, 1000);

    assert.equal(dropped, 2);
    assert.deepEqual([...issued.keys()], ["fresh"]);
  });

  it("keeps an entry expiring exactly now (consume still TTL-checks it)", () => {
    const issued = new Map([["edge", 1000]]);
    assert.equal(sweepExpired(issued, 1000), 0);
  });

  it("bounds the store: unconsumed nonces do not accumulate past their TTL", () => {
    let clock = 1_000_000;
    const store = createNonceStore({ ttlSeconds: 300, now: () => clock });

    // 500 challenges nobody ever verifies.
    for (let i = 0; i < 500; i++) store.issue();

    // Past their TTL, a later issue sweeps them.
    clock += 301 * 1000;
    const survivor = store.issue();

    assert.equal(store.size(), 1, "expired unconsumed nonces must be evicted");
    assert.equal(store.consume(survivor), true);
  });
});

describe("module-level issueNonce / consumeNonce", () => {
  it("issues a live nonce and consumes it once", async () => {
    const { nonce, expiresAt } = await issueNonce();

    assert.match(nonce, /^[a-zA-Z0-9]{8,}$/);
    assert.ok(expiresAt > Date.now(), "expiresAt must be in the future");
    assert.equal(await consumeNonce(nonce), true);
    assert.equal(await consumeNonce(nonce), false);
  });
});
