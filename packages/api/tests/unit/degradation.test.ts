/**
 * Unit tests for the request-scoped verified-source degradation signal.
 *
 *   packages/api/src/services/sourceCode/degradation.ts   (the tracker)
 *   packages/api/src/services/sourceCode/getVerifiedSource.ts  (marks it)
 *
 * The decode route needs to tell "this contract isn't verified" (a definitive
 * empty answer) apart from "we couldn't reach the verifier" (an outage). These
 * tests prove getVerifiedSource marks the scope degraded exactly when a lookup
 * fails to get a definitive answer — an upstream threw, or its breaker was open
 * and the lookup was skipped — and does NOT mark it on a definitive miss.
 *
 * Hermetic: globalThis.fetch and pool.query are stubbed; the breaker is reset
 * per-test via getVerifiedSource's resetBreakers() seam. No network, no DB.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  withDegradationTracking,
  markDegraded,
} from "../../src/services/sourceCode/degradation.js";
import {
  getVerifiedSource,
  resetBreakers,
} from "../../src/services/sourceCode/getVerifiedSource.js";
import { pool } from "../../src/services/pool.js";

// ---------------------------------------------------------------------------
// Stubs — fetch (verified-source upstreams) + pool.query (DB cache read)
// ---------------------------------------------------------------------------

let originalFetch: typeof globalThis.fetch;
let originalPoolQuery: typeof pool.query;
let fetchCalls = 0;

function makeResponse(status: number): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve({}),
    text: () => Promise.resolve("{}"),
  } as unknown as Response;
}

/** Every upstream fetch resolves with `status`; counts invocations. */
function stubFetchStatus(status: number) {
  fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    return makeResponse(status);
  }) as typeof globalThis.fetch;
}

/** Swallow getVerifiedSource's UpstreamError exactly like fetchAbi does, so the
 *  tracking scope resolves and we can read the degraded flag off the return. */
async function lookupSwallowing(address: string): Promise<void> {
  try {
    await getVerifiedSource(address);
  } catch {
    // UpstreamError — mirror the real fetchAbi swallow.
  }
}

// A fresh address per case keeps the module-scope NOT_FOUND_CACHE from leaking
// a prior test's answer into the next.
let counter = 0;
const freshAddress = () =>
  `0xdead${(counter++).toString(16).padStart(36, "0")}`;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  originalPoolQuery = pool.query;
  // DB cache read always misses → force the upstream-fetch path.
  (pool as { query: unknown }).query = (async () => ({ rows: [] })) as unknown;
  resetBreakers();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  (pool as { query: typeof originalPoolQuery }).query = originalPoolQuery;
  resetBreakers();
});

// ---------------------------------------------------------------------------
// The tracker in isolation
// ---------------------------------------------------------------------------

describe("withDegradationTracking / markDegraded", () => {
  it("returns degraded:false when the wrapped fn marks nothing", async () => {
    const { result, degraded } = await withDegradationTracking(async () => 42);
    assert.equal(result, 42);
    assert.equal(degraded, false);
  });

  it("propagates a markDegraded() call inside the scope", async () => {
    const { result, degraded } = await withDegradationTracking(async () => {
      markDegraded();
      return "x";
    });
    assert.equal(result, "x");
    assert.equal(degraded, true);
  });

  it("markDegraded() outside any scope is a no-op and does not throw", () => {
    assert.doesNotThrow(() => markDegraded());
  });
});

// ---------------------------------------------------------------------------
// getVerifiedSource marks the scope when a lookup can't answer definitively
// ---------------------------------------------------------------------------

describe("getVerifiedSource degradation marking", () => {
  it("degraded:false when every upstream definitively answers (404 miss)", async () => {
    stubFetchStatus(404); // definitive "not verified here" from both upstreams
    const address = freshAddress();

    const { result, degraded } = await withDegradationTracking(() =>
      getVerifiedSource(address),
    );

    assert.equal(result, null); // definitive miss
    assert.equal(degraded, false); // a miss is NOT degradation
  });

  it("degraded:true when a lookup throws UpstreamError (503 outage)", async () => {
    stubFetchStatus(503); // both upstreams transiently unavailable
    const address = freshAddress();

    const { degraded } = await withDegradationTracking(() =>
      lookupSwallowing(address),
    );

    assert.equal(degraded, true);
  });

  it("degraded:true when the breaker is open and the lookup is skipped", async () => {
    stubFetchStatus(503);

    // Prime: two failing lookups trip both breakers open (BREAKER_THRESHOLD=2).
    await lookupSwallowing(freshAddress());
    await lookupSwallowing(freshAddress());

    // Now every upstream should be SKIPPED, not fetched. Prove it: reset the
    // fetch counter, run one more lookup inside a fresh tracking scope.
    fetchCalls = 0;
    const address = freshAddress();
    const { degraded } = await withDegradationTracking(() =>
      lookupSwallowing(address),
    );

    assert.equal(degraded, true);
    assert.equal(fetchCalls, 0, "open breaker must skip the upstream, not fetch it");
  });
});
