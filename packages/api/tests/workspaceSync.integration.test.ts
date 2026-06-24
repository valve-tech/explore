import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";

/**
 * Integration tests for /api/workspaces/sync. Requires:
 *   - API server on http://localhost:10100
 *   - migrations 001..008 applied at startup
 *
 * Each test mints a fresh wallet + session so writes don't bleed across
 * test cases (each address has at most one row in workspace_blobs).
 */

const BASE = "http://localhost:10100";

async function isApiHealthy(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(2000) });
    return res.status === 200;
  } catch {
    return false;
  }
}

async function skipUnlessHealthy(t: { skip: (reason: string) => void }): Promise<boolean> {
  const ok = await isApiHealthy();
  if (!ok) t.skip(`API not reachable at ${BASE} — run 'npm run dev:api' to enable these tests`);
  return ok;
}

/** Authenticate a fresh account; return the address + cookie header. */
async function authenticate(): Promise<{ address: `0x${string}`; cookie: string }> {
  const account = privateKeyToAccount(generatePrivateKey());
  const nonceRes = await fetch(`${BASE}/api/auth/nonce`);
  const { nonce } = (await nonceRes.json()) as { nonce: string };
  const message = createSiweMessage({
    address: account.address,
    chainId: 369,
    domain: "localhost",
    nonce,
    uri: "http://localhost",
    version: "1",
    statement: "Sign in to Explore to sync your saved workspaces.",
  });
  const signature = await account.signMessage({ message });
  const verifyRes = await fetch(`${BASE}/api/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, signature }),
  });
  assert.equal(verifyRes.status, 200, "auth/verify failed in test setup");
  const setCookie = verifyRes.headers.get("set-cookie")!;
  // Extract just the `name=value` portion — the Set-Cookie header carries
  // attributes (Path, HttpOnly, etc) the request Cookie header must NOT.
  const cookie = setCookie.split(";")[0]!;
  return { address: account.address, cookie };
}

const envelope = (overrides: Partial<Record<string, unknown>> = {}) => ({
  envelopeFormat: 1,
  keyVersion: 1,
  ciphertext: "AAAA-test-ciphertext",
  nonce: "AAAA-test-iv",
  updatedAt: 1_717_200_000_000,
  ...overrides,
});

describe("/api/workspaces/sync — GET", () => {
  it("returns 401 without a session cookie", async (t) => {
    if (!(await skipUnlessHealthy(t))) return;
    const res = await fetch(`${BASE}/api/workspaces/sync`);
    assert.equal(res.status, 401);
  });

  it("returns 404 for an authenticated user who hasn't synced", async (t) => {
    if (!(await skipUnlessHealthy(t))) return;
    const { cookie } = await authenticate();
    const res = await fetch(`${BASE}/api/workspaces/sync`, { headers: { Cookie: cookie } });
    assert.equal(res.status, 404);
  });
});

describe("/api/workspaces/sync — PUT then GET roundtrip", () => {
  it("stores an envelope and reads it back", async (t) => {
    if (!(await skipUnlessHealthy(t))) return;
    const { cookie } = await authenticate();
    const env = envelope();

    const putRes = await fetch(`${BASE}/api/workspaces/sync`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify(env),
    });
    assert.equal(putRes.status, 200);
    const putBody = (await putRes.json()) as { ok: boolean; serverUpdatedAt: number };
    assert.equal(putBody.ok, true);
    assert.ok(putBody.serverUpdatedAt > 0);

    const getRes = await fetch(`${BASE}/api/workspaces/sync`, { headers: { Cookie: cookie } });
    assert.equal(getRes.status, 200);
    const getBody = (await getRes.json()) as Record<string, unknown>;
    assert.equal(getBody.ciphertext, env.ciphertext);
    assert.equal(getBody.nonce, env.nonce);
    assert.equal(getBody.envelopeFormat, env.envelopeFormat);
    assert.equal(getBody.keyVersion, env.keyVersion);
    assert.equal(getBody.updatedAt, env.updatedAt);
    assert.equal(getBody.serverUpdatedAt, putBody.serverUpdatedAt);
  });

  it("a second PUT replaces the first one wholesale", async (t) => {
    if (!(await skipUnlessHealthy(t))) return;
    const { cookie } = await authenticate();

    await fetch(`${BASE}/api/workspaces/sync`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify(envelope({ ciphertext: "FIRST" })),
    });
    await fetch(`${BASE}/api/workspaces/sync`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify(envelope({ ciphertext: "SECOND", updatedAt: 1_717_300_000_000 })),
    });

    const getRes = await fetch(`${BASE}/api/workspaces/sync`, { headers: { Cookie: cookie } });
    const body = (await getRes.json()) as Record<string, unknown>;
    assert.equal(body.ciphertext, "SECOND");
    assert.equal(body.updatedAt, 1_717_300_000_000);
  });

  it("scoping: user A's PUT is invisible to user B", async (t) => {
    if (!(await skipUnlessHealthy(t))) return;
    const a = await authenticate();
    const b = await authenticate();

    await fetch(`${BASE}/api/workspaces/sync`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: a.cookie },
      body: JSON.stringify(envelope({ ciphertext: "A-only" })),
    });

    const bRes = await fetch(`${BASE}/api/workspaces/sync`, { headers: { Cookie: b.cookie } });
    assert.equal(bRes.status, 404, "user B should not see user A's blob");
  });
});

describe("/api/workspaces/sync — PUT validation", () => {
  it("rejects 400 on a malformed envelope (missing required fields)", async (t) => {
    if (!(await skipUnlessHealthy(t))) return;
    const { cookie } = await authenticate();
    const res = await fetch(`${BASE}/api/workspaces/sync`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ ciphertext: "x" }), // missing the rest
    });
    assert.equal(res.status, 400);
  });

  it("rejects 401 without a session cookie", async (t) => {
    if (!(await skipUnlessHealthy(t))) return;
    const res = await fetch(`${BASE}/api/workspaces/sync`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(envelope()),
    });
    assert.equal(res.status, 401);
  });
});

describe("/api/workspaces/sync — DELETE", () => {
  it("removes the blob, subsequent GET returns 404", async (t) => {
    if (!(await skipUnlessHealthy(t))) return;
    const { cookie } = await authenticate();
    await fetch(`${BASE}/api/workspaces/sync`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify(envelope()),
    });

    const delRes = await fetch(`${BASE}/api/workspaces/sync`, {
      method: "DELETE",
      headers: { Cookie: cookie },
    });
    assert.equal(delRes.status, 200);
    const body = (await delRes.json()) as { ok: boolean; removed: boolean };
    assert.equal(body.removed, true);

    const getRes = await fetch(`${BASE}/api/workspaces/sync`, { headers: { Cookie: cookie } });
    assert.equal(getRes.status, 404);
  });

  it("returns 200 + removed:false when nothing was there to delete", async (t) => {
    if (!(await skipUnlessHealthy(t))) return;
    const { cookie } = await authenticate();
    const res = await fetch(`${BASE}/api/workspaces/sync`, {
      method: "DELETE",
      headers: { Cookie: cookie },
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean; removed: boolean };
    assert.equal(body.removed, false);
  });
});
