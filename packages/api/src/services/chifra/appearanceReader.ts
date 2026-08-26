/**
 * The appearance sidecar — appearances read from the index files directly.
 *
 * It lives on the indexer box beside chifra and reads the same data, but from
 * the tiers rather than through chifra's daemon. That matters because chifra
 * loads a WHOLE monitor into memory to answer any query on one, at roughly 28x
 * the file's size, which OOM-killed the daemon at 50.5 GB on 2026-08-26.
 *
 * Measured against live data on chain 369, same box, same address:
 *
 *   WPLS page 1        chifra 44-69s  ->  sidecar 0.340s (1.0s over the wire)
 *   WPLS deep page     offset 5,000,000                     0.175s
 *   WPLS count         chifra >300s, killed  ->             a stat
 *   small address      byte-for-byte identical to chifra, all rows in order
 *
 * It also answers what chifra could not reach at all: WPLS's newest row is the
 * head block, because the scrapers write one index file per block and the
 * sidecar reads those, while a monitor only advances when something
 * consolidates it.
 *
 * This is a preferred path, not a replacement. `chifraFallback` still runs
 * whenever the sidecar cannot answer, so an unreachable sidecar degrades to
 * exactly today's behaviour instead of breaking the address page.
 */

const READER_BASE =
  process.env.APPEARANCE_READER_URL || "https://chifra.valve.city";

/**
 * Short on purpose. The sidecar answers in milliseconds or it is not well —
 * there is no case where waiting longer helps, and the whole point is to stop
 * spending a request's budget on the index.
 */
const READER_TIMEOUT_MS = 5_000;

export interface ReaderAppearance {
  blockNumber: number;
  transactionIndex: number;
}

export interface ReaderCoverage {
  monitorLastBlock: number | null;
  finalizedEnd: number | null;
  head: number | null;
  gap: { firstBlock: number; lastBlock: number; blocks: number } | null;
  complete: boolean;
}

export interface ReaderResult {
  appearances: ReaderAppearance[];
  total: number;
  /** False when a lagging monitor leaves a block range unread. */
  totalIsExact: boolean;
  coverage: ReaderCoverage;
}

/**
 * True when a row from the sidecar is a usable appearance.
 *
 * The sidecar is ours and its shape is tested, but this crosses a network
 * boundary, and a silently-changed field would otherwise become a page of
 * `undefined` block numbers rather than a failure we can fall back from.
 */
export function isReaderAppearance(row: unknown): row is ReaderAppearance {
  const r = row as { blockNumber?: unknown; transactionIndex?: unknown } | null;
  return (
    typeof r?.blockNumber === "number" &&
    Number.isInteger(r.blockNumber) &&
    typeof r.transactionIndex === "number" &&
    Number.isInteger(r.transactionIndex)
  );
}

/**
 * Parse a sidecar response, or return `null` when it is not one.
 *
 * `null` means "this did not answer", never "this address has nothing". The
 * caller must fall back rather than render an empty page.
 */
export function parseReaderResult(body: unknown): ReaderResult | null {
  const b = body as
    | {
        appearances?: unknown;
        total?: unknown;
        totalIsExact?: unknown;
        coverage?: unknown;
      }
    | null;
  if (!b || !Array.isArray(b.appearances)) return null;
  if (typeof b.total !== "number" || !Number.isInteger(b.total)) return null;

  const appearances = b.appearances.filter(isReaderAppearance);
  // A partly-unreadable page is a changed contract, not a short page.
  if (appearances.length !== b.appearances.length) return null;

  const c = b.coverage as Partial<ReaderCoverage> | null;
  return {
    appearances,
    total: b.total,
    totalIsExact: b.totalIsExact === true,
    coverage: {
      monitorLastBlock: c?.monitorLastBlock ?? null,
      finalizedEnd: c?.finalizedEnd ?? null,
      head: c?.head ?? null,
      gap: c?.gap ?? null,
      complete: c?.complete === true,
    },
  };
}

/** The sidecar's URL for one page. */
export function readerUrl(
  chain: string,
  address: string,
  page: number,
  perPage: number,
  base: string = READER_BASE,
): string {
  const u = new URL("/appearances", base);
  u.searchParams.set("chain", chain);
  u.searchParams.set("address", address.toLowerCase());
  u.searchParams.set("page", String(page));
  u.searchParams.set("perPage", String(perPage));
  return u.toString();
}

/**
 * Ask the sidecar for one page. Returns `null` on any failure — unreachable,
 * slow, a 404 for a chain it does not index, or a shape it did not promise.
 *
 * Never throws. A caller on the happy path must not have to handle the
 * sidecar being absent; it just falls through to chifra.
 */
export async function fetchAppearances(
  chain: string,
  address: string,
  page: number,
  perPage: number,
  deps: { fetch?: typeof fetch; base?: string } = {},
): Promise<ReaderResult | null> {
  const doFetch = deps.fetch ?? fetch;
  try {
    const res = await doFetch(
      readerUrl(chain, address, page, perPage, deps.base ?? READER_BASE),
      { signal: AbortSignal.timeout(READER_TIMEOUT_MS) },
    );
    if (!res.ok) return null;
    return parseReaderResult(await res.json());
  } catch {
    return null;
  }
}
