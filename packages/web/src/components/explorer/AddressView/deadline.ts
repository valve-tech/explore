/**
 * The client-side deadline for one address-workspace read.
 *
 * The backend already bounds its own work: chifra runs under a 30s server-side
 * cap, and every viem call carries a 30s timeout. The backend does NOT hang.
 * This deadline therefore sits ABOVE that 30s bound on purpose. It is a
 * backstop for the case the server cannot cover — a dropped connection, a
 * proxy that never answers — not a second, tighter budget.
 *
 * Do not lower it to the 8–10s used elsewhere for cheap lookups. A busy
 * address legitimately takes 15–30s to answer, so a shorter deadline would
 * abort reads that were about to succeed. That is a regression, not a fix.
 *
 * 40s = the 30s server bound + 10s of headroom for queueing, TLS and transfer.
 */
export const ADDRESS_SECTION_TIMEOUT_MS = 40_000;

/** The same value in seconds, for the copy a failed section shows the user. */
export const ADDRESS_SECTION_TIMEOUT_SECONDS = ADDRESS_SECTION_TIMEOUT_MS / 1000;

/**
 * A fresh deadline for ONE call. Every call site takes its own signal: an
 * `AbortSignal` aborts every request it was passed to, so a shared signal would
 * let the first section to time out cancel its healthy siblings.
 */
export function addressSectionSignal(): AbortSignal {
  return AbortSignal.timeout(ADDRESS_SECTION_TIMEOUT_MS);
}
