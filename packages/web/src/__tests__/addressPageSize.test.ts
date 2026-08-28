import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ADDRESS_PAGE_SIZES,
  DEFAULT_ADDRESS_PAGE_SIZE,
  coercePageSize,
  loadPageSize,
  pageAtNewSize,
  savePageSize,
  totalPages,
} from "../components/explorer/AddressView/pageSize";

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("coercePageSize", () => {
  it("accepts every supported size, as a number or a string", () => {
    for (const n of ADDRESS_PAGE_SIZES) {
      expect(coercePageSize(n)).toBe(n);
      expect(coercePageSize(String(n))).toBe(n);
    }
  });

  it("falls back to the default for anything else", () => {
    // 250 is chifra's maxRecords, not a page size — the API clamps it to 100
    // without saying so, which is exactly why it must not reach the request.
    for (const bad of [250, 0, -25, 26, NaN, null, undefined, "", "lots"]) {
      expect(coercePageSize(bad)).toBe(DEFAULT_ADDRESS_PAGE_SIZE);
    }
  });
});

describe("pageAtNewSize", () => {
  it("keeps the reader's first visible row on screen", () => {
    // Page 41 of 25 starts at row 1000. At 100 rows that is page 11.
    expect(pageAtNewSize(41, 25, 100)).toBe(11);
    // And back again: page 11 of 100 starts at row 1000, page 41 of 25.
    expect(pageAtNewSize(11, 100, 25)).toBe(41);
  });

  it("holds page 1 at page 1 in both directions", () => {
    expect(pageAtNewSize(1, 25, 100)).toBe(1);
    expect(pageAtNewSize(1, 100, 25)).toBe(1);
  });

  it("never returns a page below 1", () => {
    expect(pageAtNewSize(0, 25, 100)).toBe(1);
    expect(pageAtNewSize(-5, 25, 100)).toBe(1);
  });
});

describe("totalPages", () => {
  it("rounds a partial last page up", () => {
    expect(totalPages(97_027, 25)).toBe(3882);
    expect(totalPages(97_027, 100)).toBe(971);
    expect(totalPages(26, 25)).toBe(2);
  });

  it("reports one page for an empty address", () => {
    expect(totalPages(0, 25)).toBe(1);
  });

  it("never divides by zero", () => {
    expect(totalPages(100, 0)).toBe(1);
  });
});

describe("stored size", () => {
  it("round-trips through localStorage", () => {
    savePageSize(100);
    expect(loadPageSize()).toBe(100);
  });

  it("defaults when nothing is stored", () => {
    expect(loadPageSize()).toBe(DEFAULT_ADDRESS_PAGE_SIZE);
  });

  it("defaults when the stored value is no longer supported", () => {
    window.localStorage.setItem("explore.addressPageSize", "250");
    expect(loadPageSize()).toBe(DEFAULT_ADDRESS_PAGE_SIZE);
  });

  it("survives a browser that blocks storage", () => {
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(loadPageSize()).toBe(DEFAULT_ADDRESS_PAGE_SIZE);
    expect(() => savePageSize(50)).not.toThrow();
  });
});
