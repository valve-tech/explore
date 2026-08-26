/**
 * A bound on the chifra reads a request may start.
 *
 * `warmIndex.ts` already caps BACKGROUND warms at two. Nothing capped the
 * request-bound reads, and those are the ones that arrive in bulk: every
 * browser tab on a heavy address starts its own.
 *
 * That is not a throughput problem. It is how the indexer dies. Measured on
 * the box 2026-08-26, chifra loads a whole monitor into memory to answer any
 * query on it — `maxRecords`, `firstBlock`/`lastBlock` and `--count` all fail
 * to bound the work — and it needs roughly 28x the file size in RAM to do it.
 * WPLS on chain 369 is a 1.8 GB monitor of 224.7M appearances:
 *
 *   raw `dd` of the same bytes        0.70s cold, 0.20s warm
 *   through chifra                    44-69s
 *   `--count`                         >300s, killed, returned nothing
 *   a 100-block window                90s timeout, zero bytes
 *
 * A few concurrent reads of it drove `chifra daemon` to 50.5 GB resident on a
 * 62 GB box and the kernel OOM-killed it:
 *
 *   Out of memory: Killed process 2915960 (chifra)
 *   total-vm:95984264kB, anon-rss:52972520kB
 *
 * Two things make repeat traffic compound instead of coalesce. A client
 * timeout does NOT cancel chifra's work — our 30s deadline stops us waiting,
 * not the daemon working, and a killed request kept writing for hours
 * afterwards. And an address that fails is refetched immediately. So each
 * retry ADDS a 50 GB read rather than replacing one.
 *
 * This module stops that on our side of the wire, two ways:
 *
 *   1. An address that just timed out is known-expensive. Further
 *      request-bound reads of it short-circuit for a cooldown instead of
 *      starting work the daemon is already doing.
 *   2. A global cap on concurrent request-bound reads, so a spread of
 *      distinct heavy addresses cannot do what one address cannot.
 *
 * Neither replaces the real fix. Chifra's read path is the wrong way to ask
 * this question at all: the index's own `unripe`/`staging` tiers answer the
 * same query in ~14ms by grep, and the monitor file's last 25 records are a
 * 24-byte seek. This module is the guard rail until that lands.
 */

/**
 * How long an address stays known-expensive after a read of it times out.
 *
 * Matched to `WARM_COOLDOWN_MS`: a timeout schedules a warm, and the warm owns
 * that address until it finishes or the cooldown lapses. Short-circuiting for
 * the same window means the two never race for the same monitor.
 */
export const HEAVY_COOLDOWN_MS = 5 * 60_000;

/**
 * How many request-bound chifra reads may be in flight at once.
 *
 * Deliberately small. The daemon's memory is the scarce resource, not its CPU
 * — four concurrent reads of mid-size monitors are fine, and four of WPLS
 * would still exceed the box. The per-address short-circuit above is what
 * actually stops the pathological case; this is the backstop for the case it
 * cannot see, where every request names a different heavy address.
 */
export const MAX_CONCURRENT_INDEX_READS = 4;

/** Addresses whose last request-bound read ran out of time, keyed `chain:address`. */
const timedOutAt = new Map<string, number>();

/** Request-bound reads currently in flight. */
let inFlight = 0;

function key(chain: string, address: string): string {
  return `${chain}:${address.toLowerCase()}`;
}

/**
 * Trim the timeout map the same FIFO way the appearance caches do. Only a
 * bounded number of addresses can be heavy at once, and an entry older than
 * the cooldown is already inert.
 */
function trim(): void {
  if (timedOutAt.size <= 500) return;
  const oldest = timedOutAt.keys().next().value;
  if (oldest !== undefined) timedOutAt.delete(oldest);
}

/**
 * Remember that a request-bound read of this address ran out of time.
 *
 * Only call this for a genuine timeout. A daemon that is unreachable is not an
 * expensive address, and marking it heavy would suppress reads that would
 * succeed the moment it came back.
 */
