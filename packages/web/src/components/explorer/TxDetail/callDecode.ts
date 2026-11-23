import { decodeAbiParameters, parseAbiParameters } from "viem";
import {
  amountArgumentIndex,
  returnsAmount,
  scaledAmount,
} from "./tokenAmountArgs";

/**
 * Decoding for the call tree: calldata and return data to display text.
 *
 * Split from `callExpression.ts`, which assembles one row from these parts.
 * Every function here is best-effort and returns null before it guesses.
 */

/** Shorten an address to head and tail, the way the rest of the app does. */
export function shortAddress(address: string): string {
  return address.length <= 12
    ? address
    : `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/**
 * Return types for the exact signatures a standard fixes.
 *
 * 4byte stores argument types only, so a return type is not derivable in
 * general and this table is the whole of what we claim to know. Every entry is
 * pinned by ERC-20, ERC-721 or the Uniswap V2 pair interface — not by what a
 * name suggests — so `transfer(address,uint256) => true` is a fact, and a
 * signature missing from the table simply renders no return at all.
 */
const KNOWN_RETURNS: Record<string, string> = {
  "transfer(address,uint256)": "bool",
  "approve(address,uint256)": "bool",
  "transferFrom(address,address,uint256)": "bool",
  "balanceOf(address)": "uint256",
  "allowance(address,address)": "uint256",
  "totalSupply()": "uint256",
  "decimals()": "uint8",
  "ownerOf(uint256)": "address",
  "getApproved(uint256)": "address",
  "isApprovedForAll(address,address)": "bool",
  "getReserves()": "uint112,uint112,uint32",
};

/** The argument list inside a text signature, or null when it has none. */
export function argumentTypes(signature: string): string | null {
  const open = signature.indexOf("(");
  if (open === -1 || !signature.endsWith(")")) return null;
  const inner = signature.slice(open + 1, -1).trim();
  return inner === "" ? null : inner;
}

/** The bare name of a text signature — `transfer(address,uint256)` → `transfer`. */
export function methodNameOf(signature: string): string {
  const open = signature.indexOf("(");
  return open === -1 ? signature : signature.slice(0, open);
}

/** A decoded value as one short piece of display text. */
export function formatArgument(value: unknown): string {
  if (typeof value === "bigint") return value.toLocaleString("en-US");
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") {
    if (/^0x[0-9a-fA-F]{40}$/.test(value)) return shortAddress(value);
    if (value.startsWith("0x") && value.length > 14) {
      return `${value.slice(0, 10)}…`;
    }
    return value;
  }
  if (Array.isArray(value)) {
    // A path array is the common case (a swap route). Show its ends.
    if (value.length > 2) {
      return `[${formatArgument(value[0])}…${formatArgument(value[value.length - 1])}]`;
    }
    return `[${value.map(formatArgument).join(", ")}]`;
  }
  return String(value);
}

/**
 * Decode calldata against a text signature.
 *
 * Returns null on anything unexpected — a signature whose types viem cannot
 * parse, calldata that does not match, a tuple this does not handle. A wrong
 * decode is worse than no decode, so every failure falls back to `(…)`.
 */
export function decodeArguments(
  signature: string,
  input: string,
): string[] | null {
  return decodeValues(signature, input)?.map(formatArgument) ?? null;
}

/** The decoded values themselves, before any formatting. */
function decodeValues(signature: string, input: string): unknown[] | null {
  const types = argumentTypes(signature);
  if (types === null) return [];
  const data = input.length > 10 ? `0x${input.slice(10)}` : "0x";
  if (data === "0x") return null;
  try {
    return [
      ...decodeAbiParameters(parseAbiParameters(types), data as `0x${string}`),
    ];
  } catch {
    return null;
  }
}

/**
 * Decode the arguments, printing the token amount at the token's scale.
 *
 * `decimals` is the scale of the CALLED contract, or null when it is not
 * known. Null leaves every integer raw. `full` carries the exact amount for
 * the hover, because `display` trims it to three groups.
 */
export function decodeArgumentsScaled(
  signature: string,
  input: string,
  decimals: number | null,
): { display: string[]; full: string[] } | null {
  const values = decodeValues(signature, input);
  if (values === null) return null;
  const amountAt = decimals === null ? null : amountArgumentIndex(signature);
  const display: string[] = [];
  const full: string[] = [];
  values.forEach((value, i) => {
    if (i === amountAt && typeof value === "bigint" && decimals !== null) {
      const amount = scaledAmount(value, decimals);
      display.push(amount.display);
      full.push(amount.full);
    } else {
      const text = formatArgument(value);
      display.push(text);
      full.push(text);
    }
  });
  return { display, full };
}

/** The return of a call, with a token amount at the token's scale. */
export function decodeReturnScaled(
  signature: string | null | undefined,
  output: string | undefined,
  decimals: number | null,
): { display: string; full: string } | null {
  const raw = decodeReturn(signature, output);
  if (raw === null) return null;
  if (decimals === null || !signature || !returnsAmount(signature)) {
    return { display: raw, full: raw };
  }
  try {
    const [value] = decodeAbiParameters(
      parseAbiParameters("uint256"),
      output as `0x${string}`,
    );
    return scaledAmount(value, decimals);
  } catch {
    return { display: raw, full: raw };
  }
}

/** Decode the return data when a standard fixes its type. */
export function decodeReturn(
  signature: string | null | undefined,
  output: string | undefined,
): string | null {
  if (!signature || !output || output === "0x") return null;
  const types = KNOWN_RETURNS[signature];
  if (types === undefined) return null;
  try {
    const values = decodeAbiParameters(
      parseAbiParameters(types),
      output as `0x${string}`,
    );
    return values.map(formatArgument).join(", ");
  } catch {
    return null;
  }
}
