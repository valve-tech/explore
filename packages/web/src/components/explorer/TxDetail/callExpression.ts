import { decodeAbiParameters, parseAbiParameters, formatUnits } from "viem";

/**
 * Renders one internal call as a Solidity-shaped expression.
 *
 * The table showed Type, From, To, Value and Gas as five columns of hex, and
 * left the reader to work out what called what. Four of those collapse into
 * one line — `WPLS.transfer(0x3474c4…, 1,000)` — once the tree carries the
 * caller and the 4byte source names the selector. From is the row above; Type
 * stays as a small badge because DELEGATECALL and STATICCALL change what the
 * call can do.
 *
 * Everything here is best-effort and every step degrades to the layer below:
 * decoded arguments, then a bare name, then the raw selector. It never invents
 * a name, and it marks one the 4byte source is not sure of.
 */

export interface CallFacts {
  to: string;
  value: string;
  valuePLS: string;
  type: string;
  input: string;
  output?: string;
  isError: string;
  errCode: string;
  methodId?: string;
  methodSignature?: string | null;
  methodCandidates?: number;
}

export interface CallExpression {
  /** `transfer`, or the raw selector, or `send` for a plain value transfer. */
  method: string;
  /** True when the 4byte source offers several names and we picked one. */
  methodIsGuess: boolean;
  /** Decoded arguments, or null when the calldata could not be decoded. */
  args: string[] | null;
  /** Calldata size in bytes, for the `(…)` fallback. */
  calldataBytes: number;
  /** `{value: 1.5 PLS}` modifier text, or null when the call sends nothing. */
  valueModifier: string | null;
  /** The decoded return, when a standard fixes the type. Null otherwise. */
  returns: string | null;
  /** Revert reason when the call failed, else null. */
  error: string | null;
}

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
  const types = argumentTypes(signature);
  if (types === null) return [];
  const data = input.length > 10 ? `0x${input.slice(10)}` : "0x";
  if (data === "0x") return null;
  try {
    const values = decodeAbiParameters(parseAbiParameters(types), data as `0x${string}`);
    return values.map(formatArgument);
  } catch {
    return null;
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

/** How many bytes of calldata a call carries, selector included. */
export function calldataBytes(input: string): number {
  const body = input.startsWith("0x") ? input.slice(2) : input;
  return Math.floor(body.length / 2);
}

/**
 * The `{value: …}` modifier, present only when the call sends native currency.
 *
 * `valuePLS` arrives already scaled by the API. It is re-derived here from the
 * raw integer when that is available, because a scaled string is a display
 * value and this needs to test "is it zero" exactly.
 */
export function valueModifier(
  value: string,
  valuePLS: string,
  symbol: string,
): string | null {
  let isZero: boolean;
  try {
    isZero = BigInt(value || "0") === 0n;
  } catch {
    isZero = valuePLS === "0" || valuePLS === "";
  }
  if (isZero) return null;
  let text = valuePLS;
  try {
    text = trimZeros(formatUnits(BigInt(value), 18));
  } catch {
    // Keep the API's scaled string.
  }
  return `{value: ${text} ${symbol}}`;
}

function trimZeros(text: string): string {
  return text.includes(".") ? text.replace(/\.?0+$/, "") : text;
}

export function toCallExpression(
  call: CallFacts,
  symbol: string,
): CallExpression {
  const selector = call.methodId ?? (call.input.length >= 10 ? call.input.slice(0, 10) : "");
  const signature = call.methodSignature ?? null;
  const candidates = call.methodCandidates ?? 0;

  // No calldata at all is a plain value transfer, not an unnamed function.
  const method =
    selector === ""
      ? "send"
      : signature !== null
        ? methodNameOf(signature)
        : selector;

  return {
    method,
    methodIsGuess: candidates > 1,
    args: signature === null ? null : decodeArguments(signature, call.input),
    calldataBytes: calldataBytes(call.input),
    valueModifier: valueModifier(call.value, call.valuePLS, symbol),
    returns: decodeReturn(signature, call.output),
    error: call.isError === "1" ? call.errCode || "reverted" : null,
  };
}
