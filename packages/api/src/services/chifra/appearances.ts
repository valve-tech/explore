/**
 * Address appearance index via chifra `/list`, through the typed
 * @valve-tech/trueblocks-sdk client (same client style as transfers.ts).
 * An appearance is a (blockNumber, transactionIndex) pair for every tx an
 * address shows up in — the cheap index read (seconds, even cold) as opposed
 * to the heavyweight log walks in transfers.ts. Callers hydrate the pairs
 * into full transactions through our own RPC.
 *
 * Results cache briefly (30s) per (chain, address, page) — long enough to
 * absorb a UI's refetch bursts, short enough that a new tx shows up on the
 * next page load.
 */

import { createTrueblocksClient } from "@valve-tech/trueblocks-sdk";
import { currentChain } from "../chains/context.js";

const CHIFRA_BASE = process.env.CHIFRA_BASE_URL || "https://chifra.valve.city";

/**
 * chifra cold-cache index reads can take a few seconds. The SDK has no
 * built-in timeout, so bound each request via the injected fetch (mirrors
 * transfers.ts).
 */
const CHIFRA_TIMEOUT_MS = 30_000;

const client = createTrueblocksClient({
  baseUrl: CHIFRA_BASE,
  fetch: (input, init) =>
    fetch(input, { ...init, signal: AbortSignal.timeout(CHIFRA_TIMEOUT_MS) }),
});

const APPEARANCE_TTL_MS = 30_000;
const appearanceCache = new Map<
  string,
  { value: Appearance[]; t: number }
>();

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

  try {
    const res = await client.list({
      addrs: [address],
      chain,
      reversed: true,
      // chifra's firstRecord is 0-based (verified against the live daemon).
      firstRecord: (page - 1) * limit,
      maxRecords: limit,
    });

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
  } catch {
    return [];
  }
}
