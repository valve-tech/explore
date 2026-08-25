import { pool } from "./pool.js";
import { isVouched } from "./signatures/vouched.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SignatureMatch {
  selector: string;
  textSignature: string;
  sigType: "function" | "event";
}

/**
 * One selector, reduced to what a list row needs: the name we show, and how
 * much of a guess it is.
 *
 * 4byte.directory is a dictionary of every signature anyone ever registered,
 * not a record of what a contract compiled to, so a selector routinely
 * carries several entries. We were printing the first of them as if it were
 * the truth, which is how a page came to say a transaction called
 * `ijekfhacdgb()` (selector 0x00000012) or `rz_16jun22_88961909()`:
 * gas-token-era mined names, brute-forced so their selector had leading zero
 * bytes, and legitimately registered upstream.
 *
 * The first fix shipped the raw candidate count and let the UI mark anything
 * above 1. It marked 77% of named Ethereum rows, and a review against the
 * rendered page on 2026-08-25 showed why that was useless: in a 250-tx sample
 * across all four chains, EVERY marked row was ERC-20 `transfer`,
 * `transferFrom`, or a Uniswap V2 router swap. Not one was a real guess.
 * Meanwhile `atInversebrah(…)` — the mined name for 0x60806040, which is not
 * a selector at all — wore the same superscript 6 as
 * `transfer(address,uint256)` three rows above it.
 *
 * So the count no longer counts registrations. It counts the candidates that
 * leave the displayed name IN DOUBT, and `signatures/vouched.ts` is what
 * takes a candidate out of doubt. The wire cost is unchanged: one integer per
 * row, and a client that wants the alternatives asks
 * `GET /api/signatures/:selector` for that one selector.
 */
export interface SelectorSummary {
  /**
   * The candidate we display: the vouched signature if the selector has one,
   * otherwise the first by (created_at, text_signature).
   */
  textSignature: string;
  /**
   * How many candidates leave `textSignature` in doubt. Always >= 1.
   *
   * `1` means settled — either the selector had one candidate, or the one we
   * show is the canonical signature for it. Above 1 is the honest count of a
   * selector where nothing vouches for any of the names, and the UI marks it.
   */
  candidateCount: number;
}

// ---------------------------------------------------------------------------
// Selectors that carry no information
// ---------------------------------------------------------------------------

/**
 * Selectors no signature database can answer honestly.
 *
 * Neither of these is a function selector. Both are the first four bytes of
 * something else, and people MINED names that hash to them back when gas
 * tokens paid for the effort, then registered every one upstream.
 * 4byte.directory serves them, and Sourcify mirrors them.
 *
 * `0x00000000` is what calldata starts with when a contract takes a raw blob
 * through its fallback, which every MEV and arbitrage bot on chain 369 does.
 * The directory holds 49 mined names for it. Taking the first produced a page
 * that told the user tx 0x8b69a556… called
 * `get_block_hash_257335279069929()`, while the tx detail page and the
 * debugger — which decode against the real ABI — correctly said they could
 * not decode it at all.
 *
 * `0x60806040` is the Solidity contract-creation prologue: `PUSH1 0x80 PUSH1
 * 0x40`, the first instruction of essentially every contract deployed since
 * 0.5.x. A list row reads its "selector" off the front of the init bytecode,
 * so every deployment resolved to `atInversebrah(bytes28,(int56),…)`, the
 * first of six mined names. Seven of 25 rows on one address feed said it.
 *
 * Returning nothing lets the caller fall back to showing the raw selector,
 * which is true. The cost is a real function that happens to hash to one of
 * these two losing its name; the benefit is that deployments and raw-blob
 * fallbacks stop inventing one. That trade is heavily one-sided.
 */
const UNRESOLVABLE_SELECTORS = new Set(["0x00000000", "0x60806040"]);

// ---------------------------------------------------------------------------
// API sources — try Sourcify first, then 4byte.directory
// ---------------------------------------------------------------------------

const SOURCIFY_4BYTE_API = "https://api.4byte.sourcify.dev/api/v1";
const FOURBYTE_API = "https://www.4byte.directory/api/v1";

async function fetchFromSource(
  baseUrl: string,
  selector: string,
  sigType: "function" | "event",
): Promise<string[]> {
  const endpoint = sigType === "function" ? "signatures" : "event-signatures";
  const url = `${baseUrl}/${endpoint}/?hex_signature=${selector}&ordering=created_at`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) return [];

    const data = (await res.json()) as {
      results?: Array<{ text_signature: string }>;
    };

    return (data.results ?? []).map((r) => r.text_signature);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Cache layer
// ---------------------------------------------------------------------------

async function getCached(selector: string): Promise<SignatureMatch[]> {
  const { rows } = await pool.query<{
    selector: string;
    sig_type: string;
    text_signature: string;
  }>(
    `SELECT selector, sig_type, text_signature FROM signature_cache
      WHERE selector = $1
      ORDER BY created_at, text_signature`,
    [selector.toLowerCase()],
  );

  return rows.map((r) => ({
    selector: r.selector,
    textSignature: r.text_signature,
    sigType: r.sig_type as "function" | "event",
  }));
}

