import { test } from "node:test";
import assert from "node:assert/strict";
import { matchesExpectation } from "./check-infra.mjs";

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
