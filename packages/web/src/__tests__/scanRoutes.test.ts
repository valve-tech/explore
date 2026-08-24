import { describe, it, expect } from "vitest";
import { scanPath } from "../lib/scanRoutes";

describe("scanPath", () => {
  it("builds a tx path", () => {
    expect(scanPath("tx", "0xabc")).toBe("/tx/0xabc");
  });

  it("builds a block path for a number", () => {
    expect(scanPath("block", "1234")).toBe("/block/1234");
  });

  it("builds a block path for a hash", () => {
    expect(scanPath("block", "0xdeadbeef")).toBe("/block/0xdeadbeef");
  });

  it("builds an address path", () => {
    expect(scanPath("address", "0x0000000000000000000000000000000000000001")).toBe(
      "/address/0x0000000000000000000000000000000000000001",
    );
  });

  it("builds a contract path under /token/", () => {
    expect(scanPath("contract", "0xCAFE")).toBe("/token/0xCAFE");
  });

  it("does not transform or encode the value", () => {
    // Values are pre-validated by callers; the helper is a pure path concat.
    expect(scanPath("tx", "weird value")).toBe("/tx/weird value");
  });

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
