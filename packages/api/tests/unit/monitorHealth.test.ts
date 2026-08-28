import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  recordCheckFailure,
  recordCheckSuccess,
  isCheckUnhealthy,
  getCheckHealth,
  unhealthyChecks,
  _resetMonitorHealth,
  UNHEALTHY_AFTER_FAILURES,
} from "../../src/services/monitor/health.js";

const ADDR = "0xAbC0000000000000000000000000000000000001";

beforeEach(() => _resetMonitorHealth());

/**
 * A balance alert whose getBalance is failing returns null — the same value it
 * returns for "no match". Without this, an alert that has stopped working is
 * indistinguishable from one whose threshold was never crossed.
 */
describe("monitor check health", () => {
  it("starts with nothing recorded", () => {
    assert.equal(getCheckHealth("balance_threshold", ADDR), null);
    assert.equal(isCheckUnhealthy("balance_threshold", ADDR), false);
  });

  it("does not call a single blip unhealthy", () => {
    recordCheckFailure("balance_threshold", ADDR, new Error("ECONNRESET"));
    assert.equal(isCheckUnhealthy("balance_threshold", ADDR), false);
  });

  it("turns unhealthy on the configured run of consecutive failures", () => {
    for (let i = 1; i <= UNHEALTHY_AFTER_FAILURES; i += 1) {
      recordCheckFailure("balance_threshold", ADDR, new Error("boom"));
    }
    assert.equal(isCheckUnhealthy("balance_threshold", ADDR), true);
    assert.equal(
      getCheckHealth("balance_threshold", ADDR)?.consecutiveFailures,
      UNHEALTHY_AFTER_FAILURES,
    );
  });

  it("a success clears the run — a check that works again is healthy", () => {
    for (let i = 0; i < UNHEALTHY_AFTER_FAILURES + 2; i += 1) {
      recordCheckFailure("balance_threshold", ADDR, new Error("boom"));
    }
    assert.equal(isCheckUnhealthy("balance_threshold", ADDR), true);
    recordCheckSuccess("balance_threshold", ADDR);
    assert.equal(isCheckUnhealthy("balance_threshold", ADDR), false);
    assert.equal(getCheckHealth("balance_threshold", ADDR)?.consecutiveFailures, 0);
  });

  it("keeps the message, never the error object", () => {
    recordCheckFailure("balance_threshold", ADDR, new Error("upstream 502"));
    const h = getCheckHealth("balance_threshold", ADDR);
    assert.equal(h?.lastError, "upstream 502");
    assert.equal(typeof h?.lastError, "string");
  });

  it("survives a non-Error throw", () => {
    recordCheckFailure("balance_threshold", ADDR, "just a string");
    assert.equal(getCheckHealth("balance_threshold", ADDR)?.lastError, "just a string");
  });

  it("scopes by address and by kind", () => {
    for (let i = 0; i < UNHEALTHY_AFTER_FAILURES; i += 1) {
      recordCheckFailure("balance_threshold", ADDR, new Error("x"));
    }
    assert.equal(isCheckUnhealthy("balance_threshold", "0xother"), false);
    assert.equal(isCheckUnhealthy("failed_tx", ADDR), false);
  });

  it("matches an address whatever case it arrives in", () => {
    for (let i = 0; i < UNHEALTHY_AFTER_FAILURES; i += 1) {
      recordCheckFailure("balance_threshold", ADDR.toLowerCase(), new Error("x"));
    }
    assert.equal(isCheckUnhealthy("balance_threshold", ADDR.toUpperCase()), true);
  });

  it("lists only the broken checks, so an empty list means all is well", () => {
    recordCheckSuccess("balance_threshold", "0xhealthy");
    recordCheckFailure("balance_threshold", ADDR, new Error("x"));
    assert.deepEqual(unhealthyChecks(), []);

    for (let i = 1; i < UNHEALTHY_AFTER_FAILURES; i += 1) {
      recordCheckFailure("balance_threshold", ADDR, new Error("x"));
    }
    const broken = unhealthyChecks();
    assert.equal(broken.length, 1);
    assert.match(broken[0]!.check, /balance_threshold/);
  });

  it("does not grow without bound", () => {
    for (let i = 0; i < 600; i += 1) {
      recordCheckFailure("balance_threshold", `0x${i.toString(16)}`, new Error("x"));
    }
    assert.equal(
      getCheckHealth("balance_threshold", `0x${(599).toString(16)}`)?.consecutiveFailures,
      1,
    );
  });
});
