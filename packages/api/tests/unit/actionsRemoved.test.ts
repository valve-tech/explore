import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Web3 Actions were removed on 2026-10-17. They ran caller-supplied JS with
 * no auth and open network. These tests mount the REAL app (src/app.ts) and
 * prove that no route under /api/actions answers any more, for any method,
 * and that no source file still imports the removed modules.
 *
 * On the old code, POST /api/actions answered 400 (schema) or 201, GET
 * answered 200, and the webhook route answered 404 only for a missing row.
 * Every request here carries a body the old routes would have parsed, so a
 * route that comes back fails on its status code, not on chance.
 */

const { default: app } = await import("../../src/app.js");

let server: Server;
let base: string;

before(async () => {
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const ROUTES: Array<[string, string]> = [
  ["POST", "/api/actions"],
  ["GET", "/api/actions"],
  ["GET", "/api/actions/1"],
  ["PUT", "/api/actions/1"],
  ["DELETE", "/api/actions/1"],
  ["POST", "/api/actions/1/test"],
  ["GET", "/api/actions/1/logs"],
  ["POST", "/api/actions/webhooks/1"],
];

describe("Web3 Actions are removed", () => {
  for (const [method, route] of ROUTES) {
    it(`${method} ${route} with no key answers 404`, async () => {
      const res = await fetch(`${base}${route}`, {
        method,
        headers: { "content-type": "application/json" },
        // A harmless body: a name and an empty code string. Never real code.
        body: method === "GET" ? undefined : JSON.stringify({ name: "x", code: "" }),
      });
      assert.equal(res.status, 404, `${method} ${route} answered ${res.status}`);
    });
  }

  it("no source file imports the removed modules", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const roots = [
      path.resolve(here, "../../src"),
      path.resolve(here, "../../../web/src"),
    ];
    const banned =
      /actionExecutor|actionScheduler|actionsDb|routes\/actions|components\/actions|api\/actions(\.js)?["']/;
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const p = path.join(dir, name);
        if (name === "node_modules" || name === "dist") continue;
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(name) && banned.test(readFileSync(p, "utf8"))) {
          offenders.push(path.relative(here, p));
        }
      }
    };
    roots.forEach(walk);
    assert.deepEqual(offenders, []);
  });
});
