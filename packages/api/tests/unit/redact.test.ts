import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { redactSecrets, looksLikeSecret } from "../../src/lib/redact.js";

/**
 * The message that actually went out to the public internet on 2026-08-27,
 * with the key replaced by one of the same shape. Every chain's failing
 * endpoint returned this body to any caller.
 */
const LEAKED = [
  "HTTP request failed.",
  "",
  "Status: 401",
  "URL: https://one.valve.city/rpc/vk_b7eCFWGxEvFWHKekMmWDAkp6Awrstlaa/evm/1",
  'Request body: [{"method":"eth_getBlockByNumber","params":["0x1828e75",true]}]',
  "",
  'Details: {"code":-32000,"message":"Invalid or inactive API key"}',
].join("\n");

describe("redactSecrets", () => {
  it("removes the key from the message that leaked in production", () => {
    const out = redactSecrets(LEAKED);
    assert.equal(out.includes("vk_b7eCFWGxEvFWHKekMmWDAkp6Awrstlaa"), false);
    assert.equal(looksLikeSecret(out), false);
  });

  it("keeps the message diagnosable — status, host and reason survive", () => {
    const out = redactSecrets(LEAKED);
    assert.equal(out.includes("Status: 401"), true);
    assert.equal(out.includes("one.valve.city"), true);
    assert.equal(out.includes("Invalid or inactive API key"), true);
  });

  it("redacts a vk_ key wherever it appears, not just in a URL", () => {
    const out = redactSecrets("key vk_abcdefghijklmnop failed");
    assert.equal(out, "key vk_*** failed");
  });

  it("redacts every key in a message, not only the first", () => {
    const out = redactSecrets("vk_aaaaaaaaaaaa then vk_bbbbbbbbbbbb");
    assert.equal(out, "vk_*** then vk_***");
  });

  it("redacts a bearer token but keeps the word Bearer", () => {
    const out = redactSecrets("Authorization: Bearer eyJhbGciOi.J9.sig-part");
    assert.equal(out.includes("eyJhbGciOi"), false);
    assert.equal(out.includes("Bearer ***"), true);
  });

  it("redacts URL userinfo", () => {
    const out = redactSecrets("postgres://user:hunter2@db.internal/valve");
    assert.equal(out.includes("hunter2"), false);
    assert.equal(looksLikeSecret(out), false);
  });

  it("collapses an absolute URL's path, catching key shapes we did not name", () => {
    const out = redactSecrets("URL: https://host.example/rpc/SOMEOPAQUETOKEN/evm/1");
    assert.equal(out.includes("SOMEOPAQUETOKEN"), false);
    assert.equal(out.includes("https://host.example/***"), true);
  });

  it("leaves a clean message untouched", () => {
    const clean = "The transaction index did not answer in time.";
    assert.equal(redactSecrets(clean), clean);
  });

  it("is safe on an empty string", () => {
    assert.equal(redactSecrets(""), "");
  });
});

describe("looksLikeSecret", () => {
  it("spots the shapes we redact", () => {
    assert.equal(looksLikeSecret("vk_abcdefghijkl"), true);
    assert.equal(looksLikeSecret("Bearer eyJhbGciOiJIUzI1"), true);
    assert.equal(looksLikeSecret("https://user:pw@host/x"), true);
  });

  it("does not flag ordinary prose", () => {
    assert.equal(looksLikeSecret("Status: 401 from one.valve.city"), false);
    assert.equal(looksLikeSecret("vk_"), false);
  });
});
