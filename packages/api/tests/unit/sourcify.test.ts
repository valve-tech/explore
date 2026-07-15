/**
 * Unit tests for fetchFromSourcify — the primary branch of the verified-source
 * chain (Sourcify → BlockScout fallback → null).
 *
 * Pins the wire shape so a Sourcify API migration can't silently break this
 * again. It has now broken twice:
 *   - 2025: `/server/repository/contracts/{full,partial}_match/…` retired.
 *   - 2026-07-07: API **v1** (`/server/files/any/<chain>/<addr>`) entered a
 *     scheduled brownout returning 503 to EVERY request through at least
 *     2027-01-08. Because a 503 is an UpstreamError, every ABI lookup fell
 *     through to the Blockscout fallback and its full timeout, which pushed
 *     /api/tx past its 15s budget → 504 on any tx with several distinct log
 *     emitters.
 *
 * Current contract (v2), verified against the live server:
 *   GET /server/v2/contract/<chain>/<addr>?fields=abi,sources,compilation
 *     200 → { abi, sources: { "<path>": { content } },
 *             compilation: { compilerVersion, name, compilerSettings }, … }
 *     404 → not verified
 * `?fields=` is REQUIRED — without it v2 returns match metadata only, with no
 * abi/sources, which would read as "verified but empty".
 *
 * Mocks globalThis.fetch and inspects (a) which URL was called and (b) what
 * the function returns for each upstream shape.
 */

import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";

import { fetchFromSourcify } from "../../src/services/sourceCode/sourcify.js";
import { UpstreamError } from "../../src/services/sourceCode/types.js";

interface FetchCall {
  url: string;
}

