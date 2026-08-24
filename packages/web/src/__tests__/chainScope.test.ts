import { describe, it, expect, afterEach } from "vitest";
import {
  parseChainScope,
  chainRoutePrefix,
  readLocationScope,
} from "../lib/chainScope";

const original = window.location.href;
afterEach(() => window.history.replaceState({}, "", original));

describe("parseChainScope", () => {
  it("reads the chain from a path prefix", () => {
    expect(parseChainScope("/eip155/369/tx/0xabc", "")).toEqual({ kind: "one", chainId: 369 });
    expect(parseChainScope("/eip155/11155111/address/0xdef", "")).toEqual({
      kind: "one",
      chainId: 11155111,
    });
  });

  it("lets the path prefix beat a conflicting chainid parameter", () => {
    expect(parseChainScope("/eip155/1/tx/0xabc", "?chainid=369")).toEqual({
      kind: "one",
      chainId: 1,
    });
  });

  it("falls back to the chainid parameter when there is no prefix", () => {
    expect(parseChainScope("/tx/0xabc", "?chainid=943")).toEqual({ kind: "one", chainId: 943 });
  });

  it("reports 'all' when neither is present", () => {
    expect(parseChainScope("/address/0xdef", "")).toEqual({ kind: "all" });
  });

  it("reports 'all' for an unknown namespace or an unregistered reference", () => {
    expect(parseChainScope("/bip122/000000000019d6/tx/4a5e", "")).toEqual({ kind: "all" });
    expect(parseChainScope("/eip155/8453/tx/0xabc", "")).toEqual({ kind: "all" });
    expect(parseChainScope("/eip155/abc/tx/0xabc", "")).toEqual({ kind: "all" });
  });

  it("ignores a bare namespace with no reference", () => {
    expect(parseChainScope("/eip155", "")).toEqual({ kind: "all" });
    expect(parseChainScope("/eip155/", "")).toEqual({ kind: "all" });
  });

  it("treats an empty or malformed chainid as 'all', not as a chain", () => {
    expect(parseChainScope("/tx/0xabc", "?chainid=")).toEqual({ kind: "all" });
    expect(parseChainScope("/tx/0xabc", "?chainid=abc")).toEqual({ kind: "all" });
    expect(parseChainScope("/tx/0xabc", "?chainid=0")).toEqual({ kind: "all" });
    expect(parseChainScope("/tx/0xabc", "?chainid=-5")).toEqual({ kind: "all" });
  });
});

describe("chainRoutePrefix", () => {
  it("builds the two-segment prefix", () => {
    expect(chainRoutePrefix(369)).toBe("/eip155/369");
    expect(chainRoutePrefix(11155111)).toBe("/eip155/11155111");
  });

  it("returns an empty prefix for an unregistered chain", () => {
    expect(chainRoutePrefix(8453)).toBe("");
  });
});

describe("readLocationScope — both router shapes", () => {
  it("reads a path prefix under BrowserRouter", () => {
    window.history.replaceState({}, "", "/eip155/1/tx/0xabc");
    expect(readLocationScope()).toEqual({ kind: "one", chainId: 1 });
  });

  it("reads a path prefix inside the hash under HashRouter", () => {
    window.history.replaceState({}, "", "/#/eip155/943/tx/0xabc");
    expect(readLocationScope()).toEqual({ kind: "one", chainId: 943 });
  });

  it("reads a chainid query inside the hash under HashRouter", () => {
    window.history.replaceState({}, "", "/#/tx/0xabc?chainid=369");
    expect(readLocationScope()).toEqual({ kind: "one", chainId: 369 });
  });

  it("returns 'all' in a no-window (SSR) environment", () => {
    const g = globalThis as { window?: Window };
    const saved = g.window;
    delete g.window;
    try {
      expect(readLocationScope()).toEqual({ kind: "all" });
    } finally {
      g.window = saved;
    }
  });
});
