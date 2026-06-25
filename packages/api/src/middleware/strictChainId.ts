import type { Request, Response, NextFunction } from "express";
import { resolveChainIdParam } from "../lib/chainParam.js";

/**
 * Strict `chainid` guard for the REST `/api/*` sub-path surface.
 *
 * The app-level `chainContext` middleware is deliberately NON-rejecting — it
 * binds the request to a chain but silently falls back to the default chain on
 * a malformed/unsupported `chainid`, to preserve legacy single-chain behavior.
 * That leaves a correctness gap on the read routes that don't validate for
 * themselves (explorer tx/address/block, debug, gas, source, chifra,
 * network-health): a typo'd `?chainid=8453` would quietly return PulseChain
 * data rather than erroring.
 *
 * This guard closes that gap once, for every sub-path, by re-resolving the same
 * `chainid` strictly via the shared `resolveChainIdParam` helper — throwing a
 * 400 (the standard REST envelope via the error handler) on bad input. The
 * chain is already bound to the request context by `chainContext`; this only
 * validates, so a valid id is a no-op and an omitted id stays the default.
 *
 * The bare `/api` root is SKIPPED: that path is the Etherscan dispatcher, which
 * runs its own strict validation and must return its Etherscan-shaped error
 * envelope (not this guard's REST `ApiError` JSON) for a bad `chainid`.
 */
export function strictChainId(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  // `req.path` is relative to the `/api` mount → "/" is the dispatcher root.
  if (req.path === "/") {
    next();
    return;
  }
  const fromBody =
    req.body && typeof req.body === "object"
      ? (req.body as Record<string, unknown>).chainid
      : undefined;
  // Throws ApiError(400) on malformed/unsupported input; Express forwards the
  // synchronous throw to the error handler. Valid/omitted → no-op.
  resolveChainIdParam(req.query.chainid ?? fromBody);
  next();
}
