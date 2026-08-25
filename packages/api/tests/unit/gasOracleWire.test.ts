import { describe, it } from "node:test";
import assert from "node:assert/strict";

/**
 * The gas oracle's wire payload.
 *
 * `GasOracleState` is a producer state object. Four of its fields — `ring`,
 * `mempoolSamples`, `lastPublishedTips`, `lastPublishedBlockNumber` — are
 * documented by the package as producer-local, with "wire publishers should
 * strip before serializing". Ours did not, and `ring` alone measured 637 KB
 * on chain 369: twenty blocks, each carrying every transaction's tip.
 *
 * The home page polls this every five seconds, so the cost was about 7.4 MB
 * per minute per open tab, to render four numbers.
 *
 * This test runs against the live server (same convention as the other
 * `/api/*` tests in this directory) because the leak was in what the ROUTE
 * serialized, not in what the service computed — a unit test of `toWire`
 * would pass while the route shipped the lot.
 */
const BASE = process.env.API_BASE ?? "http://localhost:10100";

/** Fields the package marks producer-local and tells publishers to strip. */
const PRODUCER_LOCAL = [
  "ring",
  "mempoolSamples",
  "lastPublishedTips",
  "lastPublishedBlockNumber",
];

/** What a client is entitled to read. `packages/web/src/api/gas.ts` is the contract. */
const CLIENT_FIELDS = [
  "chainId",
  "blockNumber",
  "baseFee",
  "baseFeeTrend",
  "mempool",
  "tiers",
];

describe("GET /api/gas/oracle — wire payload", () => {
  it("ships no producer-local field", async () => {
    const res = await fetch(`${BASE}/api/gas/oracle?chainid=369`);
    assert.equal(res.ok, true);
    const body = (await res.json()) as { result: Record<string, unknown> };

    for (const field of PRODUCER_LOCAL) {
      assert.ok(
        !(field in body.result),
        `${field} is producer-local and must not reach a browser`,
      );
    }
  });

  it("still ships everything the client declares", async () => {
    const res = await fetch(`${BASE}/api/gas/oracle?chainid=369`);
    const body = (await res.json()) as { result: Record<string, unknown> };

    for (const field of CLIENT_FIELDS) {
      assert.ok(field in body.result, `${field} is missing — the client reads it`);
    }
    // Not in the client's type yet, but on the wire on purpose: the base-fee
    // sparkline and the Ethereum-only blob market both read these.
    assert.ok("baseFeeHistory" in body.result);
    assert.ok("blob" in body.result);
  });

  it("stays under 8 KB, because the home page polls it every 5 seconds", async () => {
    const res = await fetch(`${BASE}/api/gas/oracle?chainid=369`);
    const bytes = (await res.text()).length;
    // Real content measured at ~1.2 KB. 8 KB leaves room for a longer
    // baseFeeHistory or a blob market without pinning an exact number, and
    // still fails loudly if a producer-local array comes back.
    assert.ok(
      bytes < 8_192,
      `payload is ${bytes} bytes; it was 647,932 before the projection`,
    );
  });
});
