import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getBuildInfo } from "../../src/lib/buildInfo.js";
import { resolveBuildInfo } from "../../../../scripts/build-info.mjs";

describe("getBuildInfo", () => {
  it("memoizes — repeated calls return the identical object", () => {
    assert.equal(getBuildInfo(), getBuildInfo());
  });

  it("agrees with the shared resolver — proves it is not a private copy", () => {
    assert.equal(getBuildInfo().sha, resolveBuildInfo().sha);
  });

  it("resolves a real sha in-repo", () => {
    assert.match(getBuildInfo().sha, /^[0-9a-f]{40}$|^unknown$/);
  });

  it("derives shortSha from sha", () => {
    const info = getBuildInfo();
    assert.equal(info.shortSha, info.sha.slice(0, 7));
  });
});
