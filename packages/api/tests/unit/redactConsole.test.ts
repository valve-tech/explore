import { test } from "node:test";
import assert from "node:assert/strict";
import { installConsoleRedaction } from "../../src/lib/redactConsole.js";
import { looksLikeSecret } from "../../src/lib/redact.js";

function fakeConsole() {
  const lines: string[] = [];
  const push = (...args: unknown[]) => lines.push(args.map(String).join(" "));
  return { lines, target: { log: push, info: push, warn: push, error: push, debug: push } };
}

// The shape viem throws: the key sits in the message AND in metaMessages.
function viemLikeError(): Error {
  const key = "vk_" + "Ab12".repeat(8);
  const err = new Error(`HTTP request failed.\n\nURL: https://rpc.example/v1/${key}/evm/1`);
  Object.assign(err, { metaMessages: [`URL: https://rpc.example/v1/${key}/evm/1`] });
  return err;
}

test("a raw error object logged with a prefix loses its key", () => {
  const { lines, target } = fakeConsole();
  installConsoleRedaction(target);
  target.error("[monitor] chain 1 poll error:", viemLikeError());
  assert.equal(lines.length, 1);
  assert.ok(lines[0]!.startsWith("[monitor] chain 1 poll error:"));
  assert.ok(lines[0]!.includes("rpc.example"), "the host survives, so the line stays useful");
  assert.equal(looksLikeSecret(lines[0]!), false, lines[0]);
});

test("every console method is covered", () => {
  const { lines, target } = fakeConsole();
  installConsoleRedaction(target);
  for (const m of ["log", "info", "warn", "error", "debug"] as const) target[m]("k=vk_SECRETSECRET");
  assert.equal(lines.length, 5);
  assert.ok(lines.every((l) => !looksLikeSecret(l)));
});

test("format placeholders still work", () => {
  const { lines, target } = fakeConsole();
  installConsoleRedaction(target);
  target.log("%s took %dms", "read", 12);
  assert.deepEqual(lines, ["read took 12ms"]);
});