const mockFetch = (
  scenario: (call: FetchCall) =>
    | { status: number; body: unknown }
    | { status: number; bodyText: string },
): { calls: FetchCall[]; restore: () => void } => {
  const calls: FetchCall[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url });
    const r = scenario({ url });
    const body =
      "bodyText" in r ? r.bodyText : JSON.stringify(r.body);
    return new Response(body, {
      status: r.status,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
};

const ADDR = "0xA1077a294dDE1B09bB078844df40758a5D0f9a27";

describe("fetchFromSourcify (current Sourcify API)", () => {
  let mock: ReturnType<typeof mockFetch> | undefined;
  afterEach(() => {
    mock?.restore();
    mock = undefined;
  });

  it("calls v2 /server/v2/contract/<chain>/<addr> — NOT the brownout'd v1 paths", async () => {
    mock = mockFetch(() => ({ status: 404, body: {} }));
    await fetchFromSourcify(ADDR);
    assert.equal(mock.calls.length, 1, "exactly one upstream request");
    const url = mock.calls[0]?.url ?? "";
    assert.match(url, /\/server\/v2\/contract\/369\//, "must hit /server/v2/contract/369/");
    assert.doesNotMatch(
      url,
      /\/files\/any\//,
      "must NOT hit v1 /files/any/ — 503 brownout since 2026-07-07",
    );
    assert.doesNotMatch(url, /\/repository\/contracts\//, "must NOT hit the 2025-retired paths");
    assert.match(url, new RegExp(ADDR.toLowerCase(), "i"));
  });

  it("requests the abi/sources/compilation fields explicitly", async () => {
    // Without ?fields= v2 returns match metadata only — no abi, no sources.
    // A verified contract would look verified-but-empty.
    mock = mockFetch(() => ({ status: 404, body: {} }));
    await fetchFromSourcify(ADDR);
    const url = mock.calls[0]?.url ?? "";
    assert.match(url, /[?&]fields=/, "must select fields");
    for (const field of ["abi", "sources", "compilation"]) {
      assert.ok(url.includes(field), `must request the '${field}' field`);
    }
  });

  it("treats the v1 brownout 503 as an UpstreamError, not a definitive miss", async () => {
    // The exact body Sourcify serves during the brownout. A 5xx must never be
    // read as "not verified" — that would negative-cache a lie.
    mock = mockFetch(() => ({
      status: 503,
      body: {
        error: "Service Unavailable - API v1 Brownout",
        message: "API v1 is temporarily unavailable during a scheduled brownout period.",
      },
    }));
    await assert.rejects(() => fetchFromSourcify(ADDR), UpstreamError);
  });

  it("returns null on definitive 404 (Sourcify said 'not verified here')", async () => {
    mock = mockFetch(() => ({ status: 404, body: {} }));
    const out = await fetchFromSourcify(ADDR);
    assert.equal(out, null);
  });

  it("throws UpstreamError on 5xx (so getVerifiedSource can distinguish 'down' from 'not here')", async () => {
    mock = mockFetch(() => ({ status: 503, body: { error: "service unavailable" } }));
    await assert.rejects(() => fetchFromSourcify(ADDR), (err: unknown) => {
      assert.ok(err instanceof UpstreamError);
      return true;
    });
  });

  it("throws UpstreamError on fetch network failure", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch;
    try {
      await assert.rejects(() => fetchFromSourcify(ADDR), (err: unknown) => {
        assert.ok(err instanceof UpstreamError);
        assert.match((err as Error).message, /ECONNREFUSED/);
        return true;
      });
    } finally {
      globalThis.fetch = original;
    }
  });

  it("maps a v2 payload into a VerifiedSource", async () => {
    // Shape copied from the live server:
    //   /server/v2/contract/369/0xA1077…?fields=abi,sources,compilation
    mock = mockFetch(() => ({
      status: 200,
      body: {
        matchId: "17623938",
        match: "match",
        chainId: "369",
        address: ADDR,
        abi: [{ type: "fallback" }],
        sources: {
          "WPLS.sol": {
            content: "// SPDX-License-Identifier: MIT\npragma solidity ^0.8.0;\ncontract WPLS {}\n",
          },
        },
        compilation: {
          language: "Solidity",
          compilerVersion: "0.8.20+commit.a1b79de6",
          name: "WPLS",
          compilerSettings: { optimizer: { enabled: true, runs: 200 } },
        },
      },
    }));

    const out = await fetchFromSourcify(ADDR);
    assert.ok(out, "should return a VerifiedSource");
    assert.equal(out.address, ADDR.toLowerCase());
    assert.equal(out.chainSource, "sourcify");
    assert.equal(out.compilerVersion, "0.8.20+commit.a1b79de6");
    assert.equal(out.sourceFiles.length, 1);
    assert.equal(out.sourceFiles[0]?.name, "WPLS.sol");
    assert.deepEqual(out.abi, [{ type: "fallback" }]);
    // v2 reports the compiled contract's real name rather than v1's
    // first-source-file-basename guess.
    assert.equal(out.contractName, "WPLS");
    // v1 exposed no optimizer settings, so this used to be hardcoded false/null
    // — i.e. every verified contract was reported unoptimized.
    assert.equal(out.optimizationUsed, true);
    assert.equal(out.optimizationRuns, 200);
  });

  it("keeps non-.sol sources (v1's .sol filter dropped Vyper/Yul)", async () => {
    mock = mockFetch(() => ({
      status: 200,
      body: {
        match: "match",
        abi: [],
        sources: { "contracts/Foo.vy": { content: "# vyper" } },
        compilation: { compilerVersion: "0.3.10", name: "Foo" },
      },
    }));
    const out = await fetchFromSourcify(ADDR);
    assert.ok(out);
    assert.equal(out.sourceFiles.length, 1);
    assert.equal(out.sourceFiles[0]?.name, "contracts/Foo.vy");
  });

  it("falls back to the file basename when compilation.name is absent", async () => {
    mock = mockFetch(() => ({
      status: 200,
      body: {
        match: "match",
        abi: [],
        sources: { "Foo.sol": { content: "contract Foo {}" } },
        compilation: { compilerVersion: "0.8.20" },
      },
    }));
    const out = await fetchFromSourcify(ADDR);
    assert.ok(out);
    assert.equal(out.contractName, "Foo");
  });

  it("returns null when the payload carries no sources", async () => {
    mock = mockFetch(() => ({
      status: 200,
      body: { match: "match", abi: [{ type: "fallback" }], sources: {}, compilation: { name: "X" } },
    }));
    assert.equal(await fetchFromSourcify(ADDR), null);
  });

  it("returns null when sources is absent entirely", async () => {
    mock = mockFetch(() => ({ status: 200, body: { match: "match" } }));
    assert.equal(await fetchFromSourcify(ADDR), null);
  });

  it("tolerates a source entry with no content", async () => {
    mock = mockFetch(() => ({
      status: 200,
      body: {
        match: "match",
        abi: [],
        sources: { "Empty.sol": {}, "Foo.sol": { content: "contract Foo {}" } },
        compilation: { name: "Foo" },
      },
    }));
    const out = await fetchFromSourcify(ADDR);
    assert.ok(out, "a contentless entry must not nuke the whole response");
    assert.equal(out.sourceFiles.length, 1);
    assert.equal(out.sourceFiles[0]?.name, "Foo.sol");
  });

  it("defaults abi to [] when v2 omits it", async () => {
    mock = mockFetch(() => ({
      status: 200,
      body: {
        match: "match",
        sources: { "Foo.sol": { content: "contract Foo {}" } },
        compilation: { name: "Foo" },
      },
    }));
    const out = await fetchFromSourcify(ADDR);
    assert.ok(out);
    assert.deepEqual(out.abi, []);
    assert.equal(out.compilerVersion, null);
    assert.equal(out.optimizationUsed, false);
    assert.equal(out.optimizationRuns, null);
  });
});
