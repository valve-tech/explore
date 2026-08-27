import type {
  NextFunction,
  Request,
  RequestHandler,
  Response,
} from "express";
import { ZodError } from "zod";
import { redactSecrets } from "./redact.js";

/**
 * Domain error carrying its own HTTP status. Throw this from services or
 * handlers when the appropriate status code is known at the throw site —
 * the response envelope below maps it to `res.status(status).json(...)`
 * without any string matching on `err.message`.
 *
 * Example: `throw new ApiError(404, "Fork not found")` from
 * `forkManager.requireFork` lets every route that calls into the manager
 * forward a real 404 without each route reimplementing "not found" detection.
 */
export class ApiError extends Error {
  readonly status: number;
  /**
   * Extra fields to merge into the error response body alongside
   * `{ ok: false, error }`. Use this for status hints clients consult
   * before retrying — e.g. `debugAvailable: false` on a 503 telling the
   * frontend to suggest a different RPC.
   */
  readonly details?: Record<string, unknown>;

  constructor(
    status: number,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

/**
 * Success/failure response writers. The wire format is preserved exactly:
 * `{ ok: true, ...body }` for success, `{ ok: false, error }` for failure —
 * so existing clients and the integration test suite don't notice the
 * refactor.
 *
 * `respond.fail` honors `ApiError.status` when present; everything else is
 * a 500 with the error message (or `fallbackMessage` for non-Error throws,
 * which should be vanishingly rare).
 */
export const respond = {
  ok<T extends Record<string, unknown>>(
    res: Response,
    body: T = {} as T,
  ): void {
    res.json({ ok: true, ...body });
  },

  fail(
    res: Response,
    err: unknown,
    fallbackMessage = "Internal error",
  ): void {
    if (res.headersSent) return;
    if (err instanceof ApiError) {
      res.status(err.status).json({
        ok: false,
        error: redactSecrets(err.message),
        ...(err.details ?? {}),
      });
      return;
    }
    if (err instanceof ZodError) {
      res.status(400).json({
        ok: false,
        error: "Validation error",
        details: err.errors,
      });
      return;
    }
    const message = err instanceof Error ? err.message : fallbackMessage;
    res.status(500).json({ ok: false, error: scrubInternal(message) });
  },
};

/**
 * Strip internal library version footers (e.g. viem appends
 * "\n\nVersion: viem@2.47.5" to every error) before a message reaches a
 * client. Defense-in-depth: routes should map known errors to ApiError with a
 * clean status, but any error that slips through to a 500 shouldn't disclose
 * the dependency or its version.
 */
function scrubInternal(message: string): string {
  return redactSecrets(
    message.replace(/\s*Version:\s*\S+@[\w.-]+\s*$/i, "").trim(),
  );
}

/**
 * Wrap an async route handler so thrown errors (sync or via rejected promise)
 * flow through `respond.fail` instead of crashing the request. Routes shed
 * their per-handler try/catch and the surrounding boilerplate — what's left
 * is the business logic.
 *
 * The wrapper logs the error with the request method and path so server logs
 * still show which route failed and why; the response body never includes
 * the stack.
 *
 * `tag` is a short label prefixed onto the server log (e.g. "testnets",
 * "debugger"). Pass it once per route module so log lines stay greppable.
 */
export function asyncRoute(
  handler: (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => Promise<unknown> | unknown,
  tag?: string,
): RequestHandler {
  return async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (err) {
      const prefix = tag ? `[${tag}]` : `[${req.method} ${req.path}]`;
      // Redacted here too: a key in a log is still a leak.
      console.error(
        redactSecrets(`${prefix} ${err instanceof Error ? err.message : String(err)}`),
      );
      respond.fail(res, err);
    }
  };
}
