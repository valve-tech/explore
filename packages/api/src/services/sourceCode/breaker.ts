/**
 * A minimal circuit breaker for the verification upstreams.
 *
 * Why this exists: `getVerifiedSource` deliberately refuses to negative-cache
 * an address when an upstream failed rather than answered — otherwise a
 * transient outage cements as a 10-minute "not verified" lie. That is the
 * right call for a BRIEF outage, but it has a nasty failure mode when an
 * upstream is PERSISTENTLY dead: nothing is ever cached, so every request
 * re-pays that upstream's full connect timeout for every unverified address.
 * With `api.scan.pulsechain.com` unreachable that was ~10.5s per address, and
 * a router tx touching several unverified contracts blew the route's 15s
 * budget and 504'd.
 *
 * The breaker keeps the honesty guarantee (a skipped upstream still counts as
 * "did not answer", so we still never negative-cache off it) while paying the
 * timeout once per cooldown instead of once per address.
 *
 * Deliberately per-process and in-memory: it's a latency guard, not a
 * correctness mechanism, so a restart or a second replica re-probing costs one
 * timeout and nothing else.
 */

/** Consecutive transport failures before the circuit opens. */
export const BREAKER_THRESHOLD = 2;

/** How long the circuit stays open before we probe the upstream again. */
export const BREAKER_COOLDOWN_MS = 60_000;

export interface BreakerState {
  failures: number;
  openedAt: number | null;
}

export function createBreakerState(): BreakerState {
  return { failures: 0, openedAt: null };
}

/**
 * Should we skip this upstream right now? Pure — the clock is injected so the
 * cooldown is testable without waiting.
 */
export function isOpen(state: BreakerState, nowMs: number): boolean {
  if (state.openedAt === null) return false;
  if (nowMs - state.openedAt >= BREAKER_COOLDOWN_MS) return false; // cooled down → probe again
  return true;
}

/** Record a transport failure; opens the circuit at the threshold. */
export function recordFailure(state: BreakerState, nowMs: number): void {
  state.failures += 1;
  if (state.failures >= BREAKER_THRESHOLD) {
    state.openedAt = nowMs;
  }
}

/** Record any definitive answer — the upstream is alive; reset everything. */
export function recordSuccess(state: BreakerState): void {
  state.failures = 0;
  state.openedAt = null;
}

/**
 * Called when a probe is allowed through after a cooldown: clear the open
 * marker so a single failure doesn't immediately re-open on a stale count,
 * but keep us one failure away from re-opening if it's still dead.
 */
export function halfOpen(state: BreakerState): void {
  state.openedAt = null;
  state.failures = BREAKER_THRESHOLD - 1;
}
