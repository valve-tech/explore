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
 * Once OPEN it stays skipped for user requests entirely — the re-probe runs
 * detached (see getVerifiedSource.scheduleProbe), so no request ever waits on
 * an upstream already known to be dead. That is the difference between "one
 * slow request per minute, forever" and "one slow request per process".
 *
 * Deliberately per-process and in-memory: it's a latency guard, not a
 * correctness mechanism, so a restart or a second replica re-probing costs one
 * timeout and nothing else.
 */

/** Consecutive transport failures before the circuit opens. */
export const BREAKER_THRESHOLD = 2;

/** How long the circuit stays open before a background probe is scheduled. */
export const BREAKER_COOLDOWN_MS = 60_000;

export interface BreakerState {
  failures: number;
  openedAt: number | null;
}

export function createBreakerState(): BreakerState {
  return { failures: 0, openedAt: null };
}

/**
 * Skip this upstream for a user request? True whenever the circuit is open —
 * INCLUDING after the cooldown has elapsed. A cooled-down circuit is re-probed
 * in the background rather than by making a caller wait; the probe's result is
 * what closes it.
 */
export function shouldSkip(state: BreakerState): boolean {
  return state.openedAt !== null;
}

/** Open, and quiet long enough that it's worth probing again (in background). */
export function isCooledDown(state: BreakerState, nowMs: number): boolean {
  return state.openedAt !== null && nowMs - state.openedAt >= BREAKER_COOLDOWN_MS;
}

/** Record a transport failure; opens the circuit at the threshold. */
export function recordFailure(state: BreakerState, nowMs: number): void {
  // Clamp: once open, `failures` has done its job. Letting it grow unbounded
  // would be a slow leak of meaning, not of memory — the number stops being
  // "consecutive failures" and starts being "total ever".
  state.failures = Math.min(state.failures + 1, BREAKER_THRESHOLD);
  if (state.failures >= BREAKER_THRESHOLD) {
    state.openedAt = nowMs;
  }
}

/** Record any definitive answer — the upstream is alive; reset everything. */
export function recordSuccess(state: BreakerState): void {
  state.failures = 0;
  state.openedAt = null;
}
