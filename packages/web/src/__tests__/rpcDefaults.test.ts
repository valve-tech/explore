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

    it("offers only endpoints whose provider states it keeps no logs", () => {
      for (const id of CHAINS) {
        for (const choice of rpcAlternatives(id)) {
          expect(choice.tracking, `${choice.url} on chain ${id}`).toBe("none");
        }
      }
    });

    it("finds real third-party options beyond Valve's own", () => {
      // Guards the chainlist wiring itself: if collectRpcs stopped resolving,
      // every list would silently collapse to the single Valve entry and the
      // "no-log options" row would look intentional rather than broken.
      const extras = rpcAlternatives(1).filter((c) => !c.isValve);
      expect(extras.length).toBeGreaterThan(0);
    });

    it("never repeats a URL", () => {
      const urls = rpcAlternatives(369).map((c) => c.url);
      expect(new Set(urls).size).toBe(urls.length);
    });

    it("returns an empty list for a chain chainlist does not know", () => {
      // collectRpcs throws UnknownChainError for an id absent from the
      // dataset. The settings page must not break over a missing suggestion
      // list — and with no Valve entry either, the honest answer is nothing.
      // (999999999 looks unused but is Zora Sepolia and resolves; this id
      // genuinely does not.)
      const unknown = 999999999999;
      expect(() => rpcAlternatives(unknown)).not.toThrow();
      expect(rpcAlternatives(unknown)).toEqual([]);
    });
  });
});
