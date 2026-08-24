import { ApiError } from "../../lib/respond.js";
import { isSupportedChain } from "../../services/chains/registry.js";

/**
 * Parse the optional `chains=1,369` allowlist.
 *
 * `undefined` means "every registered chain". An unregistered or non-numeric id
 * is a 400, never a silent drop: quietly narrowing the fan-out would answer a
 * different question from the one asked, and the caller could not tell.
 */
export function parseChainsParam(raw: string | undefined): number[] | undefined {
  if (!raw || raw.trim() === "") return undefined;

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
