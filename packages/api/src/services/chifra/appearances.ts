/**
 * Address appearance index via chifra `/list`, through the typed
 * @valve-tech/trueblocks-sdk client (same client style as transfers.ts).
 * An appearance is a (blockNumber, transactionIndex) pair for every tx an
 * address shows up in — a much lighter read than the log walks in
 * transfers.ts. Callers hydrate the pairs into full transactions through our
 * own RPC.
 *
 * **It is not "cheap" on a heavy address, and this file used to say it was.**
 * `chifra list` brings the address's monitor file up to head before it pages
 * it, and that catch-up is the bill — it dominates everything else on the
 * page. Measured 2026-08-25 against chifra.valve.city on chain 369
 * (`list --reversed --max_records 25`, first read of the day for each
 * address):
 *
 *        52 appearances       1.8s
 *    92,572 appearances       1.7s
 *   526,139 appearances       1.9s
 *   5.3M    appearances       2.7s
 *   30.6M   appearances     125.5s  -> HTTP 524
 *   31.5M   appearances     125.2s  -> HTTP 524
 *   43.7M   appearances     125.2s  -> HTTP 524
 *   224.7M  appearances     125.6s  -> HTTP 524   (WPLS, 0xA1077a…9a27)
 *
 * Size is only a proxy for the backlog, so do not read that table as a rule:
 * 0x28c6c0… holds 22.55M appearances and answered cold in 10.8s, while
 * 0x95b303… holds 23.9M and needed four attempts. What differs is how far
 * behind head each monitor had fallen.
 *
 * `firstRecord`/`maxRecords` do not rescue the big ones — they page the
 * monitor AFTER the freshen — and the OpenAPI spells out that `firstBlock`
 * and `lastBlock` are "ignored when freshening". A block-bounded read of WPLS
 * measured 125.5s, identical to the unbounded one.
 *
 * See `warmIndex.ts` for what we do about it.
 *
 * Results cache briefly (30s) per (chain, address, page) — long enough to
 * absorb a UI's refetch bursts, short enough that a new tx shows up on the
 * next page load.
 */

import { createTrueblocksClient } from "@valve-tech/trueblocks-sdk";
import { currentChain } from "../chains/context.js";
import {
  isIndexTimeout,
  scheduleIndexWarm,
  WARM_TIMEOUT_MS,
} from "./warmIndex.js";
import { guardedIndexRead } from "./heavyGuard.js";
import {
  fetchAppearances,
  isCompleteAnswer,
  isTrustworthyPage,
} from "./appearanceReader.js";

const CHIFRA_BASE = process.env.CHIFRA_BASE_URL || "https://chifra.valve.city";

/**
 * The budget for a read a browser is waiting on. The SDK has no built-in
 * timeout, so bound each request via the injected fetch (mirrors
 * transfers.ts). It stays at 30s because the address page gives up at 40s —
 * raising it here would only move the failure, not remove it.
 */
const CHIFRA_TIMEOUT_MS = 30_000;

function makeClient(timeoutMs: number) {
  return createTrueblocksClient({
    baseUrl: CHIFRA_BASE,
    fetch: (input, init) =>
      fetch(input, { ...init, signal: AbortSignal.timeout(timeoutMs) }),
  });
}

const client = makeClient(CHIFRA_TIMEOUT_MS);

/**
 * A second client for background warms only. Nobody waits on it, so it may
 * run far past the request that started it.
 */
const warmClient = makeClient(WARM_TIMEOUT_MS);

/**
 * Start the long read that a request-bound one cannot finish. Called from the
 * failure paths below, where we have just proved this address needs it — but
 * only when the read timed out. A daemon that cannot be reached is not warmed.
 */
function warmAppearanceIndex(
  chain: string,
  address: string,
  err: unknown,
): void {
  if (!isIndexTimeout(err)) return;
  // A read we skipped for want of a slot taught us nothing about THIS address
  // — it was queued behind other addresses, not proved slow. Warming on that
  // would spend two minutes of the daemon on an address that may be tiny.
  if ((err as { skippedBy?: unknown })?.skippedBy === "at-capacity") return;
  const outcome = scheduleIndexWarm(chain, address, {
    run: (c, a) =>
      warmClient.list({
        addrs: [a],
        chain: c,
        reversed: true,
        firstRecord: 0,
        maxRecords: 25,
      }),
    now: () => Date.now(),
  });
  // A warm is invisible from the outside — it answers nobody and returns
  // nothing — so say when one starts. Without this, a box quietly spending two
  // minutes on one address looks idle.
  if (outcome === "started") {
    console.warn(
      `[chifra] warming the appearance index for ${chain}:${address.toLowerCase()} (up to ${WARM_TIMEOUT_MS / 1000}s)`,
    );
  }
}

