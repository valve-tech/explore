/**
 * Unit tests for the strict `chainid` guard (middleware/strictChainId.ts) that
 * hardens the REST sub-path surface: a malformed/unsupported `chainid` is a 400
 * rather than the app-level `chainContext` middleware's silent fall-through to
 * the default chain. The bare `/api` root (Etherscan dispatcher) is skipped so
 * its own envelope-shaped validation still runs.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { Request, Response } from "express";
import { strictChainId } from "../../src/middleware/strictChainId.js";
import { ApiError } from "../../src/lib/respond.js";

/** Run the guard against a fake request; returns whether next() was called. */
function run(opts: {
  path: string;
  query?: Record<string, unknown>;
  body?: unknown;
}): { nexted: boolean; error: unknown } {
  const req = {
    path: opts.path,
    query: opts.query ?? {},
    body: opts.body,
  } as unknown as Request;
  let nexted = false;
  try {
    strictChainId(req, {} as Response, () => {
      nexted = true;
    });
    return { nexted, error: null };
  } catch (err) {
    return { nexted, error: err };
  }
}

function expectApiError(error: unknown, status: number): ApiError {
  assert.ok(error instanceof ApiError, `expected ApiError, got ${String(error)}`);
  assert.equal(error.status, status);
  return error;
}

describe("strictChainId guard", () => {
  it("passes a supported chainid on a sub-path", () => {
    for (const id of [1, 369, 943]) {
      const { nexted, error } = run({ path: "/tx/0xabc", query: { chainid: String(id) } });
      assert.equal(error, null);
      assert.ok(nexted);
    }
  });

  it("passes when chainid is omitted (defaults silently)", () => {
    const { nexted, error } = run({ path: "/debug/tx/0xabc/trace" });
    assert.equal(error, null);
    assert.ok(nexted);
  });

  it("rejects an unsupported chainid on a sub-path with a 400 naming the id", () => {
    const { nexted, error } = run({ path: "/tx/0xabc", query: { chainid: "8453" } });
    assert.equal(nexted, false);
    assert.match(expectApiError(error, 400).message, /8453/);
  });

  it("rejects a malformed chainid on a sub-path with a 400", () => {
    assert.equal(expectApiError(run({ path: "/gas/oracle", query: { chainid: "abc" } }).error, 400).status, 400);
    assert.equal(expectApiError(run({ path: "/gas/oracle", query: { chainid: "1.5" } }).error, 400).status, 400);
  });

  it("reads chainid from the request body when the query omits it", () => {
    const { error } = run({ path: "/source/verify", body: { chainid: 8453 } });
    expectApiError(error, 400);
  });

  it("SKIPS the bare /api root (Etherscan dispatcher validates itself)", () => {
    // A bad chainid here must NOT throw — the dispatcher returns its own
    // Etherscan-shaped error envelope downstream.
    const { nexted, error } = run({ path: "/", query: { chainid: "8453" } });
    assert.equal(error, null);
    assert.ok(nexted);
  });
});
