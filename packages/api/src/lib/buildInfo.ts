/**
 * Build identity for the API.
 *
 * The resolver itself lives in scripts/build-info.mjs — the single source of
 * truth shared with the web build (which injects it via vite `define`). This
 * module adds only per-process memoization, so there is no second copy of the
 * env → git → "unknown" logic to drift out of sync.
 *
 * The .mjs is imported through its .d.mts declaration, so it never enters this
 * package's tsc program (no rootDir violation despite rootDir: "src") and the
 * specifier survives emit — src/lib and dist/lib sit at the same depth below
 * the repo root, so it resolves in dev (tsx) and prod (dist) alike.
 */
import { resolveBuildInfo, type BuildInfo } from "../../../../scripts/build-info.mjs";

export type { BuildInfo };

let cached: BuildInfo | null = null;

/** Memoized build identity — resolved once per process. */
export function getBuildInfo(): BuildInfo {
  cached ??= resolveBuildInfo();
  return cached;
}
