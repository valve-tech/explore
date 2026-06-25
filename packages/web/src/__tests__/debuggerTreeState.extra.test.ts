import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  loadTreeExpandState,
  saveTreeExpandState,
  pruneStaleTreeState,
} from "../lib/debuggerTreeState";

/**
 * Supplements debuggerTreeState.test.ts — covers the non-object-JSON branch in
 * load() and the storage-failure swallows in save/prune.
 */

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("debuggerTreeState — non-object stored JSON", () => {
  it("returns {} when the stored JSON is a number (not an object)", () => {
    localStorage.setItem("debugger:tree-expand:369:0xnum", "42");
    expect(loadTreeExpandState("0xnum")).toEqual({});
  });

  it("returns {} when the stored JSON is null", () => {
    localStorage.setItem("debugger:tree-expand:369:0xnull", "null");
    expect(loadTreeExpandState("0xnull")).toEqual({});
  });

  it("returns {} when the wrapped overrides field is null (?? fallback)", () => {
    localStorage.setItem(
      "debugger:tree-expand:369:0xempty",
      JSON.stringify({ updatedAt: 1, overrides: null }),
    );
    expect(loadTreeExpandState("0xempty")).toEqual({});
  });
});

describe("debuggerTreeState — storage failures are swallowed", () => {
  it("saveTreeExpandState does not throw when setItem throws", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => saveTreeExpandState("0xabc", { a: true })).not.toThrow();
    spy.mockRestore();
  });

  it("pruneStaleTreeState does not throw when storage access throws", () => {
    const spy = vi
      .spyOn(Storage.prototype, "key")
      .mockImplementation(() => {
        throw new Error("storage unavailable");
      });
    // Seed at least one key so the loop is entered.
    localStorage.setItem("debugger:tree-expand:369:0xx", JSON.stringify({ updatedAt: 1, overrides: {} }));
    expect(() => pruneStaleTreeState()).not.toThrow();
    spy.mockRestore();
  });

  it("leaves unparseable entries during prune untouched", () => {
    localStorage.setItem("debugger:tree-expand:369:0xbad", "{not json");
    expect(() => pruneStaleTreeState()).not.toThrow();
    expect(localStorage.getItem("debugger:tree-expand:369:0xbad")).toBe("{not json");
  });
});