export function noteIndexTimeout(
  chain: string,
  address: string,
  now: number = Date.now(),
): void {
  timedOutAt.set(key(chain, address), now);
  trim();
}

/**
 * Forget that an address was ever expensive. Called when a read of it
 * succeeds — a warm finished, or the monitor was small all along and the
 * timeout was the daemon having a bad minute.
 */
export function clearIndexTimeout(chain: string, address: string): void {
  timedOutAt.delete(key(chain, address));
}

/**
 * True when this address timed out recently enough that another request-bound
 * read would pile onto work already in progress.
 *
 * The caller should treat this exactly like the timeout it stands in for: it
 * IS the same condition, reported without spending another 50 GB to rediscover
 * it. The reader still gets a 503 and a Retry, and the retry still lands on a
 * warm index — the only thing removed is the duplicate read.
 */
export function isKnownHeavy(
  chain: string,
  address: string,
  now: number = Date.now(),
): boolean {
  const at = timedOutAt.get(key(chain, address));
  if (at === undefined) return false;
  if (now - at >= HEAVY_COOLDOWN_MS) {
    timedOutAt.delete(key(chain, address));
    return false;
  }
  return true;
}

/**
 * Take one of the request-bound read slots, or report that none is free.
 *
 * Returns `true` when the caller owns a slot and MUST release it. Returns
 * `false` when the caller must not call chifra at all.
 */
export function acquireReadSlot(): boolean {
  if (inFlight >= MAX_CONCURRENT_INDEX_READS) return false;
  inFlight += 1;
  return true;
}

/** Give back a slot taken by `acquireReadSlot`. Always call this in a `finally`. */
export function releaseReadSlot(): void {
  if (inFlight > 0) inFlight -= 1;
}

/** How many request-bound reads are in flight. For logging and tests. */
export function inFlightReads(): number {
  return inFlight;
}

/**
 * The error a short-circuited read reports.
 *
 * Shaped as a gateway timeout on purpose: `isIndexTimeout` already recognises
 * 504, so every existing failure path — the 503 the address page renders, the
 * warm it schedules — behaves identically whether the timeout came from the
 * daemon or from this guard. A new error shape would have needed all of them
 * taught about it.
 */
export function heavyReadSkipped(reason: "known-heavy" | "at-capacity"): Error {
  return Object.assign(
    new Error(
      reason === "known-heavy"
        ? "The appearance index for this address is already being read."
        : "Too many appearance index reads in flight.",
    ),
    { status: 504, skippedBy: reason },
  );
}

/**
 * Run one request-bound chifra read under the guard.
 *
 * Refuses before spending anything when the address is known-expensive or
 * every slot is busy, and remembers the outcome so the next caller inherits
 * what this one learned. Both refusals throw the gateway-timeout shape above,
 * so every existing failure path applies unchanged.
 *
 * `isTimeout` is injected rather than imported so the ordering guarantees
 * below can be tested without a chifra client.
 */
export async function guardedIndexRead<T>(
  chain: string,
  address: string,
  run: () => Promise<T>,
  isTimeout: (err: unknown) => boolean,
  now: () => number = Date.now,
): Promise<T> {
  if (isKnownHeavy(chain, address, now())) throw heavyReadSkipped("known-heavy");
  // Acquire AFTER the cheap check, so a short-circuit never holds a slot.
  if (!acquireReadSlot()) throw heavyReadSkipped("at-capacity");
  try {
    const value = await run();
    // It answered, so it is not expensive — whatever an earlier timeout said.
    clearIndexTimeout(chain, address);
    return value;
  } catch (err) {
    if (isTimeout(err)) noteIndexTimeout(chain, address, now());
    throw err;
  } finally {
    releaseReadSlot();
  }
}

/** Test helper — drops all guard bookkeeping. */
export function _resetHeavyGuard(): void {
  timedOutAt.clear();
  inFlight = 0;
}
