import { describe, it } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";

/**
 * The route maps an unreadable page to a clear 503 with `retryable: true`.
 * The old route answered a bare 500 (the SDK's timeout) or a 502.
 * The RPC points at a closed port, so the head read fails at once.
 */
process.env.PULSECHAIN_RPC_URL = "http://127.0.0.1:9/";

describe("GET /chifra/transfers", () => {
  it("returns 503 retryable when no block can be read", async () => {
    const { default: router } = await import("../../src/routes/chifra.js");
    const app = express();
    app.use(router);
    const server = app.listen(0);
    try {
      const port = (server.address() as AddressInfo).port;
      const res = await fetch(
        `http://127.0.0.1:${port}/chifra/transfers?token=0xA1077a294dDE1B09bB078844df40758a5D0f9a27`,
      );
      const body = (await res.json()) as { ok: boolean; retryable?: boolean; error?: string };
      assert.equal(res.status, 503);
      assert.equal(body.ok, false);
      assert.equal(body.retryable, true);
      assert.match(body.error ?? "", /try again/);
    } finally {
      server.close();
    }
  });
});
