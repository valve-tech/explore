/**
 * Comprehensive integration test suite for the Explore API.
 *
 * Assumes the API server is already running on http://localhost:10100
 * and is connected to live PulseChain RPC.
 *
 * Run with:
 *   npx tsx --test packages/api/tests/integration.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BASE = "http://localhost:10100";
const TEST_TX_HASH =
  "0x6f73cdf350877cad3d720c8023f3731e7e0b8bba43fcde872c25ecb2aa00fa4c";
const WPLS_ADDRESS = "0xA1077a294dDE1B09bB078844df40758a5D0f9a27";
const TEST_BLOCK = "23701811";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const TOTAL_SUPPLY_SELECTOR = "0x18160ddd"; // totalSupply()

// ---------------------------------------------------------------------------
// Timing helpers
// ---------------------------------------------------------------------------

interface TestTiming {
  name: string;
  duration: number;
  passed: boolean;
}

const timings: TestTiming[] = [];

async function timed<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();
  let passed = true;
  try {
    const result = await fn();
    return result;
  } catch (err) {
    passed = false;
    throw err;
  } finally {
    const elapsed = Math.round((performance.now() - start) * 100) / 100;
    timings.push({ name, duration: elapsed, passed });
    console.log(
      `  ${passed ? "PASS" : "FAIL"} [${elapsed}ms] ${name}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Generic fetch helpers
// ---------------------------------------------------------------------------

async function get(path: string): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    signal: AbortSignal.timeout(60_000),
  });
}

async function post(
  path: string,
  body: unknown,
): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
}

async function put(
  path: string,
  body: unknown,
): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
}

async function del(path: string): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method: "DELETE",
    signal: AbortSignal.timeout(60_000),
  });
}

// =========================================================================
// Feature 1: Transaction Simulator
// =========================================================================

describe("Feature 1: Transaction Simulator", () => {
  it("1. Simulate totalSupply() on WPLS", async () => {
    await timed("Simulate totalSupply() on WPLS", async () => {
      const res = await post("/api/simulate", {
        from: ZERO_ADDRESS,
        to: WPLS_ADDRESS,
        data: TOTAL_SUPPLY_SELECTOR,
      });

      assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
      const json = await res.json();
      assert.equal(json.ok, true, "Response should have ok=true");
      assert.equal(
        json.result.success,
        true,
        "Simulation should succeed",
      );
      assert.ok(
        json.result.returnData !== null && json.result.returnData !== undefined,
        "returnData should be non-null",
      );
      assert.ok(
        json.result.returnData.length > 2,
        "returnData should contain actual data (not just 0x)",
      );
      assert.ok(
        Number(json.result.gasEstimate) > 0,
        "gasEstimate should be > 0",
      );
    });
  });

  it("2. Simulate with state overrides (balance override)", async () => {
    await timed("Simulate with state overrides", async () => {
      const testAddr = "0x1111111111111111111111111111111111111111";
      const overrideBalance = "0x56bc75e2d63100000"; // 100 ETH in wei

      // Use eth_call via the simulate endpoint with state overrides
      // We'll call a simple contract view but with a balance override
      const res = await post("/api/simulate", {
        from: testAddr,
        to: WPLS_ADDRESS,
        data: TOTAL_SUPPLY_SELECTOR,
        stateOverrides: {
          [testAddr]: {
            balance: overrideBalance,
          },
        },
      });

      assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
      const json = await res.json();
      assert.equal(json.ok, true, "Response should have ok=true");
      // The call should succeed since totalSupply is a view function
      // and the state override should not affect its behavior
      assert.equal(
        json.result.success,
        true,
        "Simulation with state overrides should succeed",
      );
      assert.ok(
        json.result.returnData !== null,
        "returnData should be present",
      );
    });
  });

  it("3. Simulate a revert (invalid function selector on WPLS)", async () => {
    await timed("Simulate a revert", async () => {
      // Call a non-existent function selector -- this should revert
      const res = await post("/api/simulate", {
        from: ZERO_ADDRESS,
        to: WPLS_ADDRESS,
        data: "0xdeadbeef",
      });

      assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
      const json = await res.json();
      assert.equal(json.ok, true, "Response envelope should have ok=true");
      assert.equal(
        json.result.success,
        false,
        "Simulation should report failure (revert)",
      );
      assert.ok(
        json.result.revertReason !== null &&
          json.result.revertReason !== undefined,
        "revertReason should be present",
      );
    });
  });

  it("4. Bundle simulation (2 sequential calls)", async () => {
    await timed("Bundle simulation (2 calls)", async () => {
      const res = await post("/api/simulate-bundle", {
        transactions: [
          {
            from: ZERO_ADDRESS,
            to: WPLS_ADDRESS,
            data: TOTAL_SUPPLY_SELECTOR,
          },
          {
            from: ZERO_ADDRESS,
            to: WPLS_ADDRESS,
            data: TOTAL_SUPPLY_SELECTOR,
          },
        ],
      });

      assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
      const json = await res.json();
      assert.equal(json.ok, true, "Response should have ok=true");
      assert.ok(
        Array.isArray(json.results),
        "results should be an array",
      );
      assert.equal(
        json.results.length,
        2,
        "Should have exactly 2 results",
      );
      assert.equal(
        json.results[0].success,
        true,
        "First simulation should succeed",
      );
      assert.equal(
        json.results[1].success,
        true,
        "Second simulation should succeed",
      );
    });
  });
});

// =========================================================================
// Feature 2: Transaction Explorer
// =========================================================================

describe("Feature 2: Transaction Explorer", () => {
  it("5. Fetch transaction details for reverted multicall", async () => {
    await timed("Fetch transaction details", async () => {
      const res = await get(`/api/tx/${TEST_TX_HASH}`);
      assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
      const json = await res.json();
      assert.equal(json.ok, true, "Response should have ok=true");

      const result = json.result;
      assert.ok(result.hash, "Should have hash");
      assert.equal(
        result.hash.toLowerCase(),
        TEST_TX_HASH.toLowerCase(),
        "Hash should match",
      );
      assert.ok(result.blockNumber, "Should have blockNumber");
      assert.ok(result.from, "Should have from address");
      assert.ok(result.to, "Should have to address");
      assert.ok(result.gasUsed, "Should have gasUsed");
      // The outer multicall transaction succeeded on-chain (it caught internal
      // reverts), so the receipt status is "success". The 77 internal transactions
      // contain the actual reverted sub-calls.
      assert.ok(
        result.status === "success" || result.status === "reverted",
        `Status should be 'success' or 'reverted', got '${result.status}'`,
      );

      // Internal transactions
      assert.ok(
        Array.isArray(result.internalTransactions),
        "internalTransactions should be an array",
      );
      assert.equal(
        result.internalTransactions.length,
        77,
        `Should have exactly 77 internal transactions, got ${result.internalTransactions.length}`,
      );

      // Decoded input
      assert.ok(
        result.decodedInput !== null,
        "decodedInput should be present",
      );
      assert.equal(
        result.decodedInput.functionName,
        "multicall",
        'functionName should be "multicall"',
      );
    });
  });

  it("6. Fetch address transactions for WPLS", async () => {
    await timed("Fetch address transactions", async () => {
      const res = await get(
        `/api/address/${WPLS_ADDRESS}/txs?page=1&limit=5`,
      );
      assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
      const json = await res.json();
      assert.equal(json.ok, true, "Response should have ok=true");
      assert.ok(json.result, "Should have result");
      assert.ok(
        Array.isArray(json.result.transactions),
        "result.transactions should be an array",
      );
      // BlockScout API may rate-limit or timeout; just verify the shape is correct
      console.log(
        `    (got ${json.result.transactions.length} transactions)`,
      );
    });
  });

  it("7. Fetch contract info for WPLS (verified)", async () => {
    await timed("Fetch contract info", async () => {
      const res = await get(`/api/contract/${WPLS_ADDRESS}`);
      assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
      const json = await res.json();
      assert.equal(json.ok, true, "Response should have ok=true");
      assert.ok(json.result, "Should have result");
      assert.ok(
        json.result.abi !== null && json.result.abi !== undefined,
        "WPLS should have an ABI (verified contract)",
      );
      assert.ok(
        Array.isArray(json.result.abi),
        "ABI should be an array",
      );
      assert.ok(
        json.result.abi.length > 0,
        "ABI should not be empty",
      );
    });
  });

  it("8. Fetch block details for block 23701811", async () => {
    await timed("Fetch block details", async () => {
      const res = await get(`/api/block/${TEST_BLOCK}`);
      assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
      const json = await res.json();
      assert.equal(json.ok, true, "Response should have ok=true");

      const result = json.result;
      assert.ok(result.number, "Should have block number");
      assert.equal(
        result.number,
        TEST_BLOCK,
        `Block number should be ${TEST_BLOCK}`,
      );
      assert.ok(result.hash, "Should have block hash");
      assert.ok(result.timestamp, "Should have timestamp");
      assert.ok(result.gasUsed, "Should have gasUsed");
      assert.ok(
        Array.isArray(result.transactions),
        "Should have transactions array",
      );
      assert.ok(
        result.transactionCount > 0,
        "Block should contain at least one transaction",
      );
    });
  });
});

// =========================================================================
// Feature 3: Monitoring & Alerting
// =========================================================================

describe("Feature 3: Monitoring & Alerting", () => {
  let alertId: number;

  it("9. Create an alert for address activity", async () => {
    await timed("Create alert", async () => {
      const res = await post("/api/alerts", {
        name: "Integration Test Alert",
        type: "address_activity",
        conditions: {
          address: WPLS_ADDRESS,
        },
        notifications: [],
        enabled: true,
        cooldown_seconds: 60,
      });

      assert.equal(res.status, 201, `Expected 201, got ${res.status}`);
      const json = await res.json();
      assert.equal(json.ok, true, "Response should have ok=true");
      assert.ok(json.alert, "Should have alert object");
      assert.ok(json.alert.id, "Alert should have an id");
      assert.equal(
        json.alert.name,
        "Integration Test Alert",
        "Name should match",
      );
      assert.equal(
        json.alert.type,
        "address_activity",
        "Type should match",
      );

      alertId = json.alert.id;
    });
  });

  it("10. List alerts and verify created alert is present", async () => {
    await timed("List alerts", async () => {
      const res = await get("/api/alerts");
      assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
      const json = await res.json();
      assert.equal(json.ok, true, "Response should have ok=true");
      assert.ok(
        Array.isArray(json.alerts),
        "alerts should be an array",
      );

      const found = json.alerts.find(
        (a: any) => a.id === alertId,
      );
      assert.ok(
        found,
        `Created alert (id=${alertId}) should be in the list`,
      );
    });
  });

  it("11. Get single alert by id", async () => {
    await timed("Get single alert", async () => {
      const res = await get(`/api/alerts/${alertId}`);
      assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
      const json = await res.json();
      assert.equal(json.ok, true, "Response should have ok=true");
      assert.ok(json.alert, "Should have alert");
      assert.equal(json.alert.id, alertId, "Alert id should match");
      assert.equal(
        json.alert.name,
        "Integration Test Alert",
        "Name should match",
      );
    });
  });

  it("12. Update alert name", async () => {
    await timed("Update alert", async () => {
      const res = await put(`/api/alerts/${alertId}`, {
        name: "Updated Test Alert",
        type: "address_activity",
        conditions: {
          address: WPLS_ADDRESS,
        },
        notifications: [],
        enabled: true,
        cooldown_seconds: 120,
      });

      assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
      const json = await res.json();
      assert.equal(json.ok, true, "Response should have ok=true");
      assert.equal(
        json.alert.name,
        "Updated Test Alert",
        "Name should be updated",
      );
    });
  });

  it("13. Test alert notification dispatch", async () => {
    await timed("Test alert", async () => {
      const res = await post(`/api/alerts/${alertId}/test`, {});
      assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
      const json = await res.json();
      assert.equal(json.ok, true, "Response should have ok=true");
    });
  });

  it("14. Delete alert and verify gone", async () => {
    await timed("Delete alert", async () => {
      // Delete
      const delRes = await del(`/api/alerts/${alertId}`);
      assert.equal(
        delRes.status,
        200,
        `Expected 200 on delete, got ${delRes.status}`,
      );
      const delJson = await delRes.json();
      assert.equal(delJson.ok, true, "Delete should return ok=true");

      // Verify it's gone
      const getRes = await get(`/api/alerts/${alertId}`);
      assert.equal(
        getRes.status,
        404,
        `Expected 404 after deletion, got ${getRes.status}`,
      );
    });
  });
});

// =========================================================================
// Feature 4: Virtual TestNets
// =========================================================================

describe("Feature 4: Virtual TestNets", () => {
  it("15. List testnets", async () => {
    await timed("List testnets", async () => {
      const res = await get("/api/testnets");
      assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
      const json = await res.json();
      assert.equal(json.ok, true, "Response should have ok=true");
      assert.ok(
        Array.isArray(json.forks),
        "forks should be an array",
      );
    });
  });

  it("16. Create testnet (may fail if anvil not installed)", async () => {
    await timed("Create testnet (may fail)", async () => {
      const res = await post("/api/testnets", {
        label: "integration-test",
      });

      const json = await res.json();

      if (res.status === 200 && json.ok) {
        // Anvil is available -- fork was created
        assert.ok(json.fork, "Should have fork object");
        assert.ok(json.fork.id, "Fork should have id");
        assert.ok(json.fork.rpcUrl, "Fork should have rpcUrl");

        // Clean up: destroy the testnet
        const destroyRes = await del(
          `/api/testnets/${json.fork.id}`,
        );
        assert.equal(
          destroyRes.status,
          200,
          "Destroy should return 200",
        );
        console.log(
          "    (anvil available -- fork created and destroyed)",
        );
      } else {
        // Anvil is not installed -- expect a clear error
        assert.equal(res.status, 500, `Expected 500, got ${res.status}`);
        assert.equal(json.ok, false, "Should return ok=false");
        assert.ok(json.error, "Should have error message");
        console.log(
          `    (anvil not available -- error: ${json.error})`,
        );
      }
    });
  });
});

// =========================================================================
// Feature 5: Debugger & Gas Profiler
// =========================================================================

describe("Feature 5: Debugger & Gas Profiler", () => {
  it("17. Call trace for reverted multicall tx", async () => {
    await timed("Call trace", async () => {
      const res = await get(
        `/api/debug/tx/${TEST_TX_HASH}/trace`,
      );
      assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
      const json = await res.json();
      assert.equal(json.ok, true, "Response should have ok=true");
      assert.ok(
        json.trace !== null && json.trace !== undefined,
        "trace should not be null",
      );
      assert.ok(
        json.trace.calls && Array.isArray(json.trace.calls),
        "trace should have a 'calls' array",
      );

      // The only trace source is debug_traceTransaction (live debug RPC or
      // anvil-fork replay) — the Blockscout reconstruction fallback is gone.
      assert.equal(
        json.source,
        "debug_traceTransaction",
        `source should be debug_traceTransaction, got "${json.source}"`,
      );

      // Count total tree nodes (the trace is deeply nested)
      function countNodes(frame: any): number {
        let count = 1;
        if (frame.calls && Array.isArray(frame.calls)) {
          for (const child of frame.calls) {
            count += countNodes(child);
          }
        }
        return count;
      }

      const totalNodes = countNodes(json.trace);
      assert.ok(
        totalNodes > 50,
        `Expected > 50 total trace nodes, got ${totalNodes}`,
      );
      console.log(`    (trace has ${totalNodes} total nodes)`);
    });
  });

  it("18. Gas profile for reverted multicall tx", async () => {
    await timed("Gas profile", async () => {
      const res = await get(
        `/api/debug/tx/${TEST_TX_HASH}/gas-profile`,
      );
      assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
      const json = await res.json();
      assert.equal(json.ok, true, "Response should have ok=true");
      assert.ok(json.gasProfile, "Should have gasProfile");

      const gp = json.gasProfile;
      assert.equal(
        gp.totalGas,
        462892,
        `totalGas should be 462892, got ${gp.totalGas}`,
      );
      assert.ok(
        Array.isArray(gp.flat),
        "gasProfile.flat should be an array",
      );
      assert.ok(
        gp.flat.length > 0,
        "flat array should have entries",
      );

      // The top function (by gas) should be multicall
      const topEntry = gp.flat[0];
      assert.equal(
        topEntry.function,
        "multicall",
        `Top function should be "multicall", got "${topEntry.function}"`,
      );
    });
  });

  it("19. Opcodes trace (200 with steps, or 503 without debug API)", async () => {
    await timed("Opcodes", async () => {
      const res = await get(
        `/api/debug/tx/${TEST_TX_HASH}/opcodes`,
      );
      const json = await res.json();
      if (res.status === 200) {
        // Debug-enabled node: full opcode skeleton.
        assert.equal(json.ok, true, "Should return ok=true");
        assert.equal(json.debugAvailable, true, "debugAvailable should be true");
        assert.ok(
          Array.isArray(json.steps) && json.steps.length > 0,
          "steps should be a non-empty array",
        );
        console.log(`    (debug API available: ${json.steps.length} steps)`);
      } else {
        // Public RPC without the debug API.
        assert.equal(
          res.status,
          503,
          `Expected 200 (debug API) or 503 (unavailable), got ${res.status}`,
        );
        assert.equal(json.ok, false, "Should return ok=false");
        assert.equal(
          json.debugAvailable,
          false,
          "debugAvailable should be false",
        );
        console.log("    (debug API unavailable: 503 as expected)");
      }
    });
  });

  it("20. Invalid tx hash returns 400", async () => {
    await timed("Invalid tx hash", async () => {
      const res = await get("/api/debug/tx/0xinvalid/trace");
      assert.equal(
        res.status,
        400,
        `Expected 400 for invalid hash, got ${res.status}`,
      );
      const json = await res.json();
      assert.equal(json.ok, false, "Should return ok=false");
    });
  });
});

// =========================================================================
// Feature 7: Web3 Actions
// =========================================================================

describe("Feature 7: Web3 Actions", () => {
  let actionId: number;

  it("27. Create action (webhook trigger)", async () => {
    await timed("Create action", async () => {
      const res = await post("/api/actions", {
        name: "Integration Test Action",
        triggerType: "webhook",
        triggerConfig: {},
        code: `console.log("Hello from integration test action!");
console.log("Event type:", event.type);
console.log("Timestamp:", new Date().toISOString());`,
      });

      assert.equal(res.status, 201, `Expected 201, got ${res.status}`);
      const json = await res.json();
      assert.equal(json.ok, true, "Response should have ok=true");
      assert.ok(json.action, "Should have action object");
      assert.ok(json.action.id, "Action should have an id");
      assert.equal(
        json.action.name,
        "Integration Test Action",
        "Name should match",
      );
      assert.equal(
        json.action.triggerType,
        "webhook",
        "triggerType should be webhook",
      );

      actionId = json.action.id;
    });
  });

  it("28. List actions and find created action", async () => {
    await timed("List actions", async () => {
      const res = await get("/api/actions");
      assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
      const json = await res.json();
      assert.equal(json.ok, true, "Response should have ok=true");
      assert.ok(
        Array.isArray(json.actions),
        "actions should be an array",
      );

      const found = json.actions.find(
        (a: any) => a.id === actionId,
      );
      assert.ok(
        found,
        `Created action (id=${actionId}) should be in the list`,
      );
    });
  });

  it("29. Test action with sample event data", async () => {
    await timed("Test action", async () => {
      const res = await post(`/api/actions/${actionId}/test`, {
        event: {
          type: "test",
          message: "integration test trigger",
        },
      });

      assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
      const json = await res.json();
      assert.equal(json.ok, true, "Response should have ok=true");
      assert.ok(json.result, "Should have execution result");
      assert.equal(
        json.result.success,
        true,
        "Execution should succeed",
      );
      assert.ok(
        json.result.stdout !== undefined,
        "Should have stdout",
      );
      assert.ok(
        json.result.stdout.includes("Hello from integration test action"),
        `stdout should contain our message, got: ${json.result.stdout}`,
      );
    });
  });

  it("30. Get action logs (should have at least one from the test)", async () => {
    await timed("Get action logs", async () => {
      const res = await get(`/api/actions/${actionId}/logs`);
      assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
      const json = await res.json();
      assert.equal(json.ok, true, "Response should have ok=true");
      // The response shape is { ok, rows, total, page, limit }
      assert.ok(Array.isArray(json.rows), "rows should be an array");
      assert.ok(
        json.rows.length >= 1,
        `Should have at least 1 log entry, got ${json.rows.length}`,
      );
      assert.ok(
        json.total >= 1,
        `total should be >= 1, got ${json.total}`,
      );
    });
  });

  it("31. Delete action", async () => {
    await timed("Delete action", async () => {
      const res = await del(`/api/actions/${actionId}`);
      assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
      const json = await res.json();
      assert.equal(json.ok, true, "Response should have ok=true");
      assert.equal(json.deleted, true, "deleted should be true");

      // Verify it's gone
      const getRes = await get(`/api/actions/${actionId}`);
      assert.equal(
        getRes.status,
        404,
        `Expected 404 after deletion, got ${getRes.status}`,
      );
    });
  });
});

// =========================================================================
// Summary
// =========================================================================

describe("Summary", () => {
  it("32. Print test timing summary", async () => {
    console.log("\n" + "=".repeat(80));
    console.log("  INTEGRATION TEST TIMING SUMMARY");
    console.log("=".repeat(80));
    console.log(
      `  ${"#".padEnd(4)} ${"Test Name".padEnd(50)} ${"Time".padStart(10)} ${"Result".padStart(8)}`,
    );
    console.log("-".repeat(80));

    let totalTime = 0;
    let passed = 0;
    let failed = 0;

    timings.forEach((t, i) => {
      const status = t.passed ? "PASS" : "FAIL";
      const timeStr = `${t.duration}ms`;
      console.log(
        `  ${String(i + 1).padEnd(4)} ${t.name.padEnd(50)} ${timeStr.padStart(10)} ${status.padStart(8)}`,
      );
      totalTime += t.duration;
      if (t.passed) passed++;
      else failed++;
    });

    console.log("-".repeat(80));
    console.log(
      `  Total: ${timings.length} tests | ${passed} passed | ${failed} failed | ${Math.round(totalTime)}ms total`,
    );
    console.log("=".repeat(80) + "\n");

    assert.equal(failed, 0, `${failed} test(s) failed`);
  });
});

describe("GET /health — build version", () => {
  it("exposes the running build identity without changing liveness", async () => {
    const res = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(3000) });
    assert.equal(res.status, 200);

    const body = (await res.json()) as {
      status: string;
      db: boolean;
      version?: {
        sha: string;
        shortSha: string;
        commitISO: string | null;
        branch: string;
        builtAtISO: string;
      };
    };

    // Liveness semantics unchanged.
    assert.equal(body.status, "ok");
    assert.equal(body.db, true);

    // Version is additive and well-formed.
    assert.ok(body.version, "expected a version object on /health");
    assert.match(body.version.sha, /^[0-9a-f]{40}$|^unknown$/);
    assert.equal(body.version.shortSha, body.version.sha.slice(0, 7));
    assert.match(body.version.builtAtISO, /^\d{4}-\d{2}-\d{2}T/);
  });
});
