import { runWithChain } from "../chains/context.js";
import { getAddressTransactions } from "../explorer/addresses.js";
import { countAppearances } from "../chifra/appearances.js";
import { hasPresence, type ChainPresence } from "./chainPresence.js";

/**
 * The merged recent-activity feed for the chain-less address page.
 *
 * Each present chain contributes its newest `limit` rows. The service tags
 * every row with its chain, merges the rows by timestamp, and truncates to
 * `limit`. This is a recent WINDOW, not a paginated view: paging deeper
 * across chains needs per-chain cursors and a total nobody can compute
 * cheaply, so the UI sends the user to one chain instead of faking it.
 *
 * A chain that fails is reported in `perChain`, never silently dropped. An
 * absent chain and an unreachable chain are different facts. Conflating them
 * tells the user their address has no history when the truth is we could
 * not look.
 */

export interface TaggedTx {
  chainId: number;
  hash: string;
  /** Unix seconds as a string, matching AddressTransaction. */
  timeStamp: string;
  [key: string]: unknown;
}

export interface PerChainStatus {
  chainId: number;
  returned: number;
  error?: true;
}

export interface MergedActivity {
  rows: TaggedTx[];
  perChain: PerChainStatus[];
}

export interface ActivityDeps {
  fetchForChain: (chainId: number, address: string, limit: number) => Promise<TaggedTx[]>;
  timeoutMs: number;
}

/**
 * `getAddressTransactions` is a degradable read for every OTHER caller: a
 * chifra outage lands on `listAppearances`' `catch { return []; }` and comes
 * back as `{ transactions: [], total: 0 }`, indistinguishable from a real
 * empty history. That is the right answer for the plain address page, which
 * has no per-chain error slot to report into.
 *
 * This page does have one (`PerChainStatus.error`), and reporting "0 rows, no
 * error" for an unreachable chain is exactly the conflation the feature
 * exists to remove. So this fetcher makes its OWN `countAppearances` call —
 * cheap and already 30s-cached, so it costs nothing beyond the coincident
 * in-flight call `getAddressTransactions` makes — and throws when the page
 * came back empty AND the count came back `null`. `null` only happens on an
 * outage; a real empty address reports a real `0`.
 */
export const defaultDeps: ActivityDeps = {
  fetchForChain: async (chainId, address, limit) =>
    runWithChain(chainId, async () => {
      const [{ transactions }, count] = await Promise.all([
        getAddressTransactions(address, 1, limit),
        countAppearances(address),
      ]);
      if (transactions.length === 0 && count === null) {
        throw new Error("chifra unreachable for this chain");
      }
      return transactions.map((t) => ({ ...t, chainId }) as TaggedTx);
    }),
  timeoutMs: 12_000,
};

export async function getMergedActivity(
  address: string,
  presence: ChainPresence[],
  limit: number,
  deps: ActivityDeps = defaultDeps,
): Promise<MergedActivity> {
  // An errored chain is reported but never fetched. We already know we
  // cannot reach it, and a second attempt only spends more RPC budget.
  const erroredPresence = presence.filter((p) => p.error);
  const targets = presence.filter((p) => hasPresence(p));

  const fetched = await Promise.all(
    targets.map(async (p) => {
      try {
        const rows = await withTimeout(
          deps.fetchForChain(p.chainId, address, limit),
          deps.timeoutMs,
        );
        return { chainId: p.chainId, rows };
      } catch {
        return { chainId: p.chainId, rows: [] as TaggedTx[], error: true as const };
      }
    }),
  );

  const rows: TaggedTx[] = [];
  const perChain: PerChainStatus[] = [];
  for (const f of fetched) {
    rows.push(...f.rows);
    perChain.push(
      f.error
        ? { chainId: f.chainId, returned: 0, error: true }
        : { chainId: f.chainId, returned: f.rows.length },
    );
  }
  for (const e of erroredPresence) {
    perChain.push({ chainId: e.chainId, returned: 0, error: true });
  }
  // Sort by chain id so perChain does not depend on the caller's presence order.
  perChain.sort((a, b) => a.chainId - b.chainId);

  // Newest first. Ties break on chain id so the same inputs always produce
  // the same order — two chains can easily share a timestamp.
  rows.sort((a, b) => {
    const delta = Number(b.timeStamp) - Number(a.timeStamp);
    return delta !== 0 ? delta : a.chainId - b.chainId;
  });

  return { rows: rows.slice(0, limit), perChain };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("activity fetch timed out")), ms),
    ),
  ]);
}
