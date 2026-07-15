/**
 * The commit this bundle was built from. Injected by vite `define` (see
 * vite.config.ts) — a compile-time constant, not a runtime lookup, so it
 * works for the IPFS build too.
 */
export interface BuildInfo {
  sha: string;
  shortSha: string;
  commitISO: string | null;
  branch: string;
  builtAtISO: string;
}

declare global {
  const __BUILD_INFO__: BuildInfo;
}

export const BUILD_INFO: BuildInfo = __BUILD_INFO__;
