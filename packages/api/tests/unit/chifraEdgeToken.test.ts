import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CHIFRA_TOKEN_HEADER, withChifraToken } from "../../src/services/chifra/edgeToken.js";

/**
 * The a-1 chifra edge refuses /export and /status without
 * X-Valve-Chifra-Token. Both chifra clients must send it.
 */
describe("withChifraToken", () => {
  it("adds the header and keeps the caller's headers and options", () => {
    const out = withChifraToken({ method: "GET", headers: { Accept: "application/json" } }, "tokenTOKENtokenTOKENtokenTOKEN1234");
    const h = new Headers(out.headers);
    assert.equal(h.get(CHIFRA_TOKEN_HEADER), "tokenTOKENtokenTOKENtokenTOKEN1234");
    assert.equal(h.get("Accept"), "application/json");
    assert.equal(out.method, "GET");
  });
  it("refuses redirects when it sends the token, so no other host gets it", () => {
    assert.equal(withChifraToken({ redirect: "follow" }, "tokenTOKENtokenTOKENtokenTOKEN1234").redirect, "error");
    assert.equal(withChifraToken({}, "").redirect, undefined);
  });
  it("changes nothing without a token", () => {
    const out = withChifraToken({ headers: { Accept: "x" } }, "");
    assert.equal(new Headers(out.headers).get(CHIFRA_TOKEN_HEADER), null);
  });
  it("both chifra clients wrap their fetch with it (fails on the old shape)", () => {
    for (const f of ["appearances.ts", "transfers.ts"]) {
      const src = readFileSync(new URL(`../../src/services/chifra/${f}`, import.meta.url), "utf8");
      assert.match(src, /fetch\(input, \{ \.\.\.withChifraToken\(init\), signal:/, f);
      assert.doesNotMatch(src, /fetch\(input, \{ \.\.\.init, signal:/, f);
    }
  });
});
