/**
 * One page-size rule for the address transaction list.
 *
 * Two routes serve that list: `GET /api/address/:address/txs` (`limit`) and
 * the Etherscan-compatible `module=account&action=txlist` (`offset`). The
 * first clamped to 100 without a word. The second did not clamp at all.
 *
 * Both now REJECT a size over the maximum. A clamp is the wrong answer for a
 * paginated list: a client finds the last page by a page shorter than the
 * size it asked for. Ask for 1000, receive 100, and the client stops there
 * and reports 100 rows as the full history. Etherscan itself rejects an
 * oversized window ("Result window is too large…"), so an Etherscan client
 * already handles this error.
 *
 * A missing, non-numeric or non-positive size is not an error. It takes the
 * default, as it did before.
 */

export const ADDRESS_TXS_MAX_PAGE_SIZE = 100;
export const ADDRESS_TXS_DEFAULT_PAGE_SIZE = 25;

export type PageSizeResult =
  | { ok: true; size: number }
  | { ok: false; requested: number; max: number; message: string };

export function resolvePageSize(
  raw: unknown,
  paramName: string,
  max: number = ADDRESS_TXS_MAX_PAGE_SIZE,
  fallback: number = ADDRESS_TXS_DEFAULT_PAGE_SIZE,
): PageSizeResult {
  const n = parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n) || n <= 0) return { ok: true, size: fallback };
  if (n > max) {
    return {
      ok: false,
      requested: n,
      max,
      message: `Result window is too large, ${paramName} must be less than or equal to ${max} (requested ${n})`,
    };
  }
  return { ok: true, size: n };
}