/**
 * Run one request-bound chifra read under the guard.
 *
 * Chifra loads a whole monitor into memory to answer any query on it, and a
 * client timeout does not cancel that work — so a retry ADDS a read rather
 * than replacing one. Concurrent reads of a heavy monitor OOM-killed the
 * daemon on 2026-08-26 at 50.5 GB resident. See `heavyGuard.ts` for the
 * measurements and the ordering guarantees.
 */
const guarded = <T>(
  chain: string,
  address: string,
  run: () => Promise<T>,
): Promise<T> => guardedIndexRead(chain, address, run, isIndexTimeout);

const APPEARANCE_TTL_MS = 30_000;
const appearanceCache = new Map<
  string,
  { value: Appearance[]; t: number }
>();
const countCache = new Map<string, { value: number | null; t: number }>();

export interface Appearance {
  blockNumber: number;
  transactionIndex: number;
}

/**
 * Latest-first appearances for an address, paged. Returns `[]` for an
 * address chifra has never seen (and on chifra outage — address history
 * is a degradable feature, not a request-fatal one).
 */
export async function listAppearances(
  address: string,
  page: number = 1,
  limit: number = 25,
): Promise<Appearance[]> {
  const chain = currentChain().chifraChain;
  const cacheKey = `${chain}:${address.toLowerCase()}:${page}:${limit}`;
  const cached = appearanceCache.get(cacheKey);
  if (cached && Date.now() - cached.t < APPEARANCE_TTL_MS) return cached.value;

  // The sidecar reads the index files directly and answers in milliseconds.
  // Trust it per PAGE, not per response: a gap has a position, so rows above
  // it come from the per-block tiers and are exact even when the total is not.
  // Requiring the whole response to be complete made WPLS 503 again — the
  // exact failure the sidecar exists to prevent. See `isTrustworthyPage`.
  const fromReader = await fetchAppearances(chain, address, page, limit);
  if (fromReader !== null && isTrustworthyPage(fromReader)) {
    appearanceCache.set(cacheKey, {
      value: fromReader.appearances,
      t: Date.now(),
    });
    return fromReader.appearances;
  }

  try {
    const res = await guarded(chain, address, () =>
      client.list({
        addrs: [address],
        chain,
        reversed: true,
        // chifra's firstRecord is 0-based (verified against the live daemon).
        firstRecord: (page - 1) * limit,
        maxRecords: limit,
      }),
    );

    // `/list` returns an (appearance | bounds | monitor) union; keep only the
    // appearance rows — those carrying a numeric block + transaction index.
    const appearances: Appearance[] = (res.data ?? []).flatMap((row) => {
      const blockNumber = (row as { blockNumber?: unknown }).blockNumber;
      const transactionIndex = (row as { transactionIndex?: unknown })
        .transactionIndex;
      return typeof blockNumber === "number" &&
        typeof transactionIndex === "number"
        ? [{ blockNumber, transactionIndex }]
        : [];
    });

    appearanceCache.set(cacheKey, { value: appearances, t: Date.now() });
    if (appearanceCache.size > 500) {
      const oldest = appearanceCache.keys().next().value;
      if (oldest !== undefined) appearanceCache.delete(oldest);
    }
    return appearances;
  } catch (err) {
    // This address just proved it cannot be read inside a request. Start the
    // long read now so the reader's Retry lands on a warm index.
    warmAppearanceIndex(chain, address, err);
    return [];
  }
}

/**
 * Total number of appearances for an address — chifra's `list --count`, so a
 * paged list can report a real total instead of just the page size. Returns
 * `null` on outage so the caller can fall back gracefully. Cached briefly per
 * (chain, address), like `listAppearances`.
 *
 * This is NOT the cheap half of the pair, whatever an older comment here
 * claimed. It freshens the same monitor a paged read does, and it costs the
 * same order: measured 2026-08-25, `--count` returned HTTP 524 at ~125s on
 * every monitor above 30M appearances, exactly like the paged read did.
 */
