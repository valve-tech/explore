import { describe, it, expect, beforeEach } from "vitest";
import {
  VALVE_PUBLIC_RPC,
  effectiveRpcUrl,
  isUsingDefaultRpc,
} from "../lib/rpcDefaults";
import { rpcAlternatives } from "../lib/rpcSuggestions";
import { setRpcOverride, clearRpcOverride } from "../lib/rpcEndpoint";

const CHAINS = [1, 369, 943, 11155111];

describe("lib/rpcDefaults", () => {
  beforeEach(() => {
    for (const id of CHAINS) clearRpcOverride(id);
  });

  it("has a Valve endpoint for every chain the app serves", () => {
    for (const id of CHAINS) {
      expect(VALVE_PUBLIC_RPC[id], `chain ${id}`).toMatch(
        /^https:\/\/one\.valve\.city\/rpc\/vk_demo\/evm\/\d+$/,
      );
    }
  });

  it("points each Valve URL at its OWN chain", () => {
    // A copy-paste that left every URL on /evm/369 would still match the
    // shape assertion above, so pin the suffix to the key.
    for (const id of CHAINS) {
      expect(VALVE_PUBLIC_RPC[id]).toMatch(new RegExp(`/evm/${id}$`));
    }
  });

  it("falls back to the Valve endpoint when the user set nothing", () => {
    for (const id of CHAINS) {
      expect(effectiveRpcUrl(id)).toBe(VALVE_PUBLIC_RPC[id]);
      expect(isUsingDefaultRpc(id)).toBe(true);
    }
  });

  it("prefers the user's override over the default", () => {
    setRpcOverride(369, "https://my-own-node.example/rpc");
    expect(effectiveRpcUrl(369)).toBe("https://my-own-node.example/rpc");
    expect(isUsingDefaultRpc(369)).toBe(false);
    // Other chains are untouched — the override is per-chain.
    expect(effectiveRpcUrl(1)).toBe(VALVE_PUBLIC_RPC[1]);
  });

  it("returns to the default after the override is cleared", () => {
    setRpcOverride(1, "https://my-own-node.example/rpc");
    clearRpcOverride(1);
    expect(effectiveRpcUrl(1)).toBe(VALVE_PUBLIC_RPC[1]);
  });

  it("is undefined for a chain we do not serve", () => {
    expect(effectiveRpcUrl(8453)).toBeUndefined();
  });

  describe("rpcAlternatives", () => {
    it("leads with Valve's endpoint on every served chain", () => {
      for (const id of CHAINS) {
        const [first] = rpcAlternatives(id);
        expect(first?.url, `chain ${id}`).toBe(VALVE_PUBLIC_RPC[id]);
        expect(first?.isValve).toBe(true);
      }
    });

    it("offers only https endpoints, with no key in the URL", () => {
      for (const id of CHAINS) {
        for (const choice of rpcAlternatives(id)) {
          expect(choice.url, `chain ${id}`).toMatch(/^https:\/\//);
          if (!choice.isValve) expect(choice.url).not.toMatch(/[0-9a-f]{24,}|api_?key/i);
        }
      }
    });

    it("never offers the hosts that log", () => {
      for (const id of CHAINS) {
        const hosts = rpcAlternatives(id, 20).map((c) => new URL(c.url).hostname);
        expect(hosts).not.toContain("rpc.pulsechainrpc.com");
        expect(hosts).not.toContain("rpc.hairylabs.io");
      }
    });

    it("caps the third-party endpoints at the limit", () => {
      expect(rpcAlternatives(1, 3).filter((c) => !c.isValve)).toHaveLength(3);
    });

    it("offers at least one third-party endpoint on every served chain", () => {
      for (const id of CHAINS) {
        expect(rpcAlternatives(id).filter((c) => !c.isValve).length, `chain ${id}`).toBeGreaterThan(0);
      }
    });

    it("never repeats a URL", () => {
      const urls = rpcAlternatives(369).map((c) => c.url);
      expect(new Set(urls).size).toBe(urls.length);
    });

    it("returns an empty list for a chain we do not serve", () => {
      const unknown = 999999999999;
      expect(() => rpcAlternatives(unknown)).not.toThrow();
      expect(rpcAlternatives(unknown)).toEqual([]);
    });
  });
});
