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
