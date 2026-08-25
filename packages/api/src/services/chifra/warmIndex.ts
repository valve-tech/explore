/**
 * Background warming for chifra's appearance index.
 *
 * A cold index read on a heavy address costs far more than one HTTP request
 * can wait for — but the first attempt does the expensive work whether or not
 * anybody is still listening, and every later read is cheap. Measured
 * 2026-08-25 against chifra.valve.city on chain 369, three untouched monitors,
 * each read as `list --reversed --max_records 25`:
 *
 *   30.6M appearances  1st: HTTP 524 at 125.5s   2nd: 33.8s   3rd:  7.3s
 *   31.5M appearances  1st: HTTP 524 at 125.2s   2nd: 22.7s   3rd:  7.2s
 *   43.7M appearances  1st: HTTP 524 at 125.2s   2nd: 73.6s   3rd: 10.4s
 *
 * The 524 is Cloudflare's origin timeout — chifra.valve.city sits behind it,
 * so no caller can wait longer than about 100s however patient it is.
 *
 * A user-facing read gets 30s and the browser gives up at 40s, so a first read
 * of a heavy address can only ever fail. Left alone it fails forever: each
 * retry starts another 30s slice, and 30s is not enough to finish the work.
 * This module fixes that by letting one long read run OUTSIDE the request. The
 * user gets the 503 and a Retry button; the warm keeps going; the retry lands
 * on a warm index and answers in single digits.
 *
 * Nothing here reads the result. The value is the side effect on chifra's own
 * caches, so the promise is deliberately discarded.
 */

/** How long one background warm may run. */
export const WARM_TIMEOUT_MS = 120_000;

/**
 * How long to leave an address alone after a warm finishes. A warm is
 * expensive for the daemon, and a page that fails is refetched often — without
 * a cooldown one slow address would start a warm every 30s forever.
 */
export const WARM_COOLDOWN_MS = 5 * 60_000;

/**
 * How many warms may run at once. The whole point is to spend the daemon's
 * time on ONE address until it is warm; letting a dozen pile up would starve
 * every one of them and every ordinary read besides.
 */
export const MAX_CONCURRENT_WARMS = 2;

/** HTTP statuses that mean "the read ran out of time", not "the daemon is gone". */
const TIMEOUT_STATUSES = new Set([408, 502, 504, 524]);

/**
 * True when a failed chifra read ran out of time rather than failing to
 * connect.
 *
 * Only a timeout earns a warm. If the daemon is unreachable — DNS, refused
 * connection, a 500 from the app itself — a longer read fails the same way,
 * and starting one would both waste the daemon's time and let the address page
 * promise a retry that cannot work.
 *
 * The SDK wraps transport failures in a `TrueblocksError` and keeps the
 * original on `cause`, so the timeout shows up one level down: our own
 * `AbortSignal.timeout` rejects the fetch with a `TimeoutError` DOMException.
 * Chromium names the same condition `AbortError`; nothing else in this file
 * aborts a read, so either name means the deadline.
 */
export function isIndexTimeout(err: unknown): boolean {
  const status = (err as { status?: unknown } | null)?.status;
  if (typeof status === "number") return TIMEOUT_STATUSES.has(status);
  const cause = (err as { cause?: unknown } | null)?.cause;
  const name = (cause as { name?: unknown } | null)?.name;
  return name === "TimeoutError" || name === "AbortError";
}

export type WarmOutcome =
  /** A background read started for this address. */
  | "started"
  /** A warm for this address is already running. */
  | "in-flight"
  /** This address was warmed recently; leave the daemon alone. */
  | "cooling"
  /** Too many warms already running. */
  | "at-capacity";

export interface WarmDeps {
  /** Runs the long read. Resolves or rejects — the outcome is not used. */
  run: (chain: string, address: string) => Promise<unknown>;
  now: () => number;
}

/**
 * How many warms may fail on one address before we stop telling its reader to
 * try again. Some addresses never converge — WPLS on chain 369 holds 224.7M
 * appearances and failed three consecutive ~125s reads — and repeating a
 * retry that cannot work is the same lie as "no transactions found".
 */
export const HOPELESS_AFTER_FAILURES = 2;

/** In-flight and recently-finished warms, keyed by `chain:address`. */
const inFlight = new Set<string>();
const lastFinished = new Map<string, number>();
const consecutiveFailures = new Map<string, number>();

function warmKey(chain: string, address: string): string {
  return `${chain}:${address.toLowerCase()}`;
}

/**
 * Ask for a background warm of one address's appearance index.
 *
 * Returns immediately and never throws: the caller is on an error path
 * already, and a failed warm must not turn a 503 into a 500.
 */
export function scheduleIndexWarm(
  chain: string,
  address: string,
  deps: WarmDeps,
): WarmOutcome {
  const key = warmKey(chain, address);
  if (inFlight.has(key)) return "in-flight";

  const finished = lastFinished.get(key);
  if (finished !== undefined && deps.now() - finished < WARM_COOLDOWN_MS) {
    return "cooling";
  }
  if (inFlight.size >= MAX_CONCURRENT_WARMS) return "at-capacity";

  inFlight.add(key);
  const settle = (failed: boolean) => {
    inFlight.delete(key);
    lastFinished.set(key, deps.now());
    if (failed) {
      consecutiveFailures.set(key, (consecutiveFailures.get(key) ?? 0) + 1);
    } else {
      consecutiveFailures.delete(key);
    }
    // These maps are the only thing that grows without bound, so trim them the
    // same FIFO way the appearance caches do.
    if (lastFinished.size > 500) {
      const oldest = lastFinished.keys().next().value;
      if (oldest !== undefined) lastFinished.delete(oldest);
    }
    if (consecutiveFailures.size > 500) {
      const oldest = consecutiveFailures.keys().next().value;
      if (oldest !== undefined) consecutiveFailures.delete(oldest);
    }
  };

  // `void` on purpose: this promise outlives the request that started it.
  void deps.run(chain, address).then(
    () => settle(false),
    () => settle(true),
  );
  return "started";
}

/** True while a warm for this address is running. */
export function isWarming(chain: string, address: string): boolean {
  return inFlight.has(warmKey(chain, address));
}

/**
 * True once this address has failed enough warms that another retry is not
 * worth promising. The address page uses it to stop offering hope it cannot
 * deliver.
 */
export function isWarmHopeless(chain: string, address: string): boolean {
  const failures = consecutiveFailures.get(warmKey(chain, address)) ?? 0;
  return failures >= HOPELESS_AFTER_FAILURES;
}

/** Test helper — drops all warm bookkeeping. */
export function _resetIndexWarms(): void {
  inFlight.clear();
  lastFinished.clear();
  consecutiveFailures.clear();
}
