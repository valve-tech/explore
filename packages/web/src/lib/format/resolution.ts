/**
 * Trim a grouped decimal string to a fixed number of THREE-DIGIT GROUPS of
 * resolution, counting from the most significant group that carries a digit.
 *
 * The idea: a reader comparing amounts in a column needs magnitude and a couple
 * of significant groups. They do not need six decimal places of a number in the
 * millions — those digits cost horizontal space in every row and are never read.
 * The full value stays one hover away (see `CopyableValue`).
 *
 *   8,360,092.287297  ->  8,360,092      3 integer groups, decimals dropped
 *   12,345.678901     ->  12,345.678     2 integer + 1 decimal group
 *   1.234567891       ->  1.234567       1 integer + 2 decimal groups
 *   0.000000123456    ->  0.000000123    leading zero groups are not resolution
 *
 * SIGNIFICANCE, NOT POSITION. A leading `0` integer part is not a group worth
 * spending resolution on, and neither are all-zero decimal groups before the
 * first significant one — otherwise `0.000000123456` would render as `0.000000`
 * and read as zero, which is worse than not truncating at all.
 *
 * STRING-ONLY, like the rest of this module. Never `Number()` — these values
 * routinely exceed 2^53 and a float round-trip silently corrupts them.
 */

/** Split a fraction string into three-digit groups: "287297" -> ["287","297"]. */
function fractionGroups(frac: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < frac.length; i += 3) out.push(frac.slice(i, i + 3));
  return out;
}

export interface ResolutionOptions {
  /** How many significant three-digit groups to keep. Default 3. */
  groups?: number;
}

/**
 * `display` is the trimmed form; `truncated` says whether anything was dropped,
 * so a caller can skip the hover affordance when the value is already complete.
 * Returning both is deliberate — a component that has to re-derive "did this
 * change?" by comparing strings will eventually compare the wrong pair.
 */
export interface Resolution {
  display: string;
  truncated: boolean;
}

/**
 * `value` must already be grouped for display (commas in the integer part), as
 * `formatAmountDisplay` returns. A trailing unit/symbol is preserved untouched.
 */
export function toResolutionGroups(
  value: string,
  { groups = 3 }: ResolutionOptions = {},
): Resolution {
  if (!value) return { display: value, truncated: false };

  // Peel a trailing symbol ("8,360,092.287297 PLS") so it survives untouched.
  const spaceAt = value.indexOf(" ");
  const suffix = spaceAt === -1 ? "" : value.slice(spaceAt);
  const numeric = spaceAt === -1 ? value : value.slice(0, spaceAt);

  const negative = numeric.startsWith("-");
  const body = negative ? numeric.slice(1) : numeric;
  const [intPart = "", fracPart = ""] = body.split(".");
  if (!fracPart) return { display: value, truncated: false };

  const intGroups = intPart ? intPart.split(",").length : 0;
  // A bare "0" integer part carries no resolution — spend the budget on the
  // fraction instead, or 0.000000123456 collapses to an apparent zero.
  const intSignificant = intPart && intPart !== "0" ? intGroups : 0;

  let remaining = groups - intSignificant;
  if (remaining <= 0) {
    const display = `${negative ? "-" : ""}${intPart}${suffix}`;
    return { display, truncated: true };
  }

  const fgroups = fractionGroups(fracPart);
  const kept: string[] = [];
  // Zero groups DO spend budget — that is what makes 0.000000123456 render as
  // 0.000000123 rather than carrying six more digits nobody reads.
  //
  // But the budget must never expire before a significant digit appears, or
  // 0.000000000123 becomes "0.000000000" and reads as ZERO. Overrunning the
  // budget is the lesser evil: a slightly wider cell beats a wrong number.
  let seenSignificant = intSignificant > 0;
  for (const g of fgroups) {
    kept.push(g);
    remaining -= 1;
    if (/[1-9]/.test(g)) seenSignificant = true;
    if (remaining <= 0 && seenSignificant) break;
  }

  const keptFrac = kept.join("").replace(/0+$/, "");
  const truncated = keptFrac.length < fracPart.replace(/0+$/, "").length;
  const display = `${negative ? "-" : ""}${intPart}${keptFrac ? `.${keptFrac}` : ""}${suffix}`;
  return { display, truncated };
}
