import { formatAmountDisplay } from "../../../lib/format/tokenAmount";
import { toResolutionGroups } from "../../../lib/format/resolution";

/**
 * Which decoded values of a call are token amounts, and how to print them.
 *
 * The call tree printed every `uint256` as a grouped raw integer. For a token
 * amount that is the base-unit figure: 1,000,000 tokens at 18 decimals is 25
 * digits. The reader wants "1,000,000".
 *
 * A raw integer says nothing about its own scale, so this claims an amount
 * only where a standard fixes the meaning: the ERC-20 signatures below. And
 * it scales only when the caller knows the decimals of the called token. With
 * no decimals the raw integer stays — the same rule `formatTokenAmount`
 * follows. A guessed scale is worse than a long number.
 */

/** Position of the amount argument, by exact ERC-20 signature. */
const AMOUNT_ARGUMENT: Record<string, number> = {
  "transfer(address,uint256)": 1,
  "approve(address,uint256)": 1,
  "transferFrom(address,address,uint256)": 2,
};

/** ERC-20 signatures whose single return value is an amount. */
const AMOUNT_RETURN = new Set([
  "balanceOf(address)",
  "allowance(address,address)",
  "totalSupply()",
]);

export function amountArgumentIndex(signature: string): number | null {
  return AMOUNT_ARGUMENT[signature] ?? null;
}

export function returnsAmount(signature: string): boolean {
  return AMOUNT_RETURN.has(signature);
}

export interface AmountText {
  /** Trimmed to three groups of resolution — what the row shows. */
  display: string;
  /** The exact scaled value — what the hover shows. */
  full: string;
}

/** Scale a raw amount and trim it for a dense row. Exact, string-only. */
export function scaledAmount(raw: bigint, decimals: number): AmountText {
  const full = formatAmountDisplay(raw, decimals);
  return { display: toResolutionGroups(full).display, full };
}

interface TransferFacts {
  contractAddress: string;
  tokenDecimal: string;
}

/**
 * Token decimals by lowercased contract address, read from the transaction's
 * own token transfers. No extra request: a token that moved in this
 * transaction already carries its decimals. A token that did not move is
 * absent, and its amounts stay raw.
 */
export function decimalsByToken(
  transfers: readonly TransferFacts[],
): ReadonlyMap<string, number> {
  const out = new Map<string, number>();
  for (const t of transfers) {
    if (/^\d+$/.test(t.tokenDecimal)) {
      out.set(t.contractAddress.toLowerCase(), Number(t.tokenDecimal));
    }
  }
  return out;
}
