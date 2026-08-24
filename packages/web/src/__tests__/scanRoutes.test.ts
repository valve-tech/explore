import { describe, it, expect } from "vitest";
import { scanPath } from "../lib/scanRoutes";

describe("scanPath", () => {
  it("builds bare EIP-3091 paths when no chain is given", () => {
    expect(scanPath("tx", "0xabc")).toBe("/tx/0xabc");
    expect(scanPath("block", "123")).toBe("/block/123");
    expect(scanPath("address", "0xdef")).toBe("/address/0xdef");
    expect(scanPath("contract", "0xdef")).toBe("/token/0xdef");
  });

  it("prefixes the path when a chain is given", () => {
    expect(scanPath("tx", "0xabc", 369)).toBe("/eip155/369/tx/0xabc");
    expect(scanPath("address", "0xdef", 1)).toBe("/eip155/1/address/0xdef");
    expect(scanPath("contract", "0xdef", 11155111)).toBe("/eip155/11155111/token/0xdef");
  });

  it("falls back to the bare path for an unregistered chain", () => {
    expect(scanPath("tx", "0xabc", 8453)).toBe("/tx/0xabc");
  });
});
