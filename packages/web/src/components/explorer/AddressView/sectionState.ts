/**
 * Per-section load state for the address workspace, and the pure helpers that
 * derive it.
 *
 * The address page loads three independent sections — overview, transactions,
 * token balances — from four upstream reads. They fail independently, so they
 * report independently: a section is loading, ready, or failed WITH A REASON.
 * A failed section must never render as an empty list; "no tokens found" and
 * "the token read timed out" are different facts.
 */

import type { AddressToken, AddressTransaction } from "../../../api/explorer";
import type { Holding, HoldingsResult } from "../../../api/portfolio";
import { formatAmountDisplay } from "../../../lib/format/tokenAmount";
import { ADDRESS_SECTION_TIMEOUT_SECONDS } from "./deadline";

export type SectionState<T> =
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "failed"; reason: string };

/** The starting state of every section. Assignable to `SectionState<T>` for any T. */
export const LOADING = { status: "loading" } as const;

/** One page of an address's transactions, plus its full appearance count. */
export interface TxPageData {
  transactions: AddressTransaction[];
  /** The address's FULL transaction count, not the current page length. */
  total: number;
}

/** The token list, plus where it came from. */
export interface TokenSectionData {
  tokens: AddressToken[];
  /** True when balances came from the indexed balance-changes archive. */
  indexed: boolean;
}

/**
 * Turn a rejection into copy a person can act on.
 *
 * An `AbortSignal.timeout` abort is our own deadline firing, so say so plainly
 * rather than leaking "The user aborted a request." — which is a lie, the user
 * did nothing. Both DOMException names count: the spec names the reason
 * `TimeoutError`, but Chromium rejects the fetch with `AbortError` (measured
 * 2026-08-24 against Chrome via Playwright). Nothing else in the address
 * workspace aborts a read, so either name means the deadline.
 */
export function describeFailure(err: unknown): string {
  const name = (err as { name?: string } | null)?.name;
  if (name === "TimeoutError" || name === "AbortError") {
    return `No answer within ${ADDRESS_SECTION_TIMEOUT_SECONDS} seconds. The upstream is slow or unreachable.`;
  }
  const message = (err as { message?: string } | null)?.message;
  if (typeof message === "string" && message.trim() !== "") return message;
  return "The request failed for an unknown reason.";
}

/** Map one settled promise onto a section state. Never throws. */
export function toSectionState<T>(result: PromiseSettledResult<T>): SectionState<T> {
  return result.status === "fulfilled"
    ? { status: "ready", data: result.value }
    : { status: "failed", reason: describeFailure(result.reason) };
}

/**
 * Settle ONE read into a section state.
 *
 * `Promise.allSettled` — never `Promise.all`. `all` rejects on the first
 * failure, which is exactly how one dead upstream used to blank the whole
 * address page. Every section resolves on its own, as soon as its own read
 * lands, so a slow token read cannot hold the transactions back.
 */
export async function settleSection<T>(read: Promise<T>): Promise<SectionState<T>> {
  const [result] = await Promise.allSettled([read]);
  return toSectionState(result!);
}

/**
 * Map a holdings-gateway row (storage-diff truth, raw balance) to the
 * AddressToken display shape the Tokens tab renders. Balance is scaled at this
 * render edge via formatAmountDisplay — raw ints never get float math.
 */
export function holdingToToken(h: Holding): AddressToken {
  let formatted: string;
  try {
    formatted = formatAmountDisplay(BigInt(h.balance), h.decimals, {
      maxFractionDigits: 4,
    });
  } catch {
    formatted = h.balance;
  }
  return {
    balance: h.balance,
    formattedBalance: formatted,
    contractAddress: h.tokenAddress,
    name: h.name,
    symbol: h.symbol,
    decimals: String(h.decimals),
    type: "ERC-20",
  };
}

/**
 * Combine the two token reads into one section state.
 *
 * The indexed balance-changes gateway is the preferred source (storage-diff
 * truth). It is NOT fatal: when it errors, or the chain isn't indexed yet, the
 * RPC/chifra list stands in. The section only fails when BOTH reads fail —
 * and then it says so rather than showing an empty table.
 */
export function resolveTokensSection(
  tokens: PromiseSettledResult<AddressToken[]>,
  holdings: PromiseSettledResult<HoldingsResult>,
): SectionState<TokenSectionData> {
  if (holdings.status === "fulfilled" && holdings.value.indexed) {
    return {
      status: "ready",
      data: { tokens: holdings.value.holdings.map(holdingToToken), indexed: true },
    };
  }
  if (tokens.status === "fulfilled") {
    return { status: "ready", data: { tokens: tokens.value, indexed: false } };
  }
  return { status: "failed", reason: describeFailure(tokens.reason) };
}

/** A section paired with the name the user sees for it. */
export interface SectionSummary {
  label: string;
  state: SectionState<unknown>;
}

/** The sections still in flight, in display order. */
export function outstandingLabels(sections: SectionSummary[]): string[] {
  return sections.filter((s) => s.state.status === "loading").map((s) => s.label);
}

/** The sections that gave up, in display order. */
export function failedLabels(sections: SectionSummary[]): string[] {
  return sections.filter((s) => s.state.status === "failed").map((s) => s.label);
}

/** How many sections have data. */
export function readyCount(sections: SectionSummary[]): number {
  return sections.filter((s) => s.state.status === "ready").length;
}
