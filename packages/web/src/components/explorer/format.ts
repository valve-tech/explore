import { formatEther, formatUnits } from "viem";
import { chainSymbol } from "../../lib/chains";

export function truncateAddr(addr: string): string {
  if (!addr || addr.length < 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

const SUBSCRIPT_DIGITS = "₀₁₂₃₄₅₆₇₈₉";

/** Render a non-negative integer as Unicode subscript digits. */
function toSubscript(n: number): string {
  return String(n)
    .split("")
    .map((d) => SUBSCRIPT_DIGITS[Number(d)] ?? d)
    .join("");
}

/** True when an exact decimal string represents zero (e.g. "0", "0.000", "-0"). */
export function isZeroDecimal(value: string): boolean {
  return /^-?0*(\.0*)?$/.test(value.trim());
}

/**
 * Group an EXACT decimal string for display — thousands separators on the
 * integer part, fraction capped (truncated, never rounded up) and trailing
 * zeros stripped. Pure string ops: never `parseFloat`, so a value past 2^53
 * stays exact. Input is assumed already-scaled (e.g. a `formatEther`/
 * `formatUnits` result), so storage stays raw and this is display-only.
 */
export function groupDecimalString(value: string, maxFractionDigits: number): string {
  let v = value.trim();
  const negative = v.startsWith("-");
  if (negative) v = v.slice(1);
  let [intPart = "0", fracPart = ""] = v.split(".");
  intPart = intPart.replace(/^0+(?=\d)/, ""); // drop leading zeros, keep one digit
  intPart = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  fracPart = fracPart.slice(0, maxFractionDigits).replace(/0+$/, "");
  return `${negative ? "-" : ""}${intPart}${fracPart ? `.${fracPart}` : ""}`;
}

/**
 * Compact rendering for very small magnitudes using the leading-zero-subscript
 * notation popularized by DEX UIs:
 *
 *   0.00000000123  →  "0.0₈123"   (₈ = eight leading zeros after the point)
 *
 * Operates on an EXACT decimal string (no float). Only kicks in at 3+ leading
 * zeros — below that, plain decimals read fine. Returns null when the value
 * isn't a sub-1 magnitude with enough leading zeros.
 */
export function subscriptSmallString(value: string, sigFigs = 4): string | null {
  let v = value.trim();
  const negative = v.startsWith("-");
  if (negative) v = v.slice(1);
  const [intPart = "0", fracPart = ""] = v.split(".");
  if (intPart.replace(/0/g, "") !== "" || fracPart === "") return null; // |x| >= 1
  const leadingZeros = (fracPart.match(/^0*/)?.[0].length) ?? 0;
  if (leadingZeros < 3) return null;
  const digits =
    fracPart.slice(leadingZeros, leadingZeros + sigFigs).replace(/0+$/, "") || "0";
  return `${negative ? "-" : ""}0.0${toSubscript(leadingZeros)}${digits}`;
}

/**
 * Format an EXACT decimal native-value string (a `formatEther` result) for
 * display. String ops only — never `parseFloat` — so large balances stay
 * exact. Tiny magnitudes use the subscript notation; everything else groups
 * + caps to 6 fraction digits. `symbol` is the chain's native ticker
 * (chains.ts `chainSymbol`); the name mirrors the wire fields (`valuePLS`),
 * which predate multichain.
 */
export function formatPLS(valuePLS: string, symbol: string = "PLS"): string {
  if (isZeroDecimal(valuePLS)) return `0 ${symbol}`;
  const small = subscriptSmallString(valuePLS);
  if (small !== null) return `${small} ${symbol}`;
  return `${groupDecimalString(valuePLS, 6)} ${symbol}`;
}

/**
 * Format a raw native-balance string, in wei, for display. Scales wei to
 * whole units with viem's `formatEther`, then hands the exact decimal string
 * to `formatPLS` with the chain's own ticker. Storage stays a raw integer;
 * this is the one place it gets scaled, at the render edge.
 */
export function formatNative(balanceWei: string, chainId: number): string {
  return formatPLS(formatEther(BigInt(balanceWei)), chainSymbol(chainId));
}

/**
 * Format an EXACT wei decimal string as gwei for display: subscript
 * notation for sub-1-gwei magnitudes, grouped + capped to 2 fraction
 * digits otherwise. String ops only, no float.
 *
 * This is the SAME logic the explorer stat cards use for a base fee /
 * priority fee, pulled out here so every gas readout on the page — the
 * stat card and the gas oracle strip — agrees on one figure instead of
 * two different formatters disagreeing about whether a fee is "0 gwei".
 */
export function formatGweiDisplay(weiDecimal: string): string {
  try {
    const gwei = formatUnits(BigInt(weiDecimal), 9);
    return subscriptSmallString(gwei) ?? groupDecimalString(gwei, 2);
  } catch {
    return weiDecimal;
  }
}
