import { ApiError } from "../../lib/respond.js";
import { isSupportedChain } from "../../services/chains/registry.js";

/** Plain decimal digits only -- no hex/octal/binary/scientific/sign/decimal-point spellings. */
const DECIMAL_ID = /^\d+$/;

/**
 * Parse the optional `chains=1,369` allowlist.
 *
 * `undefined` means "every registered chain". An unregistered or non-numeric id
 * is a 400, never a silent drop: quietly narrowing the fan-out would answer a
 * different question from the one asked, and the caller could not tell.
 *
 * Each id must be plain decimal digits — `Number()` also accepts hex
 * ("0x1"), octal ("0o1"), binary ("0b1"), scientific notation ("1e0"), a
 * leading "+", and a trailing ".0", and would silently normalize every one of
 * those to the same chain id. One spelling per chain id is the point: nothing
 * downstream (an access log, a rate limiter, a future cache key) ever reads
 * the raw query string, so if this parser accepted seven spellings of "1" and
 * something else later reads that string literally, the two would disagree
 * about what was asked for. Rejecting anything but `\d+` closes that off.
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
    // Decimal digits only — see the docblock above. This also rejects a
    // leading "-", so `n <= 0` below is unreachable for anything but "0";
    // left in anyway, since it costs nothing and states the intent.
    if (!DECIMAL_ID.test(trimmed)) {
      throw new ApiError(400, `Invalid chain id: ${trimmed}`);
    }
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
