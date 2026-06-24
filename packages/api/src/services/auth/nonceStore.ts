import { createMemoryNonceStore } from "@valve-tech/siwe-store";

/**
 * Single-use SIWE nonce store for the challenge flow.
 *
 * Backed by `@valve-tech/siwe-store`'s in-memory store (which pairs with
 * `viem/siwe`): `issue()` mints a fresh `generateSiweNonce()` and remembers
 * it; `consume()` validates + deletes in one shot (delete-before-TTL-check),
 * so a replay or a race-loser sees `false`. Both failure modes (unknown /
 * already-used / expired) collapse to `false` without distinguishing — the
 * desired behaviour for an auth primitive.
 *
 * In-memory is sufficient because explore runs a single api process; nonces
 * are short-lived (5 min) and re-issued on demand, so a restart losing the
 * set just means in-flight challenges are re-fetched. (The former
 * Postgres-backed `auth_nonces` table is now unused — `viem/siwe` owns the
 * nonce, `siwe-store` owns the single-use state.) For a multi-instance api,
 * swap `createMemoryNonceStore` for a Redis/SQL `NonceStore` implementation.
 */

const NONCE_TTL_SECONDS = 5 * 60;

const store = createMemoryNonceStore({ ttlSeconds: NONCE_TTL_SECONDS });

export async function issueNonce(): Promise<{ nonce: string; expiresAt: number }> {
  const nonce = store.issue();
  return { nonce, expiresAt: Date.now() + NONCE_TTL_SECONDS * 1000 };
}

/**
 * Single-use consume: `true` only when the nonce was issued, unexpired, and
 * not yet consumed. The store deletes on lookup, so a concurrent verify on
 * the same nonce sees `false`.
 */
export async function consumeNonce(nonce: string): Promise<boolean> {
  return store.consume(nonce);
}

/**
 * Retained as a no-op for the periodic vacuum worker: the in-memory store
 * self-expires, so there is nothing to sweep. Kept so `nonceVacuum.ts` and
 * its wiring don't need to change in this migration.
 */
export async function vacuumExpiredNonces(): Promise<number> {
  return 0;
}
