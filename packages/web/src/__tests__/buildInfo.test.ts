import { describe, it, expect } from "vitest";
import { BUILD_INFO } from "../lib/buildInfo";

/**
 * The SHA is injected by vite `define` at build time (and in vitest, which
 * shares vite.config.ts). Assert the shape, never a literal sha — the value
 * legitimately changes every commit.
 */
describe("BUILD_INFO", () => {
  it("is baked in with a well-formed shape", () => {
    expect(BUILD_INFO).toBeDefined();
    expect(typeof BUILD_INFO.sha).toBe("string");
    expect(BUILD_INFO.sha.length).toBeGreaterThan(0);
    expect(BUILD_INFO.sha).toMatch(/^[0-9a-f]{40}$|^unknown$/);
  });

  it("derives shortSha as the first 7 chars of sha", () => {
    expect(BUILD_INFO.shortSha).toBe(BUILD_INFO.sha.slice(0, 7));
  });

  it("stamps an ISO build timestamp", () => {
    expect(BUILD_INFO.builtAtISO).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
