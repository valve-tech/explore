/**
 * Spotting a token whose NAME is an advertisement.
 *
 * Anyone can deploy an ERC-20, call it whatever they like, and airdrop it to
 * any address. The balances tab reads those names off-chain and renders them
 * verbatim beside real holdings — so `Claim 50k $pDAI on dai.free.nf` sits at
 * the same visual weight as `Wrapped Pulse`, carrying an attacker's domain
 * into a page the reader trusts.
 *
 * **This MARKS, it does not hide.** The heuristic is a guess about a string,
 * and a false positive that hides a token would take a real balance off the
 * page — a worse failure than showing a lure with a warning on it. Same
 * reasoning as the 4byte selector markers: untrusted data stays visible and
 * stops borrowing the authority of verified data.
 *
 * It is deliberately conservative. It fires on the shape of an advertisement —
 * a domain, a call to action, a URL — not on "looks unfamiliar", because
 * unfamiliar is most of a long tail of perfectly real tokens.
 */

/** Words that only appear in a name written to be clicked, not to be read. */
const LURE_WORDS =
  /\b(claim|airdrop|reward|voucher|redeem|bonus|giveaway|free\s|visit|swap\s+at|winner)\b/i;

/** A domain or URL in a token name has no legitimate use. */
const DOMAINY =
  /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|xyz|nf|top|site|app|fi|cc|gift|click|link|pro|vip)\b)/i;

/**
 * Names longer than this are advertisements, not names.
 *
 * Real tokens are short — the longest legitimate name on the sample that
 * prompted this was "Dai Stablecoin from Ethereum" at 28 characters, which
 * must NOT trip. 40 leaves real headroom above that while still catching the
 * sentence-length lures.
 */
export const MAX_PLAUSIBLE_NAME = 40;

export type SpamSignal = "url" | "lure" | "overlong" | "hidden-characters";

/**
 * Characters that do not belong in a token name: zero-width joiners and
 * spaces, direction overrides, and other invisibles used to disguise a string
 * or to make two different names render identically.
 */
const HIDDEN_CHARS =
  /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/;

/**
 * Which spam signals a token name trips. Empty means nothing suspicious.
 *
 * Returns the reasons rather than a bare boolean so the UI can say WHY, and so
 * a false positive is diagnosable from the screen instead of from the source.
 */
export function tokenSpamSignals(
  name: string | null | undefined,
  symbol?: string | null,
): SpamSignal[] {
  const signals: SpamSignal[] = [];
  const haystack = `${name ?? ""} ${symbol ?? ""}`;
  if (DOMAINY.test(haystack)) signals.push("url");
  if (LURE_WORDS.test(haystack)) signals.push("lure");
  if ((name ?? "").length > MAX_PLAUSIBLE_NAME) signals.push("overlong");
  if (HIDDEN_CHARS.test(haystack)) signals.push("hidden-characters");
  return signals;
}

/** True when a token's name looks written to be clicked rather than read. */
export function isLikelySpamToken(
  name: string | null | undefined,
  symbol?: string | null,
): boolean {
  return tokenSpamSignals(name, symbol).length > 0;
}

/** Human sentence for the marker's tooltip. */
export function spamSignalReason(signals: SpamSignal[]): string {
  if (signals.length === 0) return "";
  const parts: Record<SpamSignal, string> = {
    url: "contains a web address",
    lure: "reads as a call to action",
    overlong: "is far longer than a real token name",
    "hidden-characters": "contains invisible characters",
  };
  return `This token's name ${signals.map((s) => parts[s]).join(", ")}. Anyone can name a token anything and send it to you — treat it as untrusted, and do not visit any address it shows.`;
}
