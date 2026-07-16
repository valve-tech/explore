import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Request-scoped "was verified-source lookup degraded?" flag.
 *
 * The decode route needs to tell "this contract isn't verified" (a definitive
 * empty answer) apart from "we couldn't reach the verifier" (an outage). Since
 * fetchAbi collapses both into `null`, getVerifiedSource marks degradation here
 * whenever a lookup can't get a definitive answer — an upstream threw, or its
 * circuit breaker was open and the lookup was skipped.
 *
 * Only the decode route opts in (via withDegradationTracking); every other
 * caller runs outside the store, where markDegraded() is a no-op — so the
 * normal /tx render path is completely unaffected.
 *
 * Known narrow gap (acceptable): fetchAbi coalesces concurrent lookups for the
 * same (chainId, address) onto one in-flight promise. If a decode build inside
 * this scope coalesces onto a promise created by a DIFFERENT request's async
 * context, that lookup's markDegraded() runs in the other scope, so this build
 * can under-report degraded. It only bites in the ~2-failure window before an
 * upstream's breaker opens — once open, every lookup takes the synchronous skip
 * path and marks reliably. The error is strictly under-reporting (never a false
 * positive), and a reload retries, consistent with keeping decode failures
 * non-persistent. Not worth coupling to fetchAbi's internals to close.
 */
const store = new AsyncLocalStorage<{ degraded: boolean }>();

/** Run `fn` in a fresh tracking scope; returns its result plus whether any
 *  lookup inside it was degraded. */
export async function withDegradationTracking<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; degraded: boolean }> {
  const flag = { degraded: false };
  const result = await store.run(flag, fn);
  return { result, degraded: flag.degraded };
}

/** Mark the current tracking scope degraded. No-op outside a scope. */
export function markDegraded(): void {
  const flag = store.getStore();
  if (flag) flag.degraded = true;
}
