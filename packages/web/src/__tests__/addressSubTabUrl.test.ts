import { describe, it, expect } from "vitest";
import {
  availableSubTabs,
  resolveActiveTab,
  CONTRACT_ONLY_TABS,
  DEFAULT_SUB_TAB,
} from "../components/explorer/AddressView/subTabUrl";

describe("availableSubTabs", () => {
  it("excludes the contract-only tabs for a plain EOA", () => {
    expect(availableSubTabs(false)).toEqual(["transactions", "tokens"]);
  });

  it("includes every tab for a contract", () => {
    expect(availableSubTabs(true)).toEqual([
      "transactions",
      "tokens",
      ...CONTRACT_ONLY_TABS,
    ]);
  });
});

describe("resolveActiveTab", () => {
  it("returns the requested tab when it is real and available", () => {
    expect(resolveActiveTab("tokens", false)).toBe("tokens");
    expect(resolveActiveTab("storage", true)).toBe("storage");
  });

  it("falls back to the default when the URL carries no tab", () => {
    expect(resolveActiveTab(null, false)).toBe(DEFAULT_SUB_TAB);
  });

  it("falls back to the default for a value that is not a known tab", () => {
    expect(resolveActiveTab("not-a-real-tab", true)).toBe(DEFAULT_SUB_TAB);
  });

  it("falls back to the default for a contract-only tab on a plain EOA", () => {
    for (const tab of CONTRACT_ONLY_TABS) {
      expect(resolveActiveTab(tab, false)).toBe(DEFAULT_SUB_TAB);
    }
  });
});
