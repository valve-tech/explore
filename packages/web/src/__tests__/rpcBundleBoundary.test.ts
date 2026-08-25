import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Guards a bundle-size boundary that nothing else can see.
 *
 * `@valve-tech/rpc-collector` compiles the whole chainlist dataset into the
 * package — about 272 KB — so that resolving endpoints needs no network call.
 * That is the right trade for the settings page and the wrong one for the app
 * shell: `wagmi.ts` runs on every page load, so anything it imports lands in
 * the core chunk. Importing the collector from `rpcDefaults.ts` took the main
 * bundle from ~31 KB to ~55 KB gzipped for a list only /settings renders.
 *
 * Static-import assertion rather than a size check: a byte threshold would
 * drift with every unrelated dependency and teach people to bump the number.
 * The property that actually matters is which module imports what.
 */

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(resolve(SRC, rel), "utf8");

/**
 * Static VALUE imports only.
 *
 * `import()` is excluded because it is the thing we want — it code-splits.
 * `import type` is excluded because TypeScript erases it entirely, so it
 * emits no runtime import and cannot pull anything into a chunk. Counting
 * type imports would fail `RpcChainRow`, which legitimately imports the
 * `RpcChoice` type while loading the module itself dynamically.
 */
function staticImports(source: string): string[] {
  return [
    ...source.matchAll(/^\s*import\s+(?!type\s)[^;]*?from\s+["']([^"']+)["']/gm),
  ].map((m) => m[1] as string);
}

describe("RPC modules — bundle boundary", () => {
  it("keeps the chainlist dataset out of the core chunk", () => {
    // Every module reachable from the app shell on a cold load. RpcChainRow
    // is here because TopBar and Sidebar both render the RPC chip, which
    // renders a row — the path that actually put the dataset in the core
    // chunk the first time. It may only reach rpcSuggestions via import().
    for (const file of [
      "lib/wagmi.ts",
      "lib/rpcDefaults.ts",
      "components/settings/RpcChainRow.tsx",
      "components/settings/RpcSourceChip.tsx",
      // Reached statically from RpcChainRow, so it sits on the same cold
      // path. It may name `RpcChoice` as a type but must never import the
      // module for its value.
      "components/settings/RpcAlternatives.tsx",
    ]) {
      const imports = staticImports(read(file));
      expect(
        imports.some((i) => i.includes("rpc-collector")),
        `${file} statically imports @valve-tech/rpc-collector, which pulls the ~272 KB chainlist dataset into the core chunk`,
      ).toBe(false);
      expect(
        imports.some((i) => i.includes("rpcSuggestions")),
        `${file} imports rpcSuggestions, which transitively pulls in the dataset`,
      ).toBe(false);
    }
  });

  it("still gets its endpoint list from the collector, not a hand-copied one", () => {
    // The other half of the boundary: the suggestions module must actually
    // use the package. Without this, "no collector import anywhere" would
    // pass by deleting the feature.
    const imports = staticImports(read("lib/rpcSuggestions.ts"));
    expect(imports.some((i) => i.includes("rpc-collector"))).toBe(true);
  });
});
