/**
 * Unit tests for the chain scoping of the tracer caches.
 *
 * The bug these pin: `trace_cache` was keyed (tx_hash, trace_type) with no
 * chain, and the two in-process tracer caches were keyed by tx hash alone. One
 * chain's trace was therefore served to every chain — `/debugger/<a 943 tx>`
 * rendered that tx's call tree on a `?chainid=369` request while the live
 * gas/opcode fetches for 369 correctly said "transaction not found". See
 * migration 012.
 *
 * The Postgres queries are asserted by inspecting the SQL + params the module
 * sends, so no database is needed: the contract under test is "the chain is in
 * the key", which is entirely visible at the query boundary.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { pool } from "../../src/services/pool.js";
import {
  chainScopedTraceKey,
  getCachedTrace,
  setCachedTrace,
} from "../../src/services/tracer/cache.js";
import { runWithChain } from "../../src/services/chains/context.js";

const HASH = "0x6623746F47780374BEF46E4B5A1F35F4404CEABF42B4E435109E2F8547FB484D";
const LOWER = HASH.toLowerCase();

/** Every query the module under test sent, in order. */
const queries: Array<{ sql: string; params: unknown[] }> = [];
/** Rows the stubbed pool hands back to the next read. */
let nextRows: unknown[] = [];

// pool.query is swapped in place — the same stub-the-export pattern the other
// hermetic unit tests here use (see degradation.test.ts). No database needed:
// the contract under test ("the chain is part of the key") is fully visible at
// the query boundary.
let originalPoolQuery: typeof pool.query;

beforeEach(() => {
  queries.length = 0;
  nextRows = [];
  originalPoolQuery = pool.query;
  (pool as { query: unknown }).query = (async (
    sql: string,
    params: unknown[],
  ) => {
    queries.push({ sql, params });
    return { rows: nextRows };
  }) as unknown;
});

afterEach(() => {
  (pool as { query: typeof originalPoolQuery }).query = originalPoolQuery;
});

describe("trace_cache reads are chain-scoped", () => {
  it("filters on chain_id, and on the lowercased hash", async () => {
    await runWithChain(943, () => getCachedTrace(HASH, "calltree"));

    assert.equal(queries.length, 1);
    const { sql, params } = queries[0]!;
    assert.match(sql, /chain_id = \$1/);
    assert.deepEqual(params, [943, LOWER, "calltree"]);
  });

  it("reads the active request's chain, not a fixed default", async () => {
    await runWithChain(1, () => getCachedTrace(HASH, "skeleton"));
    await runWithChain(11155111, () => getCachedTrace(HASH, "skeleton"));

    assert.deepEqual(
      queries.map((q) => q.params[0]),
      [1, 11155111],
    );
  });

  it("outside a request context it falls back to the default chain (369)", async () => {
    await getCachedTrace(HASH, "calltree");
    assert.equal(queries[0]!.params[0], 369);
  });

  it("a row cached for one chain is NOT returned to another", async () => {
    // The same hash, asked for on two chains: whatever the DB returns, the
    // WHERE clause that produced it must have named the asking chain. This is
    // the assertion the old (tx_hash, trace_type) key could not satisfy.
    nextRows = [{ result: { to: "0xdead" } }];
    await runWithChain(369, () => getCachedTrace(HASH, "calltree"));
    await runWithChain(943, () => getCachedTrace(HASH, "calltree"));

    const chains = queries.map((q) => q.params[0]);
    assert.deepEqual(chains, [369, 943]);
    assert.notEqual(chains[0], chains[1]);
  });
});

describe("trace_cache writes are chain-scoped", () => {
  it("inserts chain_id and conflicts on (chain_id, tx_hash, trace_type)", async () => {
    await runWithChain(943, () =>
      setCachedTrace(HASH, "calltree", { to: "0xabc" }),
    );

    assert.equal(queries.length, 1);
    const { sql, params } = queries[0]!;
    assert.match(sql, /INSERT INTO trace_cache \(chain_id, tx_hash, trace_type, result\)/);
    assert.match(sql, /ON CONFLICT \(chain_id, tx_hash, trace_type\)/);
    assert.equal(params[0], 943);
    assert.equal(params[1], LOWER);
    assert.equal(params[2], "calltree");
    assert.equal(params[3], JSON.stringify({ to: "0xabc" }));
  });

  it("a write on one chain cannot overwrite another chain's row", async () => {
    await runWithChain(369, () => setCachedTrace(HASH, "calltree", { n: 1 }));
    await runWithChain(943, () => setCachedTrace(HASH, "calltree", { n: 2 }));

    // Same hash + trace_type, different chain_id → two distinct rows under the
    // unique index, so neither DO UPDATE clobbers the other.
    assert.deepEqual(
      queries.map((q) => q.params[0]),
      [369, 943],
    );
  });
});

describe("chainScopedTraceKey (in-process caches)", () => {
  it("prefixes the chain so per-chain entries can't collide", () => {
    const a = runWithChain(369, () => chainScopedTraceKey(HASH));
    const b = runWithChain(943, () => chainScopedTraceKey(HASH));
    assert.notEqual(a, b);
    assert.equal(a, `369:${LOWER}`);
    assert.equal(b, `943:${LOWER}`);
  });

  it("normalizes hash case, so 0xABC and 0xabc share one entry", () => {
    assert.equal(
      runWithChain(1, () => chainScopedTraceKey(HASH)),
      runWithChain(1, () => chainScopedTraceKey(LOWER)),
    );
  });

  it("keeps an optional suffix distinct per chain", () => {
    assert.equal(
      runWithChain(1, () => chainScopedTraceKey(LOWER, "detail")),
      `1:${LOWER}:detail`,
    );
    assert.notEqual(
      runWithChain(1, () => chainScopedTraceKey(LOWER, "detail")),
      runWithChain(943, () => chainScopedTraceKey(LOWER, "detail")),
    );
  });
});
