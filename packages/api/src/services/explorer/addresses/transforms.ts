import { formatEther, formatUnits } from "viem";

/**
 * Pure transforms for the address-explorer service. Each function maps
 * hydrated RPC data (viem getTransaction / getTransactionReceipt /
 * balanceOf reads over chifra-listed appearances) into the shape the
 * addresses.ts caller returns.
 *
 * Extracted so the defensive fallbacks (missing fields, malformed
 * BigInt input, failed reads) are testable without mocking external
 * clients — the parent fetcher is just a thin shell around these.
 */

export interface AddressTransactionBase {
  hash: string;
  blockNumber: string;
  timeStamp: string;
  from: string;
  to: string;
  value: string;
  valuePLS: string;
  gas: string;
  gasUsed: string;
  gasPrice: string;
  isError: string;
  functionName: string;
  /**
   * How many signatures the 4byte directories hold for `methodId`.
   *
   * 0 when nothing resolved, 1 for a single confident match, and N > 1 when
   * `functionName` is the first of several guesses. See `SelectorSummary` in
   * services/signatures.ts for why that is the common case, not the edge one.
   */
  functionCandidates: number;
  methodId: string;
  input: string;
}

/** The viem fields buildAddressTransaction reads (subset of Transaction). */
export interface HydratedTx {
  hash: string;
  blockNumber: bigint | null;
  from: string;
  to: string | null;
  value: bigint;
  gas: bigint;
  gasPrice?: bigint;
  input: string;
}

/**
 * Build the wire row from a hydrated tx + its receipt + the block
 * timestamp. `functionName` and `functionCandidates` come from a best-effort
 * selector lookup the caller performs in batch; missing pieces default to
 * empty/zero so the row always renders.
 */
export function buildAddressTransaction(
  tx: HydratedTx,
  receipt: { gasUsed: bigint; status: string } | null,
  timestamp: number | null,
  functionName: string = "",
  functionCandidates: number = 0,
): AddressTransactionBase {
  const methodId = tx.input && tx.input.length >= 10 ? tx.input.slice(0, 10) : "";
  return {
    hash: tx.hash,
    blockNumber: tx.blockNumber != null ? tx.blockNumber.toString() : "",
    timeStamp: timestamp != null ? String(timestamp) : "",
    from: tx.from,
    to: tx.to ?? "",
    value: tx.value.toString(),
    valuePLS: formatEther(tx.value),
    gas: tx.gas.toString(),
    gasUsed: receipt ? receipt.gasUsed.toString() : "",
    gasPrice: tx.gasPrice != null ? tx.gasPrice.toString() : "0",
    isError: receipt ? (receipt.status === "success" ? "0" : "1") : "0",
    functionName,
    functionCandidates,
    methodId,
    input: tx.input,
  };
}

export interface AddressTokenView {
  balance: string;
  formattedBalance: string;
  contractAddress: string;
  name: string;
  symbol: string;
  decimals: string;
  type: string;
}

/**
 * Build the token-view row from a balanceOf read + metadata reads.
 * Missing/malformed `decimals` falls back to the raw balance string
 * (formatUnits would throw on garbage input). A token whose decimals
 * read failed is presumed non-fungible-ish and typed "ERC-721"; the
 * common case types "ERC-20".
 */
export function buildAddressToken(
  contractAddress: string,
  balance: bigint,
  meta: { name: string; symbol: string; decimals: string | null },
): AddressTokenView {
  const rawBalance = balance.toString();
  let formattedBalance = rawBalance;
  if (meta.decimals !== null) {
    // Validate before formatUnits: it doesn't throw on NaN, it silently
    // misformats — keep the raw string for garbage decimals instead.
    const decimals = parseInt(meta.decimals, 10);
    if (Number.isInteger(decimals) && decimals >= 0 && decimals <= 255) {
      formattedBalance = formatUnits(balance, decimals);
    }
  }
  return {
    balance: rawBalance,
    formattedBalance,
    contractAddress,
    name: meta.name,
    symbol: meta.symbol,
    decimals: meta.decimals ?? "0",
    type: meta.decimals !== null ? "ERC-20" : "ERC-721",
  };
}

export interface FeeFields {
  type: string;
  maxFeePerGas: string | null;
  maxPriorityFeePerGas: string | null;
}

/**
 * Extract the EIP-1559 fee fields + tx type from a viem
 * getTransaction result. Missing values render as `null` (the wire
 * shape the frontend expects). The defensive null defaults make
 * legacy txs (no maxFee fields at all) render correctly.
 */
export function extractTxTypeAndFees(tx: {
  type?: string;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
}): FeeFields {
  return {
    type: tx.type ?? "legacy",
    maxFeePerGas: tx.maxFeePerGas != null ? tx.maxFeePerGas.toString() : null,
    maxPriorityFeePerGas:
      tx.maxPriorityFeePerGas != null
        ? tx.maxPriorityFeePerGas.toString()
        : null,
  };
}

/**
 * The fallback fee-field set used when a tx's full fee data is
 * unavailable. The base row still carries the essentials, so the row
 * renders; just the 1559 caps are unknown.
 */
export const LEGACY_FALLBACK_FEES: FeeFields = {
  type: "legacy",
  maxFeePerGas: null,
  maxPriorityFeePerGas: null,
};
