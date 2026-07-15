import { describe, it, expect } from "vitest";
import { hasDrifted, shouldReloadNow } from "../lib/versionDrift";

const BAKED = "9400775aaaabbbbccccdddd";
const DEPLOYED = "0a159c8eeeeffff11112222";

describe("hasDrifted", () => {
  it("is true when the served sha differs from the baked one", () => {
    expect(hasDrifted(DEPLOYED, BAKED)).toBe(true);
  });

  it("is false when they match", () => {
    expect(hasDrifted(BAKED, BAKED)).toBe(false);
  });

  it("is false when the served sha is missing — never reload on a bad payload", () => {
    expect(hasDrifted(null, BAKED)).toBe(false);
    expect(hasDrifted(undefined, BAKED)).toBe(false);
    expect(hasDrifted("", BAKED)).toBe(false);
  });

  it("is false when either side is unknown — an unstamped build is not drift", () => {
    expect(hasDrifted("unknown", BAKED)).toBe(false);
    expect(hasDrifted(DEPLOYED, "unknown")).toBe(false);
    expect(hasDrifted("unknown", "unknown")).toBe(false);
  });
});

describe("shouldReloadNow", () => {
  it("reloads when drifted and idle", () => {
    expect(shouldReloadNow(DEPLOYED, BAKED, false)).toBe(true);
  });

  it("defers while busy — never interrupt in-flight work", () => {
    expect(shouldReloadNow(DEPLOYED, BAKED, true)).toBe(false);
  });

  it("does not reload when there is no drift, busy or not", () => {
    expect(shouldReloadNow(BAKED, BAKED, false)).toBe(false);
    expect(shouldReloadNow(BAKED, BAKED, true)).toBe(false);
  });
});
