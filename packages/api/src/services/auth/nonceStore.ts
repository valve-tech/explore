import { randomBytes } from "node:crypto";
import type { NonceStore } from "@valve-tech/siwe-store";

/**
 * Single-use SIWE nonce store for the challenge flow.
 *
 * `issue()` mints a fresh nonce and remembers it; `consume()` validates +
 * deletes in one shot (delete-before-TTL-check), so a replay or a race-loser
 * sees `false`. Every failure mode (unknown / already-used / expired)
 * collapses to `false` without distinguishing — the desired behaviour for an
 * auth primitive, and why `routes/auth.ts` returns one 401 for all of them.
 *
 * This implements `@valve-tech/siwe-store`'s `NonceStore` contract rather than
 * using its `createMemoryNonceStore`, for two reasons:
 *
 *  1. UNPREDICTABILITY. That store mints via viem's `generateSiweNonce()`,
 *     which is `uid(96)` — a slice of a shared buffer built from
 *     `Math.random()` (not a CSPRNG), advanced by ONE character per call.
 *     Consecutive nonces therefore overlap in 95 of 96 characters, so holding
 *     one nonce hands you the next. Verified present in viem 2.55.2 (latest),
 *     so this is not fixable by upgrading. EIP-4361's nonce exists to be
 *     unguessable; we mint from `randomBytes` instead.
 *  2. BOUNDEDNESS. That store only evicts on `consume()`, so an issued-but-
 *     never-verified nonce (a bot probing the endpoint, a user who closes the
 *     tab) lives in the Map forever. We sweep expired entries on issue.
 *
 * Swap back to the upstream store if it ever takes a nonce factory and evicts.
 *
 * In-memory is sufficient because explore runs a single api process; nonces
 * are short-lived and re-issued on demand, so a restart losing the set just
 * means in-flight challenges are re-fetched. (The former Postgres-backed
 * `auth_nonces` table is unused — `viem/siwe` owns the message, this owns the
 * single-use state.) For a multi-instance api, back `NonceStore` with Redis.
 */

const NONCE_TTL_SECONDS = 5 * 60;

/**
 * 32 bytes = 256 bits, hex-encoded to 64 chars. Hex keeps us inside the
 * `/^[a-zA-Z0-9]{8,}$/` grammar that viem's `createSiweMessage` enforces and
 * `parseSiweMessage` parses back out.
 */
const NONCE_BYTES = 32;

/**
 * Drop every entry whose expiry has passed. Returns the number removed.
 *
 * Pure and exported for tests: it is the only part of the store with logic
 * worth asserting independently of a clock.
 */
export function sweepExpired(issued: Map<string, number>, nowMs: number): number {
  let dropped = 0;
  for (const [nonce, expiresAt] of issued) {
    if (expiresAt < nowMs) {
      issued.delete(nonce);
      dropped++;
    }
  }
  return dropped;
}

/** `NonceStore` plus the entry count, which the contract does not expose. */
export interface SweepingNonceStore extends NonceStore {
  /** Live entry count. For tests + diagnostics, not for auth decisions. */
  size(): number;
}

export function createNonceStore(
  opts: {
    ttlSeconds?: number;
    /** Injectable clock; tests drive expiry without waiting. */
    now?: () => number;
    /** Injectable minter; tests can force collisions. Defaults to a CSPRNG. */
    mintNonce?: () => string;
  } = {},
): SweepingNonceStore {
  const ttlMs = (opts.ttlSeconds ?? NONCE_TTL_SECONDS) * 1000;
  const now = opts.now ?? Date.now;
  const mintNonce = opts.mintNonce ?? (() => randomBytes(NONCE_BYTES).toString("hex"));

  /** nonce -> expiresAt (ms epoch) */
  const issued = new Map<string, number>();
  let lastSweepMs = now();

  return {
    issue() {
      const nowMs = now();
      // Amortized O(1): a full pass at most once per TTL window, so the Map
      // holds at most ~one window's worth of unconsumed challenges.
      if (nowMs - lastSweepMs >= ttlMs) {
        sweepExpired(issued, nowMs);
        lastSweepMs = nowMs;
      }
      const nonce = mintNonce();
      issued.set(nonce, nowMs + ttlMs);
      return nonce;
    },

    consume(nonce: string) {
      const expiresAt = issued.get(nonce);
      if (expiresAt === undefined) return false;
      // Delete BEFORE the time check: a concurrent second consume of the same
      // nonce finds nothing, so a race-loser cannot reuse it.
      issued.delete(nonce);
      return expiresAt >= now();
    },

    size() {
      return issued.size;
    },
  };
}

const store = createNonceStore({ ttlSeconds: NONCE_TTL_SECONDS });

export async function issueNonce(): Promise<{ nonce: string; expiresAt: number }> {
  const nonce = store.issue();
  return { nonce, expiresAt: Date.now() + NONCE_TTL_SECONDS * 1000 };
}

/**
 * Single-use consume: `true` only when the nonce was issued, unexpired, and
 * not yet consumed.
 */
export async function consumeNonce(nonce: string): Promise<boolean> {
  return store.consume(nonce);
}
