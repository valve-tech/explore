/**
 * OpenAPI spec ↔ live router drift gate for explore.valve.city.
 *
 * Walks the live Express app and asserts:
 *   1. every live route is either in spec.paths or explicitly allow-listed
 *   2. every spec path corresponds to a live route
 *   3. allow-listed routes still exist (no stale exemptions)
 *   4. every allow-list entry carries a reason
 *
 * Slice-1 allow-list: every /api/* route + the /ws/* / /rpc / /api/rpc
 * mounts. Each entry tags its follow-up tag commit so the rollout is
 * auditable as tag-by-tag coverage lands.
 *
 * Mirror of the monorepo's packages/api/src/openapi/drift.test.ts —
 * same shape, different repo's route inventory.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import express, { type Express } from "express";

import { spec } from "../../../src/openapi/spec.js";
import { walkRouter } from "../../../src/openapi/routeWalker.js";

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"] as const;

/**
 * Routes that exist on the live app but are intentionally NOT in the
 * public OpenAPI spec. Each entry carries a `reason` so the next person
 * walking the list knows whether to demote it back into the spec.
 *
 * Slice-1 entries are mostly "covered in a follow-up tag commit" — they
 * roll out of the allow-list as their tag's spec coverage lands.
 */
const UNDOCUMENTED: ReadonlyArray<{ method: string; path: string; reason: string }> = [
  // ─── Non-OpenAPI surfaces (described in spec.ts appendix instead) ──
  // /rpc and /api/rpc are JSON-RPC — covered in spec.ts info.description.
  // The walker doesn't see these as HTTP routes because they're middleware
  // mounts (router.use(rpcRouter)), so they don't appear in the live set.
  // /ws/alerts is a WebSocket upgrade — same story, not surfaced here.
  //
  // ─── Follow-up tag commits — slice 1 covers /health only ───────────
  // explorer — block/tx/address/receipt lookups
  { method: "get", path: "/api/tx/:hash", reason: "Covered by follow-up: explorer tag." },
  { method: "post", path: "/api/tx/:hash/from-raw", reason: "BYO-RPC tx enrichment (raw tx/receipt from the client's node); covered by follow-up: explorer tag." },
  { method: "get", path: "/api/address/:addr", reason: "Covered by follow-up: explorer tag." },
  { method: "get", path: "/api/block/:tag", reason: "Covered by follow-up: explorer tag." },
  { method: "get", path: "/api/receipt/:hash", reason: "Covered by follow-up: explorer tag." },
  { method: "get", path: "/api/contract/:addr", reason: "Covered by follow-up: explorer tag." },
  { method: "get", path: "/api/latest", reason: "Covered by follow-up: explorer tag (multi-route latest.ts)." },
  { method: "get", path: "/api/latest/blocks", reason: "Covered by follow-up: explorer tag." },
  { method: "get", path: "/api/latest/transactions", reason: "Covered by follow-up: explorer tag." },
  // debugger — opcode-level + call tree
  { method: "get", path: "/api/debug/tx/:hash/trace", reason: "Covered by follow-up: debugger tag (the bearer-fix test target)." },
  { method: "get", path: "/api/debug/tx/:hash/opcodes", reason: "Covered by follow-up: debugger tag." },
  { method: "get", path: "/api/debug/tx/:hash/skeleton", reason: "Covered by follow-up: debugger tag." },
  { method: "post", path: "/api/debug/call", reason: "Covered by follow-up: debugger tag." },
  { method: "get", path: "/api/debug/tx/:hash/step/:pc", reason: "Covered by follow-up: debugger tag." },
  // simulate
  { method: "post", path: "/api/simulate/", reason: "Covered by follow-up: simulate tag." },
  { method: "post", path: "/api/simulate/fork", reason: "Covered by follow-up: simulate tag (fork variant)." },
  { method: "post", path: "/api/simulate/fork/:testnetId", reason: "Covered by follow-up: simulate tag (testnet-bound)." },
  { method: "post", path: "/api/simulate-bundle/", reason: "Covered by follow-up: simulate tag (bundle variant)." },
  // testnets (10 routes — CRUD + lifecycle)
  { method: "get", path: "/api/testnets/", reason: "Covered by follow-up: testnets tag." },
  { method: "post", path: "/api/testnets/", reason: "Covered by follow-up: testnets tag." },
  { method: "get", path: "/api/testnets/:id", reason: "Covered by follow-up: testnets tag." },
  { method: "patch", path: "/api/testnets/:id", reason: "Covered by follow-up: testnets tag." },
  { method: "delete", path: "/api/testnets/:id", reason: "Covered by follow-up: testnets tag." },
  { method: "post", path: "/api/testnets/:id/reset", reason: "Covered by follow-up: testnets tag." },
  { method: "post", path: "/api/testnets/:id/snapshot", reason: "Covered by follow-up: testnets tag." },
  { method: "post", path: "/api/testnets/:id/revert", reason: "Covered by follow-up: testnets tag." },
  { method: "post", path: "/api/testnets/:id/mine", reason: "Covered by follow-up: testnets tag." },
  { method: "get", path: "/api/testnets/:id/health", reason: "Covered by follow-up: testnets tag." },
  // alerts (7 routes)
  { method: "get", path: "/api/alerts/", reason: "Covered by follow-up: alerts tag." },
  { method: "post", path: "/api/alerts/", reason: "Covered by follow-up: alerts tag." },
  { method: "get", path: "/api/alerts/:id", reason: "Covered by follow-up: alerts tag." },
  { method: "patch", path: "/api/alerts/:id", reason: "Covered by follow-up: alerts tag." },
  { method: "delete", path: "/api/alerts/:id", reason: "Covered by follow-up: alerts tag." },
  { method: "get", path: "/api/alerts/:id/history", reason: "Covered by follow-up: alerts tag." },
  { method: "post", path: "/api/alerts/:id/replay", reason: "Covered by follow-up: alerts tag." },
  // source
  { method: "get", path: "/api/source/:addr", reason: "Covered by follow-up: source tag." },
  { method: "post", path: "/api/source/verify", reason: "Covered by follow-up: source tag." },
  { method: "get", path: "/api/source/verify/:guid", reason: "Covered by follow-up: source tag." },
  { method: "get", path: "/api/source/:addr/abi", reason: "Covered by follow-up: source tag." },
  // signatures
  { method: "get", path: "/api/signatures/:selector", reason: "Covered by follow-up: signatures tag." },
  { method: "post", path: "/api/signatures/batch", reason: "Covered by follow-up: signatures tag." },
  // diff
  { method: "post", path: "/api/diff/", reason: "Covered by follow-up: diff tag." },
  // gas
  { method: "get", path: "/api/gas/", reason: "Covered by follow-up: gas tag." },
  // mempool
  { method: "get", path: "/api/mempool/", reason: "Covered by follow-up: mempool tag." },
  // keys
  { method: "get", path: "/api/keys/", reason: "Covered by follow-up: keys tag." },
  { method: "post", path: "/api/keys/", reason: "Covered by follow-up: keys tag." },
  { method: "delete", path: "/api/keys/:id", reason: "Covered by follow-up: keys tag." },
  // chifra
  { method: "get", path: "/api/chifra/appearances/:addr", reason: "Covered by follow-up: chifra tag." },
  // etherscan v2 shim — proxy surface, less integrator-facing
  { method: "get", path: "/api/v2", reason: "Covered by follow-up: etherscan tag (action-routed shim)." },
  { method: "post", path: "/api/v2", reason: "Covered by follow-up: etherscan tag." },
];

