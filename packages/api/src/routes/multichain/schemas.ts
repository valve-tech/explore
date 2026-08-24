import { ApiError } from "../../lib/respond.js";
import { isSupportedChain } from "../../services/chains/registry.js";

/**
 * Parse the optional `chains=1,369` allowlist.
 *
 * `undefined` means "every registered chain". An unregistered or non-numeric id
 * is a 400, never a silent drop: quietly narrowing the fan-out would answer a
 * different question from the one asked, and the caller could not tell.
 *
 * `raw` is `req.query.chains` verbatim, typed loosely because Express parses a
 * REPEATED key (`chains=1&chains=369`) into a string array, not the
 * comma-joined string a single `chains=1,369` gives. A caller that only
 * checked `typeof raw === "string"` treated the array form as absent and
 * silently fell back to "every chain" — the one thing this parser promises
 * never to do. Reject it with a 400 instead of guessing which form the
 * caller meant.
 */
export function parseChainsParam(raw: unknown): number[] | undefined {
  if (Array.isArray(raw)) {
    throw new ApiError(
      400,
      "chains must be a single comma-separated value, not a repeated parameter",
    );
  }
  if (raw === undefined || typeof raw !== "string" || raw.trim() === "") return undefined;

  const ids = raw.split(",").map((part) => {
    const trimmed = part.trim();
    const n = Number(trimmed);
    if (!Number.isInteger(n) || n <= 0) {
      throw new ApiError(400, `Invalid chain id: ${trimmed}`);
    }
    if (!isSupportedChain(n)) {
      throw new ApiError(400, `Unregistered chain id: ${n}`);
    }
    return n;
  });

  return [...new Set(ids)].sort((a, b) => a - b);
}
