import { type Address, type Hex, erc20Abi, formatEther, padHex } from "viem";
import { chainClient, currentChain } from "../chains/context.js";
import { ApiError } from "../../lib/respond.js";
import {
  listAppearances,
  countAppearances,
  isAppearanceOutage,
} from "../chifra/appearances.js";
import { isWarming, isWarmHopeless } from "../chifra/warmIndex.js";
import { appearanceOutageMessage } from "./addresses/outageMessage.js";
import { lookupSelectorSummaries, type SelectorSummary } from "../signatures.js";
import { TRANSFER_TOPIC } from "./tokenTransfers/transforms.js";
import {
  buildAddressTransaction,
  buildAddressToken,
  extractTxTypeAndFees,
  LEGACY_FALLBACK_FEES,
  type AddressTransactionBase,
  type AddressTokenView,
} from "./addresses/transforms.js";

// ---------------------------------------------------------------------------
// Address transactions — chifra appearance index + RPC hydration
// ---------------------------------------------------------------------------

export type AddressTransaction = AddressTransactionBase & {
  type: string;
  maxFeePerGas: string | null;
  maxPriorityFeePerGas: string | null;
};

/**
 * Latest-first transaction history for an address. chifra's appearance
 * index supplies the (block, txIndex) pairs (cheap — it never walks logs);
 * everything else hydrates from our own RPC: the tx body, the receipt
 * (gasUsed / status), and the block timestamp (deduped per block). viem's
 * batch transport collapses the burst into a handful of HTTP round-trips.
 *
 * `total` is the count returned for this page — chifra can count all
 * appearances but that's a separate index walk; no current consumer pages
 * off a true total.
 */
export async function getAddressTransactions(
  address: string,
  page: number = 1,
  limit: number = 25,
): Promise<{ transactions: AddressTransaction[]; total: number }> {
  // The real total comes from chifra's index count (cheap), not the page size —
  // so a huge address (e.g. stETH) reports its full appearance count and the UI
  // can paginate the whole history. Both reads are cached + run in parallel.
  const [appearances, count] = await Promise.all([
    listAppearances(address, page, limit),
    countAppearances(address),
  ]);
  /*
   * An empty page plus a `null` count means chifra never answered — NOT that
   * the address has no history. `listAppearances` swallows every failure into
   * `catch { return []; }`, so on its own an empty page cannot tell the two
   * apart. `countAppearances` can: it returns `null` only on an outage, and a
   * genuinely empty address reports a real `0`.
   *
   * This used to return an empty success anyway, on the grounds that the
   * address page had nowhere to report an error. That stopped being true on
   * 2026-08-25, when the page gained a per-section failed state with a reason
   * and a Retry. Measured before the fix: WPLS on chain 369
   * (0xA1077a...9a27) answered in 30.2s — the chifra cap exactly — with
   * `total: 0`, and the page said "No transactions found" about one of the
   * busiest contracts on the chain.
   *
   * `getMergedActivity` already used this same test for the same reason; it
   * simply had to compute the count itself. It no longer does.
   */
  if (isAppearanceOutage(appearances.length, count)) {
    // The failing read has already asked for a background warm. Promise a
    // retry only while one is running AND this address has not already
    // defeated the warm twice.
    const chain = currentChain().chifraChain;
    const worthRetrying =
      isWarming(chain, address) && !isWarmHopeless(chain, address);
    throw new ApiError(503, appearanceOutageMessage(worthRetrying));
  }
  if (appearances.length === 0) return { transactions: [], total: count ?? 0 };

  const client = chainClient();

  const blockTimestamps = new Map<number, number | null>();
  await Promise.all(
    [...new Set(appearances.map((a) => a.blockNumber))].map(async (bn) => {
      try {
        const block = await client.getBlock({ blockNumber: BigInt(bn) });
        blockTimestamps.set(bn, Number(block.timestamp));
      } catch {
        blockTimestamps.set(bn, null);
      }
    }),
  );

  const hydrated = await Promise.all(
    appearances.map(async (a) => {
      try {
        const tx = await client.getTransaction({
          blockNumber: BigInt(a.blockNumber),
          index: a.transactionIndex,
        });
        const receipt = await client
          .getTransactionReceipt({ hash: tx.hash })
          .catch(() => null);
        return { tx, receipt, timestamp: blockTimestamps.get(a.blockNumber) ?? null };
      } catch {
        return null;
      }
    }),
  );

  const rows = hydrated.filter((h) => h !== null);

  // Best-effort function names for every distinct selector on the page.
  const selectors = [
    ...new Set(
      rows
        .map((r) => (r.tx.input.length >= 10 ? r.tx.input.slice(0, 10) : ""))
        .filter((s) => s !== "" && s !== "0x"),
    ),
  ];
  // The summary carries the candidate COUNT alongside the name. A 4byte
  // selector often has several registered signatures, and the row shows the
  // first — the count is what lets the UI say so instead of printing a guess
  // as a fact.
  let names: Record<string, SelectorSummary> = {};
  if (selectors.length > 0) {
    try {
      names = await lookupSelectorSummaries(selectors);
    } catch {
      // Selector source unreachable — rows render without function names.
    }
  }

  const transactions: AddressTransaction[] = rows.map((r) => {
    const methodId = r.tx.input.length >= 10 ? r.tx.input.slice(0, 10) : "";
    const summary = names[methodId];
    return {
      ...buildAddressTransaction(
        r.tx,
        r.receipt,
        r.timestamp,
        summary?.textSignature ?? "",
        summary?.candidateCount ?? 0,
      ),
      ...(r.tx ? extractTxTypeAndFees(r.tx) : LEGACY_FALLBACK_FEES),
    };
  });

  return { transactions, total: count ?? transactions.length };
}

