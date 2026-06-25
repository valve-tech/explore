import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  apiUrl,
  resolveApiBase,
  wsUrl,
  getApiBaseOverride,
  setApiBaseOverride,
  clearApiBaseOverride,
  API_BASE_OVERRIDE_KEY,
} from "../lib/apiBase";

/**
 * Supplements apiBaseOverride.test.ts — covers resolveApiBase / apiUrl / wsUrl,
 * the URL-building helpers not exercised by the override get/set/clear tests.
 */

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("apiBase — resolveApiBase / apiUrl (same-origin default)", () => {
  it("resolves to empty (same-origin) with no override and no baked default", () => {
    expect(resolveApiBase()).toBe("");
    expect(apiUrl("/api/foo")).toBe("/api/foo");
  });

  it("prefers a validated localStorage override", () => {
    localStorage.setItem(API_BASE_OVERRIDE_KEY, "https://explore.valve.city");
    expect(resolveApiBase()).toBe("https://explore.valve.city");
    expect(apiUrl("/api/foo")).toBe("https://explore.valve.city/api/foo");
  });
});

describe("apiBase — wsUrl", () => {
  it("derives wss from an https override origin", () => {
    localStorage.setItem(API_BASE_OVERRIDE_KEY, "https://explore.valve.city");
    expect(wsUrl("/ws/alerts")).toBe("wss://explore.valve.city/ws/alerts");
  });

  it("derives ws from an http override origin", () => {
    localStorage.setItem(API_BASE_OVERRIDE_KEY, "http://localhost:10100");
    expect(wsUrl("/ws/alerts")).toBe("ws://localhost:10100/ws/alerts");
  });

  it("falls back to the page origin when same-origin (no override)", () => {
    // jsdom default origin is http://localhost (host "localhost").
    const out = wsUrl("/ws/alerts");
    expect(out).toBe(`ws://${window.location.host}/ws/alerts`);
  });

  it("uses wss when the page is served over https same-origin", () => {
    const spy = vi
      .spyOn(window, "location", "get")
      .mockReturnValue({ protocol: "https:", host: "explore.valve.city" } as Location);
    expect(wsUrl("/ws/alerts")).toBe("wss://explore.valve.city/ws/alerts");
    spy.mockRestore();
  });
});

describe("apiBase — no localStorage environment (SSR guards)", () => {
  const G = globalThis as { localStorage?: Storage };
  const original = G.localStorage;
  afterEach(() => {
    if (original === undefined) delete G.localStorage;
    else G.localStorage = original;
  });

  it("getApiBaseOverride returns null without localStorage", () => {
    delete G.localStorage;
    expect(getApiBaseOverride()).toBeNull();
  });

  it("setApiBaseOverride returns the normalized origin but writes nothing", () => {
    delete G.localStorage;
    expect(setApiBaseOverride("https://explore.valve.city/x")).toBe(
      "https://explore.valve.city",
    );
  });

  it("clearApiBaseOverride is a no-op without localStorage", () => {
    delete G.localStorage;
    expect(() => clearApiBaseOverride()).not.toThrow();
  });

  it("resolveApiBase falls through to same-origin without localStorage", () => {
    delete G.localStorage;
    expect(resolveApiBase()).toBe("");
  });
});

describe("apiBase — baked VITE_API_BASE default", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("uses the baked origin when set and no override is stored", () => {
    vi.stubEnv("VITE_API_BASE", "https://baked.valve.city");
    localStorage.clear();
    expect(resolveApiBase()).toBe("https://baked.valve.city");
  });
});
