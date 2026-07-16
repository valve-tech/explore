import { test } from "node:test";
import assert from "node:assert/strict";

const BASE = process.env.API_BASE ?? "http://localhost:10100";
// A real PulseChain (369) contract call with several log emitters.
const TX = "0x2765c1209a69ed019ca52b5f5fdbf46c4276dcd2b72d28d7ef434fbe31c9c03d";

test("GET /api/tx/:hash?decode=0 returns core with empty decode", async () => {
  const res = await fetch(`${BASE}/api/tx/${TX}?chainid=369&decode=0`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  // Core facts present…
  assert.equal(typeof body.result.from, "string");
  assert.equal(typeof body.result.gasUsed, "string");
  assert.ok(Array.isArray(body.result.rawLogs) && body.result.rawLogs.length > 0);
  // …decode intentionally absent.
  assert.equal(body.result.decodedInput, null);
  assert.deepEqual(body.result.decodedLogs, []);
});

test("GET /api/tx/:hash (no flag) still decodes", async () => {
  const res = await fetch(`${BASE}/api/tx/${TX}?chainid=369`);
  const body = await res.json();
  assert.equal(body.result.decodedInput?.functionName, "swap");
});

test("GET /api/tx/:hash/decode returns only the decoded fields", async () => {
  const res = await fetch(`${BASE}/api/tx/${TX}/decode?chainid=369`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.result.decodedInput?.functionName, "swap");
  assert.ok(Array.isArray(body.result.decodedLogs));
  // Core facts are NOT duplicated onto this response.
  assert.equal(body.result.from, undefined);
  assert.equal(body.result.rawLogs, undefined);
});

test("GET /api/tx/:hash/decode 400s on a malformed hash", async () => {
  const res = await fetch(`${BASE}/api/tx/0xnothex/decode?chainid=369`);
  assert.equal(res.status, 400);
});

test("GET /api/tx/:hash/decode carries a boolean `degraded` flag", async () => {
  const res = await fetch(`${BASE}/api/tx/${TX}/decode?chainid=369`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  // The whole point of the split route: "unverified" vs "couldn't reach the
  // verifier" must be distinguishable, so the flag is always present + typed.
  assert.equal(typeof body.result.degraded, "boolean");
  // This tx (chain 369) touches unverified emitters and Blockscout is dead, so
  // the verified-source lookup can't get a definitive answer → degraded.
  assert.equal(body.result.degraded, true);
});
