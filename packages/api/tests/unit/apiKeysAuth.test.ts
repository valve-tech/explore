import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * POST and DELETE /api/keys had no auth. On 2026-10-17 any caller could mint
 * a key or delete one. These tests mount the REAL app and prove that the two
 * mutating routes now need the admin bearer token, and fail closed when no
 * token is configured.
 *
 * DELETE /api/keys/not-a-number is the probe for "the guard let it through":
 * the handler answers 400 for that id before it touches the database.
 */

const { default: app } = await import("../../src/app.js");

const TOKEN = "test-admin-token-0123456789";
let server: Server;
let base: string;

before(async () => {
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  delete process.env.API_KEYS_ADMIN_TOKEN;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const call = (method: string, route: string, auth?: string) =>
  fetch(`${base}${route}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(auth ? { authorization: auth } : {}),
    },
    body: method === "POST" ? JSON.stringify({ name: "x" }) : undefined,
  });

describe("mutating /api/keys routes need the admin token", () => {
  it("refuses every mutating call when no admin token is configured", async () => {
    delete process.env.API_KEYS_ADMIN_TOKEN;
    assert.equal((await call("POST", "/api/keys")).status, 503);
    assert.equal((await call("DELETE", "/api/keys/1")).status, 503);
    assert.equal((await call("POST", "/api/keys", `Bearer ${TOKEN}`)).status, 503);
  });

  it("refuses a call with no token or a wrong token", async () => {
    process.env.API_KEYS_ADMIN_TOKEN = TOKEN;
    assert.equal((await call("POST", "/api/keys")).status, 401);
    assert.equal((await call("DELETE", "/api/keys/1")).status, 401);
    assert.equal((await call("POST", "/api/keys", "Bearer wrong")).status, 401);
    assert.equal((await call("DELETE", "/api/keys/1", `Bearer ${TOKEN}x`)).status, 401);
  });

  it("lets the admin token through to the handler", async () => {
    process.env.API_KEYS_ADMIN_TOKEN = TOKEN;
    const res = await call("DELETE", "/api/keys/not-a-number", `Bearer ${TOKEN}`);
    assert.equal(res.status, 400);
  });
});
