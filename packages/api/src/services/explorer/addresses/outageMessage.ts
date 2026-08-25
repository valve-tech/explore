/**
 * What the address page says when the appearance index does not answer.
 *
 * There are two different failures behind one symptom, and telling them apart
 * is the whole point of this string:
 *
 *   - chifra is down, or the address is ordinary and something broke. Nothing
 *     the reader does will help.
 *   - the address is enormous and its index has never been read here. The
 *     first read costs minutes; we started it in the background, so a retry a
 *     minute later works. Measured on chain 369: a 30.6M-appearance monitor
 *     answered in 7.3s on the read after the long one, having timed out at
 *     125s on the first.
 *
 * Never promise the retry unless a warm is genuinely running.
 */
export function appearanceOutageMessage(warming: boolean): string {
  const base =
    "The transaction index did not answer in time. This is an outage, not an empty address.";
  if (!warming) return base;
  return `${base} This address is very busy, so we are loading its index in the background. Try again in about a minute.`;
}