async function cacheSignatures(
  selector: string,
  sigType: "function" | "event",
  signatures: string[],
): Promise<void> {
  for (const sig of signatures) {
    await pool.query(
      `INSERT INTO signature_cache (selector, sig_type, text_signature)
       VALUES ($1, $2, $3)
       ON CONFLICT (selector, text_signature) DO NOTHING`,
      [selector.toLowerCase(), sigType, sig],
    ).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

// Negative cache for selectors with no matches (TTL: 1 hour)
const SIG_NOT_FOUND = new Map<string, number>();
const SIG_NOT_FOUND_TTL = 60 * 60 * 1000;

/**
 * Look up function/event signatures by their 4-byte selector.
 * Checks cache first, then tries Sourcify and 4byte.directory APIs.
 */
export async function lookupSelector(
  selector: string,
  sigType: "function" | "event" = "function",
): Promise<SignatureMatch[]> {
  const normalized = selector.toLowerCase().startsWith("0x")
    ? selector.toLowerCase()
    : `0x${selector.toLowerCase()}`;

  // A selector nobody can answer honestly. Skip the cache, skip the network.
  if (UNRESOLVABLE_SELECTORS.has(normalized)) return [];

  // Check negative cache
  const notFoundAt = SIG_NOT_FOUND.get(normalized);
  if (notFoundAt && Date.now() - notFoundAt < SIG_NOT_FOUND_TTL) {
    return [];
  }

  // Check DB cache
  const cached = await getCached(normalized);
  if (cached.length > 0) return cached;

  // Try Sourcify first (faster, more complete)
  let signatures = await fetchFromSource(SOURCIFY_4BYTE_API, normalized, sigType);

  // Fallback to 4byte.directory
  if (signatures.length === 0) {
    signatures = await fetchFromSource(FOURBYTE_API, normalized, sigType);
  }

  if (signatures.length > 0) {
    await cacheSignatures(normalized, sigType, signatures);
    SIG_NOT_FOUND.delete(normalized);
  } else {
    SIG_NOT_FOUND.set(normalized, Date.now());
  }

  return signatures.map((sig) => ({
    selector: normalized,
    textSignature: sig,
    sigType,
  }));
}

/**
 * Batch lookup — resolves multiple selectors in parallel.
 * Useful for decoding an entire trace at once.
 */
export async function lookupSelectors(
  selectors: string[],
): Promise<Record<string, SignatureMatch[]>> {
  // Filtered here as well as in `lookupSelector`, because this path reads the
  // DB cache directly. Production already holds all 49 mined `0x00000000`
  // rows, so a read-side filter retires them without a migration.
  const unique = [
    ...new Set(selectors.map((s) => s.toLowerCase().slice(0, 10))),
  ].filter((s) => !UNRESOLVABLE_SELECTORS.has(s));
  const results: Record<string, SignatureMatch[]> = {};

  // Batch cache lookup
  if (unique.length > 0) {
    const placeholders = unique.map((_, i) => `$${i + 1}`).join(",");
    const { rows } = await pool.query<{
      selector: string;
      sig_type: string;
      text_signature: string;
    }>(
      `SELECT selector, sig_type, text_signature FROM signature_cache
        WHERE selector IN (${placeholders})
        ORDER BY created_at, text_signature`,
      unique,
    );

    for (const r of rows) {
      const key = r.selector;
      if (!results[key]) results[key] = [];
      results[key].push({
        selector: r.selector,
        textSignature: r.text_signature,
        sigType: r.sig_type as "function" | "event",
      });
    }
  }

  // Fetch missing selectors from APIs (in parallel, max 10 concurrent)
  const missing = unique.filter((s) => !results[s]);
  const BATCH_SIZE = 10;

  for (let i = 0; i < missing.length; i += BATCH_SIZE) {
    const batch = missing.slice(i, i + BATCH_SIZE);
    const fetched = await Promise.all(
      batch.map(async (sel) => {
        const matches = await lookupSelector(sel);
        return { selector: sel, matches };
      }),
    );

    for (const { selector, matches } of fetched) {
      results[selector] = matches;
    }
  }

  return results;
}

/**
 * Reduce a match list to the displayed name plus the in-doubt count.
 *
 * Pure, and separate from the lookup, so both rules live in exactly one
 * place.
 *
 * **Which name wins.** A vouched signature beats registration order. The
 * fallback is the first match, and the SQL above pinned that order with
 * `ORDER BY created_at, text_signature` — a Postgres `SELECT` with no `ORDER
 * BY` returns rows however it likes, which would have made "the first
 * candidate" a different name from one request to the next. Preferring the
 * vouched entry also removes our dependence on 4byte's own ordering: if the
 * directory ever listed `many_msg_babbage(bytes1)` ahead of
 * `transfer(address,uint256)`, we would still print `transfer`.
 *
 * **How much doubt is left.** A vouched name is settled, so the count is 1
 * and the UI renders it as plain text. Nothing vouches for a mined name, so
 * its selector reports the honest number and the UI marks it. This is the
 * whole difference between a marker that fired on 77% of Ethereum rows and
 * one that fires when the name is actually a guess.
 *
 * Returns null for a selector with no matches, so the caller renders the raw
 * selector rather than a name.
 */
export function summarizeMatches(
  matches: SignatureMatch[] | undefined,
): SelectorSummary | null {
  const first = matches?.[0];
  if (!first) return null;
  const vouched = matches.find((m) => isVouched(m.selector, m.textSignature));
  const shown = vouched ?? first;
  return {
    textSignature: shown.textSignature,
    candidateCount: vouched ? 1 : matches.length,
  };
}

/**
 * Batch lookup reduced to one summary per selector. This is what every list
 * view wants: a name to print and a count that says how much to trust it.
 * Selectors with no match are absent from the map.
 */
export async function lookupSelectorSummaries(
  selectors: string[],
): Promise<Record<string, SelectorSummary>> {
  const matches = await lookupSelectors(selectors);
  const summaries: Record<string, SelectorSummary> = {};
  for (const [selector, list] of Object.entries(matches)) {
    const summary = summarizeMatches(list);
    if (summary) summaries[selector] = summary;
  }
  return summaries;
}
