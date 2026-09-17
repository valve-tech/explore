/**
 * Unit tests for packages/api/src/services/actionExecutor/redactOutput.ts
 *
 * A Web3 Action runs against the chain's keyed RPC URL. When user code
 * triggers a viem transport error (a timeout, a 413, a non-200), viem puts
 * the FULL request URL — key and all — in the error message, and the sandbox
 * captures it into the action's stderr/error. That object is both stored in
 * `action_logs` and returned to the action's owner by the `/test` and run
 * routes, neither of which passes through the redacting HTTP error boundary.
 * Without this step an action author reads the admin `vk_` key out of their
 * own execution logs.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { redactExecutionOutput } from "../../src/services/actionExecutor/redactOutput.js";
import { looksLikeSecret } from "../../src/lib/redact.js";

const KEYED =
  "HttpRequestError: HTTP request failed.\nURL: https://rpc.valve.city/v1/vk_SECRETKEY0123456789/evm/1";

describe("redactExecutionOutput", () => {
  it("strips a keyed RPC URL out of stderr and error", () => {
    const out = redactExecutionOutput({
      success: false,
      stdout: "",
      stderr: KEYED,
      duration_ms: 5,
      error: KEYED,
    });
    assert.equal(out.stderr.includes("vk_SECRETKEY0123456789"), false);
    assert.equal(out.error?.includes("vk_SECRETKEY0123456789"), false);
    assert.equal(looksLikeSecret(out.stderr), false);
    assert.equal(looksLikeSecret(out.error ?? ""), false);
  });

  it("strips a key that user code printed to stdout", () => {
    const out = redactExecutionOutput({
      success: true,
      stdout: "debug: https://rpc.valve.city/v1/vk_SECRETKEY0123456789/evm/1",
      stderr: "",
      duration_ms: 5,
    });
    assert.equal(looksLikeSecret(out.stdout), false);
  });

  it("leaves clean output and the other fields untouched", () => {
    const out = redactExecutionOutput({
      success: true,
      stdout: "block 23076665",
      stderr: "",
      duration_ms: 42,
    });
    assert.equal(out.stdout, "block 23076665");
    assert.equal(out.success, true);
    assert.equal(out.duration_ms, 42);
    assert.equal(out.error, undefined);
  });
});
