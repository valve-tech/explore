import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { ApiError, respond } from "./respond.js";

/**
 * Terminal Express error handler.
 *
 * Route handlers wrap themselves in `asyncRoute`, so their thrown `ApiError`s
 * are answered by `respond.fail` and never reach here. MIDDLEWARE has no such
 * wrapper: a synchronous throw from `strictChainId` (or `chainContext`, or
 * `authMiddleware`) runs before any route and is forwarded straight to this
 * handler by Express.
 *
 * That was the gap. This handler used to answer every error with an
 * unconditional `500 {"ok":false,"error":"Internal server error"}`, so
 * `strictChainId`'s deliberate `ApiError(400, "Unsupported chainId: …")` — the
 * one signal that tells a client it asked for a chain this instance doesn't
 * serve — reached the browser as a server fault. `?chainid=11155111` looked
 * like the API was broken rather than like Sepolia wasn't registered, and the
 * middleware's own unit tests passed the whole time because they assert the
 * throw, not the response.
 *
 * So: errors that carry a client-facing status (`ApiError`) or are validation
 * failures (`ZodError`) are delegated to `respond.fail`, which is the same
 * envelope writer the routes use — one definition of the wire format, not two.
 * Everything else stays an opaque 500: an unexpected throw must not leak its
 * message, which is why this can't simply forward every error to
 * `respond.fail` (that path reports `err.message` for a bare `Error`).
 */
export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (res.headersSent) return;

  if (err instanceof ApiError || err instanceof ZodError) {
    respond.fail(res, err);
    return;
  }

  console.error("[unhandled]", err);
  res.status(500).json({ ok: false, error: "Internal server error" });
}
