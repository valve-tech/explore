/**
 * How many transaction rows one page of the address workspace holds.
 *
 * **100 is the ceiling, not 250.** `routes/explorer.ts` clamps the `limit`
 * query to 100, and it clamps SILENTLY — `?limit=250` answers 200 with 100
 * rows, so an over-large request looks like it worked. The 250 elsewhere in
 * the codebase is chifra's daemon `maxRecords`, which bounds the appearance
 * read and has nothing to do with a page.
 *
 * The cap is worth keeping. Every row costs three RPC reads — the transaction,
 * its receipt, and its block timestamp — which viem's batch transport collapses
 * into a handful of round-trips. Measured against production on 2026-08-27 for
 * a busy contract: 25 rows in 1.3s, 100 rows in 1.6-2.5s. That is a fine page.
 * Ethereum has 429'd us before, and a page nobody scrolls to the bottom of is
 * not worth 750 reads.
 */
export const ADDRESS_PAGE_SIZES = [25, 50, 100] as const;

export type AddressPageSize = (typeof ADDRESS_PAGE_SIZES)[number];

export const DEFAULT_ADDRESS_PAGE_SIZE: AddressPageSize = 25;

const STORAGE_KEY = "explore.addressPageSize";

/** The supported size a value names, or the default when it names none. */
export function coercePageSize(raw: unknown): AddressPageSize {
  const n = typeof raw === "string" ? Number.parseInt(raw, 10) : Number(raw);
  return (ADDRESS_PAGE_SIZES as readonly number[]).includes(n)
    ? (n as AddressPageSize)
    : DEFAULT_ADDRESS_PAGE_SIZE;
}

/**
 * The page that still holds your first visible row after the size changes.
 *
 * Resetting to page 1 would throw away the reader's place: someone 40 pages
 * into a history who asks for bigger pages wants MORE of what they are looking
 * at, not the top again. Page 41 of 25 starts at row 1000, which is page 11 of
 * 100.
 */
export function pageAtNewSize(page: number, from: number, to: number): number {
  const firstRow = (Math.max(1, page) - 1) * from;
  return Math.floor(firstRow / to) + 1;
}

/** How many pages a total splits into. Always at least one. */
export function totalPages(total: number, size: number): number {
  if (size <= 0) return 1;
  return Math.max(1, Math.ceil(total / size));
}

/**
 * The reader's remembered size.
 *
 * Every access is guarded: a private window, cleared site data, or a browser
 * set to block storage throws on read, and a page size is not worth a crash.
 */
export function loadPageSize(): AddressPageSize {
  try {
    return coercePageSize(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_ADDRESS_PAGE_SIZE;
  }
}

/** Remember the size for the next address the reader opens. */
export function savePageSize(size: AddressPageSize): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(size));
  } catch {
    // Storage unavailable — the size still applies for this session.
  }
}
