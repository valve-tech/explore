/**
 * Unit tests for the terminal Express error handler (lib/errorHandler.ts).
 *
 * The gap these close: `strictChainId` throws `ApiError(400, "Unsupported
 * chainId: N")` for a chain this instance doesn't serve, and
 * `strictChainId.test.ts` proves it does. But it's MIDDLEWARE — there's no
 * `asyncRoute` wrapper to answer the throw, so Express forwarded it to a handler
 * that replied `500 {"ok":false,"error":"Internal server error"}` to everything.
 * A client asking for an unregistered chain (`?chainid=11155111` before Sepolia
 * was registered) was told the server had failed. Nothing tested the wire
 * response, so both sides looked correct in isolation.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { errorHandler } from "../../src/lib/errorHandler.js";
import { ApiError } from "../../src/lib/respond.js";

interface Captured {
  status: number;
  body: unknown;
}

/** Minimal Response double that records what the handler wrote. */
function fakeRes(headersSent = false): {
  res: Response;
  captured: () => Captured | null;
} {
  let captured: Captured | null = null;
  let status = 200;
  const res = {
    headersSent,
    status(code: number) {
      status = code;
      return this;
    },
    json(body: unknown) {
      captured = { status, body };
      return this;
    },
  } as unknown as Response;
  return { res, captured: () => captured };
}

function handle(err: unknown, headersSent = false): Captured | null {
  const { res, captured } = fakeRes(headersSent);
  errorHandler(
    err as Error,
    {} as Request,
    res,
    (() => {}) as unknown as NextFunction,
  );
  return captured();
}

describe("errorHandler — client-facing errors keep their status", () => {
  it("answers an ApiError(400) with 400, not 500", () => {
    const out = handle(new ApiError(400, "Unsupported chainId: 8453"));
    assert.equal(out?.status, 400);
    assert.deepEqual(out?.body, {
      ok: false,
      error: "Unsupported chainId: 8453",
    });
  });

  it("carries the full range of ApiError statuses through", () => {
    for (const status of [400, 401, 403, 404, 429, 503]) {
      assert.equal(handle(new ApiError(status, "nope"))?.status, status);
    }
  });

  it("merges ApiError.details into the body (clients gate retries on them)", () => {
    const out = handle(
      new ApiError(503, "debug RPC unavailable", { debugAvailable: false }),
    );
    assert.equal(out?.status, 503);
    assert.deepEqual(out?.body, {
      ok: false,
      error: "debug RPC unavailable",
      debugAvailable: false,
    });
  });

  it("answers a ZodError with a 400 validation envelope", () => {
    const err = z.object({ n: z.number() }).safeParse({ n: "x" }).error!;
    const out = handle(err);
    assert.equal(out?.status, 400);
    assert.equal((out?.body as { error: string }).error, "Validation error");
  });
});

describe("errorHandler — unexpected errors stay opaque", () => {
  it("answers a bare Error with an opaque 500 that does NOT leak the message", () => {
    const out = handle(new Error("connect ECONNREFUSED 10.0.0.7:5432"));
    assert.equal(out?.status, 500);
    assert.deepEqual(out?.body, { ok: false, error: "Internal server error" });
    assert.doesNotMatch(JSON.stringify(out?.body), /ECONNREFUSED|10\.0\.0\.7/);
  });

  it("answers a non-Error throw with the same opaque 500", () => {
    assert.deepEqual(handle("kaboom")?.body, {
      ok: false,
      error: "Internal server error",
    });
  });
});

describe("errorHandler — never writes twice", () => {
  it("no-ops once the response has already been sent", () => {
    // A route that streamed a partial body then threw must not have a second
    // status/JSON written over it.
    assert.equal(handle(new ApiError(400, "too late"), true), null);
    assert.equal(handle(new Error("too late"), true), null);
  });
});
