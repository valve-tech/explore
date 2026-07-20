/**
 * Middle-truncate a hex string (address, tx/block hash, storage slot) for
 * display: keep `lead` leading chars and `tail` trailing chars, join with a
 * single ellipsis. Values already short enough are returned unchanged.
 *
 * This is display-only. Never truncate a value you will hand back to the API
 * or use as a key.
 */
export function truncateMiddle(
  value: string,
  { lead = 6, tail = 4 }: { lead?: number; tail?: number } = {},
): string {
  if (!value || value.length <= lead + tail + 1) return value;
  return `${value.slice(0, lead)}…${value.slice(-tail)}`;
}

/** Address preset: `0x1234…5678`. */
export function shortAddress(addr: string): string {
  return truncateMiddle(addr, { lead: 6, tail: 4 });
}

/** Hash preset: a little more context than an address. */
export function shortHash(hash: string): string {
  return truncateMiddle(hash, { lead: 8, tail: 6 });
}