// ---------------------------------------------------------------------------
// Address tokens — Transfer-log scan over recent appearances + balanceOf
// ---------------------------------------------------------------------------

export type AddressToken = AddressTokenView;

/** How many recent appearances to scan for token contracts. */
const TOKEN_SCAN_APPEARANCES = 50;
/** Cap on distinct tokens hydrated per request. */
const TOKEN_SCAN_MAX_TOKENS = 50;

/**
 * Tokens an address holds, discovered from the Transfer events in its
 * recent transaction receipts (chifra appearances → receipts → standard
 * Transfer topics naming the address) and confirmed with a live
 * `balanceOf`. Zero balances are dropped.
 *
 * This is discovery-by-activity: a token the address hasn't touched in
 * its recent `TOKEN_SCAN_APPEARANCES` appearances won't surface. That's
 * the honest trade against walking the full history per page load; the
 * portfolio holdings path (substreams balance-changes) is the planned
 * exhaustive source.
 */
export async function getAddressTokens(
  address: string,
): Promise<AddressToken[]> {
  const appearances = await listAppearances(address, 1, TOKEN_SCAN_APPEARANCES);
  if (appearances.length === 0) return [];

  const client = chainClient();
  const paddedAddress = padHex(address.toLowerCase() as Hex, { size: 32 });

  const receipts = await Promise.all(
    appearances.map(async (a) => {
      try {
        const tx = await client.getTransaction({
          blockNumber: BigInt(a.blockNumber),
          index: a.transactionIndex,
        });
        return await client.getTransactionReceipt({ hash: tx.hash });
      } catch {
        return null;
      }
    }),
  );

  const tokens = new Set<string>();
  for (const receipt of receipts) {
    if (!receipt) continue;
    for (const log of receipt.logs) {
      if (log.topics[0]?.toLowerCase() !== TRANSFER_TOPIC) continue;
      const involved =
        log.topics[1]?.toLowerCase() === paddedAddress ||
        log.topics[2]?.toLowerCase() === paddedAddress;
      if (involved) tokens.add(log.address.toLowerCase());
      if (tokens.size >= TOKEN_SCAN_MAX_TOKENS) break;
    }
  }
  if (tokens.size === 0) return [];

  const views = await Promise.all(
    [...tokens].map(async (token) => {
      const tokenAddress = token as Address;
      const balance = await client
        .readContract({
          address: tokenAddress,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [address as Address],
        })
        .catch(() => null);
      if (balance === null || balance === 0n) return null;

      const [name, symbol, decimals] = await Promise.all([
        client.readContract({ address: tokenAddress, abi: erc20Abi, functionName: "name" }).catch(() => ""),
        client.readContract({ address: tokenAddress, abi: erc20Abi, functionName: "symbol" }).catch(() => ""),
        client.readContract({ address: tokenAddress, abi: erc20Abi, functionName: "decimals" }).catch(() => null),
      ]);

      return buildAddressToken(token, balance, {
        name,
        symbol,
        decimals: decimals === null ? null : String(decimals),
      });
    }),
  );

  return views.filter((v) => v !== null);
}

// ---------------------------------------------------------------------------
// Balance + contract-check
// ---------------------------------------------------------------------------

export async function getAddressBalance(
  address: string,
): Promise<{ balance: string; balancePLS: string }> {
  const balance = await chainClient().getBalance({
    address: address as Address,
  });
  return {
    balance: balance.toString(),
    balancePLS: formatEther(balance),
  };
}

export async function isContract(address: string): Promise<boolean> {
  try {
    const code = await chainClient().getCode({ address: address as Address });
    return !!code && code !== "0x";
  } catch {
    return false;
  }
}