/**
 * True appearance count from a `chifra list --count` row `{ fileSize, nRecords }`.
 *
 * The TrueBlocks appearance file is a fixed 8-byte HEADER followed by 8-byte
 * records (blockNumber uint32 + transactionIndex uint32), so the record count
 * is `fileSize / 8 - 1`. The header cost was previously missed
 * (`Math.floor(fileSize / 8)`), which over-counted every address by exactly one
 * — the address page then reported a phantom extra transaction and enabled a
 * "Next" into a short or empty page. Verified against the live daemon: 344→42,
 * 144→17 (both uncapped, both nRecords-exact).
 *
 * `fileSize` is preferred over `nRecords` because `nRecords` is capped at the
 * daemon's maxRecords (250) — useless for large addresses — while `fileSize` is
 * the uncapped on-disk size. `nRecords` is used only when `fileSize` is absent.
 */
export function appearanceCountFromRow(
  row: { fileSize?: number; nRecords?: number } | undefined,
): number | null {
  if (!row) return null;
  if (typeof row.fileSize === "number") {
    return Math.max(0, Math.floor(row.fileSize / 8) - 1);
  }
  return row.nRecords ?? null;
}

/**
 * True when an empty appearance page means "the index did not answer", not
 * "this address has no history".
 *
 * `listAppearances` swallows every failure into `catch { return []; }`, so an
 * empty page alone cannot tell an outage from a genuinely unused address.
 * `countAppearances` can: it returns `null` ONLY on an outage, and a real
 * empty address reports a real `0`. Reading the two together is the only way
 * to separate them.
 *
 * A non-empty page is never an outage, whatever the count says — rows in hand
 * are rows in hand.
 */
export function isAppearanceOutage(
  appearanceCount: number,
  indexCount: number | null,
): boolean {
  return appearanceCount === 0 && indexCount === null;
}

export async function countAppearances(address: string): Promise<number | null> {
  const chain = currentChain().chifraChain;
  const cacheKey = `${chain}:${address.toLowerCase()}`;
  const cached = countCache.get(cacheKey);
  if (cached && Date.now() - cached.t < APPEARANCE_TTL_MS) return cached.value;

  // The sidecar derives the count from the monitor's file size — a stat, where
  // chifra's `--count` reads the whole file and gave up past 300s. One row is
  // requested because the count rides along with any page.
  // Under a gap this total is a LOWER BOUND — it omits whatever the unread
  // finalized chunks hold — but it is never an overstatement, and the
  // alternative is a chifra read that cannot complete for exactly the
  // addresses that need it, leaving the page with `total: 0` or a 503.
  // A floor beats a falsehood and beats nothing. `isCompleteAnswer` still
  // marks which case this is, for a caller that wants to say so.
  const fromReader = await fetchAppearances(chain, address, 1, 1);
  if (fromReader !== null) {
    if (!isCompleteAnswer(fromReader)) {
      console.warn(
        `[chifra] ${chain}:${address.toLowerCase()} total is a lower bound — index gap of ${fromReader.coverage.gap?.blocks ?? "?"} blocks`,
      );
    }
    countCache.set(cacheKey, { value: fromReader.total, t: Date.now() });
    return fromReader.total;
  }

  try {
    const res = await guarded(chain, address, () =>
      client.list({ addrs: [address], chain, count: true }),
    );
    const row = (res.data ?? []).find(
      (r) =>
        typeof (r as { fileSize?: unknown }).fileSize === "number" ||
        typeof (r as { nRecords?: unknown }).nRecords === "number",
    ) as { fileSize?: number; nRecords?: number } | undefined;
    const value = appearanceCountFromRow(row);
    countCache.set(cacheKey, { value, t: Date.now() });
    if (countCache.size > 500) {
      const oldest = countCache.keys().next().value;
      if (oldest !== undefined) countCache.delete(oldest);
    }
    return value;
  } catch (err) {
    warmAppearanceIndex(chain, address, err);
    return null;
  }
}