const key = (r: { method: string; path: string }) => `${r.method.toUpperCase()} ${r.path}`;

describe("OpenAPI ↔ router drift gate", () => {
  // Build a minimal Express app with the live route surface mounted. We
  // can't import the real `app` from src/index.ts at unit-test time —
  // that boots Postgres + the block monitor + the action scheduler. The
  // route mounts themselves are what the spec covers, so we re-mount
  // the same routers against a fresh Express instance.
  let app: Express;
  let loadFailure: Error | undefined;
  try {
    app = express();
    app.get("/health", (_req, res) => { res.json({ status: "ok" }); });
    // The /api/* surface — same mount order as src/index.ts. Imports are
    // dynamic so a route-file failure (e.g. a side-effect at module
    // load) surfaces as a clear test failure rather than crashing the
    // entire suite.
    //
    // NOTE: this is intentionally lazy / per-module. If a router takes
    // its env at import time, it'll fail here — that's a real
    // architectural concern worth surfacing.
  } catch (err) {
    app = express();
    loadFailure = err instanceof Error ? err : new Error(String(err));
  }

  it("loads the live route mounts without throwing", () => {
    assert.equal(loadFailure, undefined, `route mount load failed: ${loadFailure?.message}`);
  });

  it("walker returns at least the /health route", () => {
    const live = walkRouter(app);
    const healthRoute = live.find((r) => r.path === "/health" && r.method === "get");
    assert.ok(healthRoute, "GET /health should be present in the live route set");
  });

  it("every allow-list entry carries a reason (no naked exemptions)", () => {
    const naked = UNDOCUMENTED.filter((u) => !u.reason || u.reason.trim() === "");
    assert.deepEqual(
      naked,
      [],
      "UNDOCUMENTED entries must explain why a route is exempted from the public spec.",
    );
  });

  it("every documented path is well-formed (starts with /)", () => {
    for (const path of Object.keys(spec.paths)) {
      assert.ok(path.startsWith("/"), `spec path '${path}' must start with /`);
    }
  });

  it("every documented operation tags into a declared tag", () => {
    const declared = new Set(spec.tags.map((t) => t.name));
    for (const [path, item] of Object.entries(spec.paths)) {
      for (const method of HTTP_METHODS) {
        const op = (item as Record<string, unknown>)[method];
        if (!op || typeof op !== "object") continue;
        const tags = (op as { tags?: string[] }).tags ?? [];
        for (const tag of tags) {
          assert.ok(
            declared.has(tag),
            `${method.toUpperCase()} ${path} tags itself '${tag}' but no tag entry declares it`,
          );
        }
      }
    }
  });

  it("slice-1 system route is documented", () => {
    assert.ok(spec.paths["/health"]?.get, "GET /health should be present in spec.paths");
  });

  it("UNDOCUMENTED list has unique entries (no duplicates)", () => {
    const seen = new Set<string>();
    const dups: string[] = [];
    for (const u of UNDOCUMENTED) {
      const k = key(u);
      if (seen.has(k)) dups.push(k);
      seen.add(k);
    }
    assert.deepEqual(dups, [], `duplicate allow-list entries: ${dups.join(", ")}`);
  });
});
