import { describe, it, expect, afterEach } from "vitest";
import { getActiveChainId } from "../lib/activeChain";
import { DEFAULT_CHAIN_ID } from "../lib/chains";

/**
 * Non-reactive chain-id read from the URL. Drives parseChainId across its
 * branches by writing window.location.search (BrowserRouter) and the hash query
 * (HashRouter / IPFS build).
 */

const original = window.location.href;

function setSearch(search: string): void {
  window.history.replaceState({}, "", `/${search}`);
}

afterEach(() => {
  window.history.replaceState({}, "", original);
});

describe("getActiveChainId", () => {
  it("defaults to PulseChain when no chainid param is present", () => {
    setSearch("");
    expect(getActiveChainId()).toBe(DEFAULT_CHAIN_ID);
  });

  it("reads a valid chainid from location.search", () => {
    setSearch("?chainid=1");
    expect(getActiveChainId()).toBe(1);
    setSearch("?chainid=943");
    expect(getActiveChainId()).toBe(943);
  });

  it("falls back to the default for a non-integer or non-positive chainid", () => {
    setSearch("?chainid=abc");
    expect(getActiveChainId()).toBe(DEFAULT_CHAIN_ID);
    setSearch("?chainid=0");
    expect(getActiveChainId()).toBe(DEFAULT_CHAIN_ID);
    setSearch("?chainid=-5");
    expect(getActiveChainId()).toBe(DEFAULT_CHAIN_ID);
    setSearch("?chainid=1.5");
    expect(getActiveChainId()).toBe(DEFAULT_CHAIN_ID);
  });

  it("reads chainid from the hash query (HashRouter / IPFS build)", () => {
    window.history.replaceState({}, "", "/#/tx/0xabc?chainid=369");
    expect(getActiveChainId()).toBe(369);
  });

  it("returns the default in a no-window (SSR) environment", () => {
    const g = globalThis as { window?: Window };
    const saved = g.window;
    delete g.window; // make `typeof window === "undefined"` true
    try {
      expect(getActiveChainId()).toBe(DEFAULT_CHAIN_ID);
    } finally {
      g.window = saved;
    }
  });
});

describe("getActiveChainId — path prefix", () => {
  it("reads the chain from a path prefix", () => {
    window.history.replaceState({}, "", "/eip155/1/tx/0xabc");
    expect(getActiveChainId()).toBe(1);
  });

  it("reads a path prefix inside the hash (HashRouter / IPFS build)", () => {
    window.history.replaceState({}, "", "/#/eip155/943/tx/0xabc");
    expect(getActiveChainId()).toBe(943);
  });

  it("lets the path prefix beat a conflicting chainid parameter", () => {
    window.history.replaceState({}, "", "/eip155/1/tx/0xabc?chainid=369");
    expect(getActiveChainId()).toBe(1);
  });

  it("still defaults to PulseChain for an unscoped URL", () => {
    window.history.replaceState({}, "", "/address/0xdef");
    expect(getActiveChainId()).toBe(DEFAULT_CHAIN_ID);
  });
});
