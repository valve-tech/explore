import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { matchesExpectation, probe, driftVerdict } from "./check-infra.mjs";

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST_PATH = path.join(REPO_ROOT, "infra", "endpoints.json");
const SCRIPT_PATH = path.join(REPO_ROOT, "scripts", "check-infra.mjs");

const entry = (expect) => ({ name: "x", url: "https://x/", method: "GET", expect });

test("numeric expect matches the exact status", () => {
  assert.equal(matchesExpectation(entry(200), { status: 200, body: "" }).ok, true);
  assert.equal(matchesExpectation(entry(200), { status: 500, body: "" }).ok, false);
  assert.equal(matchesExpectation(entry(301), { status: 301, body: "" }).ok, true);
});

test("auth-gated passes on a JSON-RPC auth error", () => {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 0, error: { code: -32000, message: "API key required" } });
  assert.equal(matchesExpectation(entry("auth-gated"), { status: 200, body }).ok, true);
});

test("auth-gated passes when the key is invalid or inactive", () => {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 0, error: { code: -32000, message: "Invalid or inactive API key" } });
  assert.equal(matchesExpectation(entry("auth-gated"), { status: 200, body }).ok, true);
});

test("auth-gated fails on a generic non-auth JSON-RPC error (e.g. bad method)", () => {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 0, error: { code: -32601, message: "Method not found" } });
  assert.equal(matchesExpectation(entry("auth-gated"), { status: 200, body }).ok, false);
});

test("auth-gated fails when .error has no message", () => {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 0, error: { code: -32000 } });
  assert.equal(matchesExpectation(entry("auth-gated"), { status: 200, body }).ok, false);
});

test("auth-gated fails when the host is unreachable", () => {
  assert.equal(matchesExpectation(entry("auth-gated"), { error: "ENOTFOUND" }).ok, false);
});

test("auth-gated fails on an unrecognizable body", () => {
  assert.equal(matchesExpectation(entry("auth-gated"), { status: 200, body: "<html>nope</html>" }).ok, false);
});

test("grpc passes on 200 or 415", () => {
  assert.equal(matchesExpectation(entry("grpc"), { status: 200, body: "" }).ok, true);
  assert.equal(matchesExpectation(entry("grpc"), { status: 415, body: "" }).ok, true);
  assert.equal(matchesExpectation(entry("grpc"), { status: 502, body: "" }).ok, false);
});

test("not-live passes when the host does not resolve, fails when it answers", () => {
  assert.equal(matchesExpectation(entry("not-live"), { error: "getaddrinfo ENOTFOUND" }).ok, true);
  assert.equal(matchesExpectation(entry("not-live"), { status: 200, body: "" }).ok, false);
});

test("probe() calls fetch with redirect: manual — regression guard for 3xx expectations", async () => {
  let seenOpts;
  const fakeFetch = async (url, opts) => {
    seenOpts = opts;
    return { status: 301, text: async () => "" };
  };
  await probe(entry(301), fakeFetch);
  assert.equal(seenOpts.redirect, "manual");
});

test("probe() returning 301 satisfies an expect:301 entry end-to-end (the chifra case)", async () => {
  const fakeFetch = async () => ({ status: 301, text: async () => "" });
  const result = await probe(entry(301), fakeFetch);
  assert.equal(matchesExpectation(entry(301), result).ok, true);
});

test("probe() maps a thrown network error to { error }", async () => {
  const fakeFetch = async () => {
    throw new Error("boom");
  };
  const result = await probe(entry("not-live"), fakeFetch);
  assert.equal(result.error, "boom");
});

test("driftVerdict fails when the endpoint reports no build sha", () => {
  const v1 = driftVerdict({ served: null, want: "aaaaaaaaaaaa", name: "api" });
  assert.equal(v1.ok, false);
  assert.match(v1.detail, /api reports no build sha/);

  const v2 = driftVerdict({ served: "unknown", want: "aaaaaaaaaaaa", name: "api" });
  assert.equal(v2.ok, false);
  assert.match(v2.detail, /api reports no build sha/);
});

test("driftVerdict fails when origin/main sha is unknown (git ls-remote failed) — regression for the false-PASS bug", () => {
  const v = driftVerdict({ served: "bbbbbbbbbbbb", want: null, name: "api" });
  assert.equal(v.ok, false);
  assert.match(v.detail, /cannot verify — origin\/main sha unknown/);
  assert.match(v.detail, /git ls-remote failed/);
  assert.match(v.detail, /api serves bbbbbbb/);
  assert.match(v.detail, /Pass --expected <sha> to check explicitly\./);
});

test("driftVerdict fails and names both short shas when served and want disagree", () => {
  const v = driftVerdict({ served: "bbbbbbbbbbbb", want: "aaaaaaaaaaaa", name: "api" });
  assert.equal(v.ok, false);
  assert.match(v.detail, /api serves bbbbbbb, origin\/main is aaaaaaa/);
});

test("driftVerdict passes when served matches want", () => {
  const v = driftVerdict({ served: "aaaaaaaaaaaa", want: "aaaaaaaaaaaa", name: "api" });
  assert.equal(v.ok, true);
  assert.match(v.detail, /deploy in sync: aaaaaaa/);
});

test("check-infra fails loudly (not silently) when the manifest has zero /health entries", () => {
  // Regression test for the exact bug shape described in the review: an empty
  // `endpoints.filter((e) => e.url.endsWith("/health"))` result must never be
  // indistinguishable from "checked the drift, and it's fine" — the for-of
  // loop simply never running must not read as success ("All good.", exit 0).
  // This is proven end-to-end against a scratch manifest with zero endpoints
  // (so the run makes no network calls at all), swapped in for the real
  // infra/endpoints.json for the duration of the subprocess call and always
  // restored afterward — the committed manifest is never actually changed.
  const original = readFileSync(MANIFEST_PATH, "utf8");
  try {
    writeFileSync(MANIFEST_PATH, JSON.stringify({ endpoints: [] }));
    const result = spawnSync(process.execPath, [SCRIPT_PATH, "--expected", "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    assert.match(result.stdout, /FAIL {2}deploy drift: no \/health endpoints in the manifest — drift check did not run/);
    assert.doesNotMatch(result.stdout, /All good\./);
    assert.equal(result.status, 1);
  } finally {
    writeFileSync(MANIFEST_PATH, original);
  }
});
