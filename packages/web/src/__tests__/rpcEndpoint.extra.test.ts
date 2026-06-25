import { describe, it, expect, afterEach } from "vitest";
import {
  getRpcOverride,
  setRpcOverride,
  clearRpcOverride,
} from "../lib/rpcEndpoint";

/**
 * Supplements rpcEndpoint.test.ts — covers the `typeof localStorage ===
 * "undefined"` guard branches (the SSR / no-storage environment) that the main
 * suite's jsdom localStorage never hits.
 */

const G = globalThis as { localStorage?: Storage };
const original = G.localStorage;

afterEach(() => {
  if (original === undefined) delete G.localStorage;
  else G.localStorage = original;
});

describe("rpcEndpoint — no localStorage environment", () => {
  it("getRpcOverride returns null when localStorage is undefined", () => {
    delete G.localStorage;
    expect(getRpcOverride(369)).toBeNull();
  });

  it("setRpcOverride returns the sanitized url but writes nothing without localStorage", () => {
    delete G.localStorage;
    // Sanitizes + returns even though there's nowhere to persist.
    expect(setRpcOverride(369, "https://node.example/rpc")).toBe(
      "https://node.example/rpc",
    );
  });

  it("setRpcOverride still rejects invalid input without localStorage", () => {
    delete G.localStorage;
    expect(setRpcOverride(369, "javascript:alert(1)")).toBeNull();
  });

  it("clearRpcOverride is a no-op (no throw) when localStorage is undefined", () => {
    delete G.localStorage;
    expect(() => clearRpcOverride(369)).not.toThrow();
  });
});
