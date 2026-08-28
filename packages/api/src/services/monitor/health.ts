/**
 * Health for the alert matchers that can FAIL rather than simply not match.
 *
 * Most matchers are pure: they read the block's transactions and logs and
 * either match or do not. Two are not — `matchBalanceThreshold` and
 * `matchFailedTx` both call the chain, and both used to fold an RPC failure
 * into `return null`, which is the same value they return for "no match".
 *
 * That makes an outage invisible in the worst possible way. A balance alert
 * whose `getBalance` is failing does not error, does not warn the owner and
 * does not fire — it looks exactly like an address whose balance never crossed
 * the threshold. The alert appears healthy right up until someone notices it
 * never went off for something it should have caught.
 *
 * `null` still means "no match", because every caller depends on that. What
 * changes is that a failure is now RECORDED as well as swallowed, so
 * "checked and did not match" and "could not check" stop being the same
 * observable state.
 */

/** How many consecutive failures before a check counts as broken, not flaky. */
export const UNHEALTHY_AFTER_FAILURES = 3;

/** Keep the map bounded — the same FIFO trim the appearance caches use. */
const MAX_TRACKED = 500;

export interface CheckHealth {
  /** Consecutive failures. Zero once a check succeeds again. */
  consecutiveFailures: number;
  /** Epoch ms of the most recent failure, or null if it has never failed. */
  lastFailureAt: number | null;
  /** Message of the most recent failure. Never the raw error object. */
  lastError: string | null;
  /** Epoch ms of the most recent success, or null if it has never succeeded. */
  lastSuccessAt: number | null;
}

const checks = new Map<string, CheckHealth>();

function key(kind: string, subject: string): string {
  return `${kind}:${subject.toLowerCase()}`;
}

function trim(): void {
  if (checks.size <= MAX_TRACKED) return;
  const oldest = checks.keys().next().value;
  if (oldest !== undefined) checks.delete(oldest);
}

function entry(k: string): CheckHealth {
  const existing = checks.get(k);
  if (existing !== undefined) return existing;
  const fresh: CheckHealth = {
    consecutiveFailures: 0,
    lastFailureAt: null,
    lastError: null,
    lastSuccessAt: null,
  };
  checks.set(k, fresh);
  trim();
  return fresh;
}

/**
 * Record that a chain-touching check could not complete.
 *
 * The message is kept, never the error object: these strings can reach a
 * status endpoint, and a viem transport error carries the full request URL —
 * which for us holds the RPC key in its path.
 */
export function recordCheckFailure(
  kind: string,
  subject: string,
  err: unknown,
  now: number = Date.now(),
): void {
  const e = entry(key(kind, subject));
  e.consecutiveFailures += 1;
  e.lastFailureAt = now;
  e.lastError = err instanceof Error ? err.message : String(err);
}

/** Record that a check completed — whether or not it matched. */
export function recordCheckSuccess(
  kind: string,
  subject: string,
  now: number = Date.now(),
): void {
  const e = entry(key(kind, subject));
  e.consecutiveFailures = 0;
  e.lastSuccessAt = now;
}

/**
 * True once a check has failed enough times in a row to be called broken.
 *
 * One failure is a blip — an RPC hiccup between blocks is ordinary and
 * self-corrects. A run of them means the alert has stopped working, and the
 * distinction is what keeps this from crying wolf on every transient.
 */
export function isCheckUnhealthy(kind: string, subject: string): boolean {
  const e = checks.get(key(kind, subject));
  return (e?.consecutiveFailures ?? 0) >= UNHEALTHY_AFTER_FAILURES;
}

/** One check's health, or `null` if it has never been seen. */
export function getCheckHealth(kind: string, subject: string): CheckHealth | null {
  return checks.get(key(kind, subject)) ?? null;
}

/**
 * Everything currently unhealthy, for a status endpoint or an operator.
 *
 * Returns only the broken ones: a list that is empty when all is well is far
 * easier to act on than one that must be scanned for a bad row.
 */
export function unhealthyChecks(): Array<{ check: string } & CheckHealth> {
  const out: Array<{ check: string } & CheckHealth> = [];
  for (const [k, v] of checks) {
    if (v.consecutiveFailures >= UNHEALTHY_AFTER_FAILURES) {
      out.push({ check: k, ...v });
    }
  }
  return out;
}

/** Test helper — drops all recorded health. */
export function _resetMonitorHealth(): void {
  checks.clear();
}
