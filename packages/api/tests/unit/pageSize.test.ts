import { describe, it } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import { resolvePageSize } from "../../src/lib/pageSize.js";
import { txListAction } from "../../src/routes/etherscan/handlers/account.js";

const ADDRESS = "0x0000000000000000000000000000000000000001";

describe("resolvePageSize", () => {
  it("accepts a size up to the maximum", () => {
    assert.deepEqual(resolvePageSize("50", "limit"), { ok: true, size: 50 });
    assert.deepEqual(resolvePageSize("100", "limit"), { ok: true, size: 100 });
  });

  it("uses the default for a missing or unusable size", () => {
    for (const raw of [undefined, "", "abc", "0", "-5"]) {
      assert.deepEqual(resolvePageSize(raw, "limit"), { ok: true, size: 25 });
    }
  });

  it("rejects a size over the maximum and names the parameter", () => {
    const r = resolvePageSize("101", "offset");
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.requested, 101);
    assert.equal(r.max, 100);
    assert.match(r.message, /offset must be less than or equal to 100/);
  });
});

describe("etherscan account.txlist — page size", () => {
  it("rejects offset over 100 in the Etherscan error envelope", async () => {
    const res = await txListAction({ address: ADDRESS, offset: "1000" });
    assert.equal(res.status, "0");
    assert.equal(res.message, "NOTOK");
    assert.match(String(res.result), /Result window is too large, offset must be less than or equal to 100/);
  });
});

describe("GET /address/:address/txs — page size", () => {
  it("answers 400 for limit over 100 and never reads the chain", async () => {
    const { default: router } = await import("../../src/routes/explorer.js");
    const app = express();
    app.use(router);
    const server = app.listen(0);
    try {
      const port = (server.address() as AddressInfo).port;
      const res = await fetch(`http://127.0.0.1:${port}/address/${ADDRESS}/txs?limit=250`);
      const body = (await res.json()) as { ok: boolean; error?: string };
      assert.equal(res.status, 400);
      assert.equal(body.ok, false);
      assert.match(body.error ?? "", /limit must be less than or equal to 100 \(requested 250\)/);
    } finally {
      server.close();
    }
  });
});
