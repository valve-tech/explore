import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  warmAllChains,
  getChainWarmStatus,
  allChainsReady,
  __resetWarmStatus,
} from "../../src/services/networkHealth/warmup.js";
import { type ChainConfig } from "../../src/services/chains/registry.js";

/**
 * Boot warm is "lenient / background": a chain with no rpcUrl must be flagged
 * `degraded` SYNCHRONOUSLY (no RPC call, no throw) so /health surfaces the
 * misconfiguration the instant we boot — this is exactly the prod state that
 * 503'd chain 1 while looking healthy. Configured chains aren't exercised here
 * (they'd hit the network); the warm path is covered by the cache tests.
 */
describe("networkHealth warmAllChains — missing-config path", () => {
  beforeEach(() => __resetWarmStatus());

  const unconfigured = {
    chainId: 1,
    name: "Ethereum",
    rpcUrl: "",
  } as unknown as ChainConfig;

  it("marks a chain with no rpcUrl as degraded without a network call", () => {
    warmAllChains([unconfigured]);
    const [status] = getChainWarmStatus();
    assert.equal(status?.chainId, 1);
    assert.equal(status?.state, "degraded");
    assert.equal(status?.rpcConfigured, false);
    assert.match(status?.error ?? "", /No RPC endpoint configured/);
  });

  it("does not report ready when a chain is degraded", () => {
    warmAllChains([unconfigured]);
    assert.equal(allChainsReady(), false);
  });

  it("reports not-ready with an empty status map", () => {
    assert.equal(allChainsReady(), false);
    assert.deepEqual(getChainWarmStatus(), []);
  });
});
