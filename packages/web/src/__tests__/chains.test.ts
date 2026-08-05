import { describe, it, expect } from "vitest";
import {
  ALL_CHAINS,
  CHAINS,
  chainById,
  chainLogoUrl,
} from "../lib/chains";

/**
 * Unit tests for the UI-side chain registry. It must mirror the backend
 * registry (packages/api/src/services/chains/defaults.ts), which is
 * authoritative: chains 1 (Ethereum), 369 (PulseChain), 943 (PulseChain
 * Testnet), 11155111 (Sepolia). Tests pin the contract so a regression (wrong
 * id, missing logo URL, ALL_CHAINS colliding with a real id) is loud.
 */

describe("CHAINS registry", () => {
  it("includes every chain the backend registry serves", () => {
    // Ascending numeric order — `.sort()` here would compare as strings and put
    // 11155111 before 369.
    const ids = CHAINS.map((c) => c.id).sort((a, b) => a - b);
    expect(ids).toEqual([1, 369, 943, 11155111]);
  });

  it("registers Sepolia as a testnet with the backend's slug and symbol", () => {
    const sepolia = chainById(11155111);
    expect(sepolia?.name).toBe("Sepolia");
    expect(sepolia?.slug).toBe("sepolia");
    expect(sepolia?.symbol).toBe("ETH");
    expect(sepolia?.testnet).toBe(true);
  });

  it("every entry has the load-bearing fields populated", () => {
    for (const c of CHAINS) {
      expect(c.name.length).toBeGreaterThan(0);
      expect(c.slug.length).toBeGreaterThan(0);
      expect(c.symbol.length).toBeGreaterThan(0);
      expect(typeof c.testnet).toBe("boolean");
    }
  });

  it("slugs are unique (used as URL segments)", () => {
    const slugs = new Set(CHAINS.map((c) => c.slug));
    expect(slugs.size).toBe(CHAINS.length);
  });

  it("943 matches the canonical PulseChain V4 values (viem + backend registry)", () => {
    // Reconciled with viem's pulsechainV4 definition (name "PulseChain V4",
    // nativeCurrency.symbol "v4PLS") and the backend chains registry, which is
    // authoritative. slug stays "pulsechain-testnet" to match the backend's
    // route-prefix field (explorerSlug); chifraChain ("pulsechain-v4") is a
    // separate TrueBlocks daemon param, not the UI route slug.
    const v4 = chainById(943);
    expect(v4?.name).toBe("PulseChain Testnet v4");
    expect(v4?.symbol).toBe("v4PLS");
    expect(v4?.slug).toBe("pulsechain-testnet");
    expect(v4?.testnet).toBe(true);
  });
});

describe("chainById", () => {
  it("returns the matching chain", () => {
    const c = chainById(369);
    expect(c?.name).toBe("PulseChain");
  });

  it("returns undefined for an unregistered chain id", () => {
    expect(chainById(999999)).toBeUndefined();
  });
});

describe("chainLogoUrl", () => {
  it("returns the gib.show /image/<chainId> URL", () => {
    expect(chainLogoUrl(1)).toBe("https://gib.show/image/1");
    expect(chainLogoUrl(369)).toBe("https://gib.show/image/369");
  });

  it("does not validate that the chain id is registered (lookup-free)", () => {
    // The helper is a URL builder, not a validator — gib.show may
    // serve future chain ids we don't yet have an entry for.
    expect(chainLogoUrl(8453)).toBe("https://gib.show/image/8453");
  });
});

describe("ALL_CHAINS sentinel", () => {
  it("is a negative number to distinguish from real chain ids", () => {
    // EIP-155 chain ids are positive integers. A negative sentinel
    // can never collide with a real chain id.
    expect(ALL_CHAINS).toBeLessThan(0);
  });

  it("does not equal any registered chain id", () => {
    expect(CHAINS.find((c) => c.id === ALL_CHAINS)).toBeUndefined();
  });
});
