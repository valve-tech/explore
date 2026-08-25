import { formatEther, formatUnits } from "viem";
import { subscriptSmallString, groupDecimalString } from "../format";

/** Thousands separators on a decimal block number. */
export function formatBlockNum(decimal: string): string {
  return decimal.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * wei → gwei, re-exported rather than reimplemented.
 *
 * There used to be two of these: this one, and a zero-decimal variant inside
 * `GasOracleWidget`. On chain 1 the stat tile read "0.11 gwei" while the gas
 * strip directly beneath it read "base 0 gwei" for the same number. One
 * formatter now, in `../format`, so a second door cannot reopen that.
 */
export { formatGweiDisplay as formatGwei } from "../format";

const ONE_MILLION = 1_000_000n * 10n ** 18n;

/** wei → native units, compacted at a million. */
export function formatNative(weiDecimal: string): string {
  try {
    const wei = BigInt(weiDecimal);
    if (wei === 0n) return "0";
    if (wei > ONE_MILLION) {
      return `${groupDecimalString(formatUnits(wei, 24), 2)}M`;
    }
    const whole = formatEther(wei);
    return subscriptSmallString(whole) ?? groupDecimalString(whole, 4);
  } catch {
    return weiDecimal;
  }
}

/**
 * Gas used as a 0..1 ratio, for EntityRow's background fill.
 *
 * Returns undefined rather than 0 when the limit is 0 or the input is
 * unparseable. EntityRow renders no fill for a non-finite share, and "no
 * answer" is the truthful rendering of an unknown — a 0 would draw an empty
 * bar that reads as a measured, genuinely empty block.
 */
export function gasShare(used: string, limit: string): number | undefined {
  try {
    const l = BigInt(limit);
    if (l === 0n) return undefined;
    return Number((BigInt(used) * 10_000n) / l) / 10_000;
  } catch {
    return undefined;
  }
}

/** Integer percent, exact in bigint. "—" when there is nothing to divide by. */
export function gasPctLabel(used: string, limit: string): string {
  try {
    const l = BigInt(limit);
    if (l === 0n) return "—";
    return `${(BigInt(used) * 100n) / l}%`;
  } catch {
    return "—";
  }
}

export function ago(unixSeconds: number): string {
  const delta = Math.max(0, Math.floor(Date.now() / 1000) - unixSeconds);
  if (delta < 5) return "just now";
  if (delta < 60) return `${delta}s ago`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
  return `${Math.floor(delta / 86400)}d ago`;
}
