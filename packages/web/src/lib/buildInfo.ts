/**
 * The commit this bundle was built from. Injected by vite `define` (see
 * vite.config.ts) — a compile-time constant, not a runtime lookup, so it
 * works for the IPFS build too.
 *
 * CAUTION: esbuild's production minifier drops any property of this object
 * that no bundled code reads via static dot notation (BUILD_INFO.sha). It is
 * a `define`d object literal, so an unread key is eliminated from the shipped
 * chunk even though TypeScript still types it as `string`. Reaching a field
 * only through JSON.stringify(BUILD_INFO), object spread, or dynamic bracket
 * access does NOT count as a read — the field would be `undefined` in
 * production while every type-check and vitest run stays green (vitest skips
 * the minify pass). If you add a field here, read it statically somewhere.
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
