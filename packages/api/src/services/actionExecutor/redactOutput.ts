import { redactSecrets } from "../../lib/redact.js";
import type { ExecutionResult } from "./types.js";

/**
 * Strip credentials out of an action's captured streams before they are
 * stored or returned.
 *
 * A user action runs against the chain's keyed RPC URL. viem puts the full
 * request URL — including the `vk_` key — in the message of every transport
 * error, and the sandbox captures that message into `stderr`/`error`. User
 * code can also print the URL to `stdout` itself. Both paths then reach the
 * action's owner: the `/test` and run routes return this object, and
 * `addLog` persists `stdout`/`stderr` into `action_logs`.
 *
 * The HTTP error boundary (`respond`) already redacts, but the action
 * executor bypasses it — it returns via `respond.ok` and writes to the
 * database directly — so the same redaction has to happen here, at the
 * executor's own boundary, before either destination sees the text.
 */
export function redactExecutionOutput(result: ExecutionResult): ExecutionResult {
  return {
    ...result,
    stdout: redactSecrets(result.stdout),
    stderr: redactSecrets(result.stderr),
    ...(result.error !== undefined ? { error: redactSecrets(result.error) } : {}),
  };
}
