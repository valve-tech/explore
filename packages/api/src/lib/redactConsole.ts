import { format } from "node:util";
import { redactSecrets } from "./redact.js";

/**
 * Route every console write through `redactSecrets`.
 *
 * viem writes the full request URL into every transport error, and our RPC
 * key lives in that URL's path. Twenty-five call sites log a raw error object
 * (`console.error("[x] failed:", err)`), so any one of them printed the key —
 * found 2026-11-23 when `[monitor] chain 1 poll error:` wrote it to a dev
 * terminal. Redacting each call site would miss the next one; this is the one
 * boundary every log line crosses.
 *
 * `format` renders the arguments exactly as console would (including an
 * Error's stack and its own properties, such as viem's `metaMessages`), so
 * the redaction sees the same text the terminal would have.
 */
type ConsoleMethod = "log" | "info" | "warn" | "error" | "debug";

const METHODS: readonly ConsoleMethod[] = ["log", "info", "warn", "error", "debug"];

export function installConsoleRedaction(target: Pick<Console, ConsoleMethod> = console): void {
  for (const method of METHODS) {
    const original = target[method].bind(target);
    target[method] = (...args: unknown[]) => original(redactSecrets(format(...args)));
  }
}
