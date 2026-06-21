/**
 * Pure watch matchers — given decoded chain data + a rule, decide whether the
 * rule fires and produce the summary parts. No viem types, no IDB, no clock,
 * and (deliberately) no number formatting: the matcher carries the RAW on-chain
 * amount through untouched and leaves scaling to the render edge. The engine
 * (`engine.ts`) adapts viem's block/log shapes into the minimal inputs below
 * and stamps identity/time onto the result. That split keeps this file a bag of
 * deterministic functions you can table-test, like the backend monitor's
 * `matchers.ts`.
 */

import type { WatchAmount, WatchMatchContent, WatchRule } from "./types.js";

/** Native coin decimals on EVM chains — value is wei, displayed as ether. */
const NATIVE_DECIMALS = 18;

/**
 * ERC-20 metadata needed to render a human transfer amount. Produced by the
 * effectful `tokenMeta.ts` (a one-shot on-chain read); consumed here as plain
 * data so the matcher stays pure. `symbol` is optional — a token may decline
 * `symbol()` yet still scale by `decimals`.
 */
export interface TokenMeta {
  decimals: number;
  symbol?: string;
}

/** Just the tx fields a matcher needs (subset of viem's Transaction). */
export interface MinimalTx {
  hash: string;
  from: string;
  to: string | null;
  value: bigint;
}

/** Just the fields a matcher needs from a decoded ERC-20 Transfer log. */
export interface MinimalTransferLog {
  transactionHash: string | null;
  blockNumber: bigint | null;
  from: string;
  to: string;
  value: bigint;
}

/** `0x1234…cdef` — compact address/hash for one-line summaries. */
export function shorten(value: string): string {
  if (value.length <= 12) return value;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

// ===========================================================================
// USER-SHAPEABLE: address-activity matcher
// ---------------------------------------------------------------------------
// This is the load-bearing product decision of the watcher — "what counts as
// activity worth a notification, and how do we phrase it?" The default fires on
// any native-value transfer where the watched address is the sender and/or
// recipient (honoring the rule's direction filter + optional min-value
// threshold) and summarizes it as "0xabc… sent 1.5 → 0xdef…". Reasonable knobs
// you might still want to change:
//   - treat `to === null` (contract creation) specially, or skip it?
//   - a different summary phrasing / counterparty emphasis?
// It's a pure function with a tiny input shape, so reshaping it is safe and
// fully covered by matchers.test.ts.
// ===========================================================================
export function matchAddressActivity(
  txs: MinimalTx[],
  rule: WatchRule,
  blockNumber: bigint | null,
): WatchMatchContent[] {
  const watched = rule.address?.toLowerCase();
  if (!watched) return [];
  const direction = rule.direction ?? "both";
  // Below this many wei a tx is dust/zero-value noise and doesn't fire.
  const minValueWei = rule.minValueWei ? BigInt(rule.minValueWei) : 0n;
  const out: WatchMatchContent[] = [];

  for (const tx of txs) {
    if (tx.value < minValueWei) continue;
    const from = tx.from.toLowerCase();
    const to = tx.to?.toLowerCase() ?? null;
    const isOut = from === watched;
    const isIn = to === watched;
    const relevant =
      direction === "both" ? isOut || isIn : direction === "out" ? isOut : isIn;
    if (!relevant) continue;

    const verb = isOut && isIn ? "self-transfer of" : isOut ? "sent" : "received";
    const counterparty = isOut ? to : from;
    const tail =
      counterparty === null
        ? "(contract creation)"
        : `${isOut ? "→" : "←"} ${shorten(counterparty)}`;

    out.push({
      // Native value stays raw wei; the render edge scales it as ether (18).
      lead: `${shorten(watched)} ${verb} `,
      amount: { raw: tx.value.toString(), decimals: NATIVE_DECIMALS, symbol: null },
      trail: ` ${tail}`,
      txHash: tx.hash,
      blockNumber: blockNumber?.toString(),
    });
  }
  return out;
}

/**
 * ERC-20 `Transfer` matcher. The rule is already scoped to one token contract
 * at the fetch layer (`/api/chifra/transfers?token`), so here we only apply the
 * optional counterparty filter and phrase the summary.
 *
 * `meta` carries the token's decimals/symbol when known (the engine fetches it
 * once per token via `tokenMeta.ts`). We DON'T format here — the raw transfer
 * value is carried through as a `WatchAmount` and scaled at the render edge.
 * When `meta` is absent (not yet loaded, or the token declined `decimals()`),
 * `decimals` stays null and the render shows raw base units — so a slow or
 * missing metadata read never blocks the notification.
 */
export function matchErc20Transfer(
  log: MinimalTransferLog,
  rule: WatchRule,
  meta?: TokenMeta | null,
): WatchMatchContent | null {
  const counterparty = rule.counterparty?.toLowerCase();
  const from = log.from.toLowerCase();
  const to = log.to.toLowerCase();
  if (counterparty && from !== counterparty && to !== counterparty) return null;

  const amount: WatchAmount = {
    raw: log.value.toString(),
    decimals: meta?.decimals ?? null,
    symbol: meta?.symbol ?? null,
  };
  return {
    lead: `Transfer ${shorten(from)} → ${shorten(to)} (`,
    amount,
    trail: ")",
    txHash: log.transactionHash ?? undefined,
    blockNumber: log.blockNumber?.toString() ?? undefined,
  };
}
