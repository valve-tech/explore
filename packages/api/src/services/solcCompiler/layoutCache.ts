import { currentChainId } from "../chains/context.js";
import { compileForSourceMap } from "./compileForSourceMap.js";
import type { CompilationResult } from "./types.js";

/**
 * The storage-layout route must recompile, because the source-map cache holds
 * no layout. A solc run is heavy and the route is public, so this module keeps
 * the result per chain and address:
 * - one compile at a time per key (later callers share the promise),
 * - failed results (null) too, for NEGATIVE_TTL_MS, so a contract with no
 *   layout does not recompile on every request,
 * - at most MAX_ENTRIES keys, oldest out first.
 */
const MAX_ENTRIES = 256;
const NEGATIVE_TTL_MS = 10 * 60_000;

interface Entry {
  at: number;
  result: Promise<CompilationResult | null>;
  settled: CompilationResult | null | undefined;
}

type Compile = (address: string) => Promise<CompilationResult | null>;

export function createLayoutCache(
  compile: Compile,
  chainId: () => number,
  now: () => number = Date.now,
) {
  const entries = new Map<string, Entry>();
  return (address: string): Promise<CompilationResult | null> => {
    const key = `${chainId()}:${address.toLowerCase()}`;
    const hit = entries.get(key);
    const expired = hit && hit.settled === null && now() - hit.at > NEGATIVE_TTL_MS;
    if (hit && !expired) {
      // Refresh the order, so the oldest-out rule drops the least used key.
      entries.delete(key);
      entries.set(key, hit);
      return hit.result;
    }
    const entry: Entry = { at: now(), result: compile(address), settled: undefined };
    entry.result.then(
      (r) => { entry.settled = r; },
      () => { entries.delete(key); },
    );
    entries.delete(key);
    entries.set(key, entry);
    while (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value!);
    return entry.result;
  };
}

/** compileForSourceMap with the storage layout, cached as above. */
export const compileWithStorageLayout = createLayoutCache(
  (address) => compileForSourceMap(address, { storageLayout: true }),
  currentChainId,
);
