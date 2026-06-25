import { describe, it, expect } from "vitest";
import { wagmiConfig } from "../lib/wagmi";

/**
 * Smoke test for the wagmi config. Importing the module runs createConfig (the
 * one statement to cover); we then assert the multichain launch set + the
 * HTTP-only transport strategy are wired as documented.
 */

describe("lib/wagmi — wagmiConfig", () => {
  it("registers the multichain launch set 1 / 369 / 943", () => {
    expect(wagmiConfig.chains.map((c) => c.id).sort((a, b) => a - b)).toEqual([
      1, 369, 943,
    ]);
  });

  it("exposes a transport per chain", () => {
    for (const chain of wagmiConfig.chains) {
      expect(wagmiConfig._internal.transports[chain.id]).toBeDefined();
    }
  });

  it("wires at least one connector (injected)", () => {
    expect(wagmiConfig.connectors.length).toBeGreaterThan(0);
  });
});
