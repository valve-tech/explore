import { describe, it, expect, beforeEach } from "vitest";
import {
  sanitizeRpcUrl,
  getRpcOverride,
  setRpcOverride,
  clearRpcOverride,
  resolveRpcUrl,
  isRpcOverridden,
  rpcOverrideKey,
} from "../lib/rpcEndpoint";

beforeEach(() => {
  localStorage.clear();
});

describe("sanitizeRpcUrl", () => {
  it("accepts http(s) and preserves the path + query (provider keys)", () => {
    expect(sanitizeRpcUrl("https://eth.example/v2/ABC123")).toBe(
      "https://eth.example/v2/ABC123",
    );
    expect(sanitizeRpcUrl("http://localhost:8545")).toBe("http://localhost:8545/");
    expect(sanitizeRpcUrl("https://rpc.example/?key=xyz")).toBe(
      "https://rpc.example/?key=xyz",
    );
  });

  it("rejects non-http(s), unparseable, and empty input", () => {
    expect(sanitizeRpcUrl("javascript:alert(1)")).toBeNull();
    expect(sanitizeRpcUrl("ws://node.example")).toBeNull();
    expect(sanitizeRpcUrl("not a url")).toBeNull();
    expect(sanitizeRpcUrl("")).toBeNull();
    expect(sanitizeRpcUrl(null)).toBeNull();
  });
});

describe("per-chain override get/set/clear", () => {
  it("persists, reads back, and clears independently per chain", () => {
    expect(getRpcOverride(1)).toBeNull();
    expect(setRpcOverride(1, "https://eth.example/rpc")).toBe(
      "https://eth.example/rpc",
    );
    expect(getRpcOverride(1)).toBe("https://eth.example/rpc");
    expect(isRpcOverridden(1)).toBe(true);

    // Other chains are unaffected.
    expect(getRpcOverride(369)).toBeNull();
    expect(isRpcOverridden(369)).toBe(false);
    expect(localStorage.getItem(rpcOverrideKey(1))).toBe(
      "https://eth.example/rpc",
    );

    clearRpcOverride(1);
    expect(getRpcOverride(1)).toBeNull();
    expect(isRpcOverridden(1)).toBe(false);
  });

  it("rejects invalid input and writes nothing", () => {
    expect(setRpcOverride(369, "javascript:alert(1)")).toBeNull();
    expect(getRpcOverride(369)).toBeNull();
  });

  it("ignores a poisoned non-http stored value on read", () => {
    localStorage.setItem(rpcOverrideKey(943), "javascript:evil()");
    expect(getRpcOverride(943)).toBeNull();
  });
});

describe("resolveRpcUrl", () => {
  it("returns null with no override — there is no shared proxy", () => {
    expect(resolveRpcUrl(369)).toBeNull();
    expect(resolveRpcUrl(1)).toBeNull();
    expect(resolveRpcUrl(943)).toBeNull();
  });

  it("returns the user's node verbatim (no chainid) when overridden", () => {
    setRpcOverride(943, "https://my-v4-node.example/rpc");
    expect(resolveRpcUrl(943)).toBe("https://my-v4-node.example/rpc");
    // unset chains have no endpoint (the app uses the backend REST API instead)
    expect(resolveRpcUrl(1)).toBeNull();
  });
});
