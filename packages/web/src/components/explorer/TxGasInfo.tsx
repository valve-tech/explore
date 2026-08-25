/**
 * Compact gas + tx-type readout for transaction lists. Surfaces the fields
 * the node actually orders on — the priority tip (maxPriorityFeePerGas) and
 * the fee cap (maxFeePerGas) — plus the EIP tx-type, so a sorted list makes
 * the inclusion logic visible at a glance.
 */

import { formatGwei } from "../../lib/format/tokenAmount";

interface Props {
  /** viem tx-type string: "legacy" | "eip2930" | "eip1559" | "eip4844" | … */
  type: string;
  gasPrice: string | null;
  maxFeePerGas: string | null;
  maxPriorityFeePerGas: string | null;
  className?: string;
}

/** Short human label for a viem tx-type string. */
function typeLabel(type: string): string {
  switch (type) {
    case "legacy":
      return "Legacy";
    case "eip2930":
      return "EIP-2930";
    case "eip1559":
      return "EIP-1559";
    case "eip4844":
      return "Blob (4844)";
    case "eip7702":
      return "EIP-7702";
    default:
      return type;
  }
}

/** wei decimal string → gwei, trimmed (exact). Null for null/garbage input. */
function toGwei(wei: string | null): string | null {
  return formatGwei(wei, 3);
}

/**
 * True only when both raw wei strings parse and carry the exact same value.
 * Compares the RAW integers, never the formatted (rounded) gwei strings —
 * two different wei amounts can round to the same display text at 3 decimal
 * places, and treating those as "equal" would hide a real difference.
 */
function sameWei(a: string | null, b: string | null): boolean {
  if (a == null || b == null) return false;
  try {
    return BigInt(a) === BigInt(b);
  } catch {
    return false;
  }
}

export function TxGasInfo({
  type,
  gasPrice,
  maxFeePerGas,
  maxPriorityFeePerGas,
  className = "",
}: Props) {
  const tip = toGwei(maxPriorityFeePerGas);
  const cap = toGwei(maxFeePerGas);
  const legacy = toGwei(gasPrice);
  const tipEqualsCap = sameWei(maxPriorityFeePerGas, maxFeePerGas);
  const isDefaultType = type === "eip1559";

  return (
    <span
      className={`inline-flex items-center min-w-0 gap-tight font-mono text-[10px] tabular-nums theme-text-muted ${className}`}
    >
      <span
        className={
          isDefaultType
            ? "shrink-0 theme-text-muted"
            : "px-1.5 py-0.5 uppercase tracking-wider font-semibold shrink-0 theme-tertiary-bg theme-text-secondary"
        }
      >
        {typeLabel(type)}
      </span>
      {tip != null || cap != null ? (
        <span className="min-w-0 break-words">
          {tipEqualsCap ? (
            <>tip = cap {cap} gwei</>
          ) : (
            <>
              {tip != null && <>tip {tip}</>}
              {tip != null && cap != null && " / "}
              {cap != null && <>cap {cap}</>} gwei
            </>
          )}
        </span>
      ) : legacy != null ? (
        <span className="min-w-0 break-words">{legacy} gwei</span>
      ) : null}
    </span>
  );
}
