import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  buildChainConfig,
  parseChainsConfig,
  loadChains,
} from "../../src/services/chains/loadConfig.js";

/**
 * Self-hosting: the chain registry can be built from a user JSON config so an
 * operator runs Explore for any EVM chain. These pin the builder defaults, the
 * readable-error contract, and that env loading replaces the valve set while no
 * env leaves it untouched.
 */

const CHAINS_ENV = ["CHAINS_JSON", "CHAINS_CONFIG_PATH", "DEFAULT_CHAIN_ID"];

afterEach(() => {
  for (const k of CHAINS_ENV) delete process.env[k];
});

describe("buildChainConfig", () => {
  it("synthesizes a viem chain and fills sensible defaults", () => {
    const c = buildChainConfig({
      chainId: 8453,
      name: "Base",
      rpcUrl: "https://mainnet.base.org",
      nativeSymbol: "ETH",
      sourcifyEnabled: true,
      defaultBlockTimeSeconds: 2,
      testnet: false,
    });
    assert.equal(c.chainId, 8453);
    assert.equal(c.viemChain.id, 8453);
    assert.equal(c.nativeDecimals, 18);
    // derived from the name when not given
    assert.equal(c.shortName, "base");
    assert.equal(c.chifraChain, "base");
    assert.equal(c.explorerSlug, "base");
    assert.equal(c.viemChain.rpcUrls.default.http[0], "https://mainnet.base.org");
  });
});

describe("parseChainsConfig", () => {
  it("builds configs from a valid array", () => {
    const { chains, flaggedDefault } = parseChainsConfig(
      JSON.stringify([
        { chainId: 10, name: "Optimism", rpcUrl: "https://mainnet.optimism.io", default: true },
      ]),
    );
    assert.equal(chains.length, 1);
    assert.equal(chains[0].chainId, 10);
    assert.equal(flaggedDefault, 10);
  });

  it("parses YAML, not just JSON", () => {
    const { chains } = parseChainsConfig(
      [
        "- chainId: 8453",
        "  name: Base",
        "  rpcUrl: https://mainnet.base.org",
        "  nativeSymbol: ETH",
      ].join("\n"),
    );
    assert.equal(chains.length, 1);
    assert.equal(chains[0].chainId, 8453);
    assert.equal(chains[0].viemChain.id, 8453);
  });

  it("throws readable errors on bad YAML, bad schema, and duplicate ids", () => {
    assert.throws(() => parseChainsConfig("{not: valid: yaml:"), /not valid YAML\/JSON/);
    assert.throws(
      () => parseChainsConfig(JSON.stringify([{ chainId: 1, name: "X" }])),
      /CHAINS config invalid/,
    );
    assert.throws(
      () =>
        parseChainsConfig(
          JSON.stringify([
            { chainId: 1, name: "A", rpcUrl: "https://a.example" },
            { chainId: 1, name: "B", rpcUrl: "https://b.example" },
          ]),
        ),
      /Duplicate chainId/,
    );
  });
});

describe("loadChains", () => {
  it("falls back to the valve chain set when no env config", () => {
    const { chains, defaultChainId } = loadChains();
    assert.deepEqual(
      Object.keys(chains).map(Number).sort((a, b) => a - b),
      [1, 369, 943, 11155111],
    );
    assert.equal(defaultChainId, 369);
  });

  it("replaces the set from CHAINS_JSON and resolves the default", () => {
    process.env.CHAINS_JSON = JSON.stringify([
      { chainId: 8453, name: "Base", rpcUrl: "https://mainnet.base.org" },
      { chainId: 10, name: "Optimism", rpcUrl: "https://mainnet.optimism.io" },
    ]);
    const { chains, defaultChainId } = loadChains();
    assert.deepEqual(Object.keys(chains).map(Number).sort((a, b) => a - b), [10, 8453]);
    // no 369 present, no flag, no env → lowest id wins
    assert.equal(defaultChainId, 10);
  });

  it("honors DEFAULT_CHAIN_ID env when it names a configured chain", () => {
    process.env.CHAINS_JSON = JSON.stringify([
      { chainId: 8453, name: "Base", rpcUrl: "https://mainnet.base.org" },
      { chainId: 10, name: "Optimism", rpcUrl: "https://mainnet.optimism.io" },
    ]);
    process.env.DEFAULT_CHAIN_ID = "8453";
    assert.equal(loadChains().defaultChainId, 8453);
  });
});
