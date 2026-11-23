import { formatUnits } from "viem";
import {
  decodeArgumentsScaled,
  decodeReturnScaled,
  methodNameOf,
} from "./callDecode";

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
  /**
   * The same arguments with every token amount at its exact scaled value.
   * Differs from `args` only where an amount was trimmed for the row.
   */
  argsFull: string[] | null;
  /** Calldata size in bytes, for the `(…)` fallback. */
  calldataBytes: number;
  /** `{value: 1.5 PLS}` modifier text, or null when the call sends nothing. */
  valueModifier: string | null;
  /** The decoded return, when a standard fixes the type. Null otherwise. */
  returns: string | null;
  /** The exact return, when `returns` is a trimmed token amount. Else equal. */
  returnsFull: string | null;
  /** Revert reason when the call failed, else null. */
  error: string | null;
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
  /** Token decimals of `call.to`, when known. Null leaves amounts raw. */
  decimals: number | null = null,
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

  const args =
    signature === null
      ? null
      : decodeArgumentsScaled(signature, call.input, decimals);
  const returns = decodeReturnScaled(signature, call.output, decimals);

  return {
    method,
    methodIsGuess: candidates > 1,
    args: args?.display ?? null,
    argsFull: args?.full ?? null,
    calldataBytes: calldataBytes(call.input),
    valueModifier: valueModifier(call.value, call.valuePLS, symbol),
    returns: returns?.display ?? null,
    returnsFull: returns?.full ?? null,
    error: call.isError === "1" ? call.errCode || "reverted" : null,
  };
}
