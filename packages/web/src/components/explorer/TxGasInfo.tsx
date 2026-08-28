/**
 * Compact gas + tx-type readout for transaction lists. Surfaces the fields
 * the node actually orders on — the priority tip (maxPriorityFeePerGas) and
 * the fee cap (maxFeePerGas) — plus the EIP tx-type, so a sorted list makes
 * the inclusion logic visible at a glance.
 *
 * It also shows the GAS ACTUALLY USED, which the column header has always
 * promised and this component never received. Until 2026-08-28 it took only
 * `type` and the three fee fields, so a column labelled "Gas / Type" rendered
 * `EIP-1559 tip 2 / cap 2.061 gwei` — a fee price and a type, no gas anywhere.
 * The row already carried `gasUsed`; nothing was passing it in.
 */

import { formatGwei } from "../../lib/format/tokenAmount";

interface Props {
  /** viem tx-type string: "legacy" | "eip2930" | "eip1559" | "eip4844" | … */
  type: string;
  gasPrice: string | null;
  maxFeePerGas: string | null;
  maxPriorityFeePerGas: string | null;
  /** Gas units the transaction actually consumed. */
  gasUsed?: string | null;
  className?: string;
}

/**
 * Gas units as a grouped integer, or `null` when there is nothing to show.
 *
 * A receipt that failed to load leaves this absent, and "0 gas" would be a
 * claim rather than a gap — every mined transaction burns at least 21,000 —
 * so a zero reads as missing and renders nothing.
 */
export function formatGasUsed(gasUsed: string | null | undefined): string | null {
  if (gasUsed == null) return null;
  let n: bigint;
  try {
    n = BigInt(gasUsed);
  } catch {
    return null;
  }
  if (n <= 0n) return null;
  return n.toLocaleString("en-US");
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
  gasUsed = null,
  className = "",
}: Props) {
  const gas = formatGasUsed(gasUsed);
  const tip = toGwei(maxPriorityFeePerGas);
  const cap = toGwei(maxFeePerGas);
  const legacy = toGwei(gasPrice);
  const tipEqualsCap = sameWei(maxPriorityFeePerGas, maxFeePerGas);
  const isDefaultType = type === "eip1559";

  // ONE LINE, deliberately. This cell used to wrap to 4-5 lines in a 167px
  // column while every other column was 1 line, so it alone set the height of
  // every row — measured 2026-08-28 at a 1200px viewport: 87px against 45px.
  // `break-words` plus three segments of prose ("tip 2 / cap 2.061 gwei") is
  // more text than the column can hold, so the fee moves to the title and the
  // cell keeps what the header promises: gas, and the type.
  const feeText =
    tip != null || cap != null
      ? tipEqualsCap
        ? `tip = cap ${cap} gwei`
        : [tip != null ? `tip ${tip}` : null, cap != null ? `cap ${cap}` : null]
            .filter(Boolean)
            .join(" / ") + " gwei"
      : legacy != null
        ? `gas price ${legacy} gwei`
        : null;

  const title = [typeLabel(type), gas != null ? `${gas} gas` : null, feeText]
    .filter(Boolean)
    .join(" · ");

  return (
    <span
      title={title}
      className={`inline-flex items-baseline min-w-0 gap-tight font-mono text-[10px] tabular-nums whitespace-nowrap theme-text-muted ${className}`}
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
      {gas != null && <span className="shrink-0 theme-text">{gas}</span>}
    </span>
  );
}
