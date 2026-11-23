import { getVerifiedSource } from "../sourceCode.js";
import { chainClient } from "../chains/context.js";
import type { CompilationResult } from "./types.js";
import { cacheCompilationResult, getCachedCompilation } from "./cache.js";
import { getCompiler, resolveFullVersion } from "./loadCompiler.js";
import { extractCompilationData } from "./extractOutput.js";
import { structuresMatch } from "./bytecodeStructure.js";

interface OptimizerSetting {
  enabled: boolean;
  runs: number;
}

/**
 * Optimizer settings to try, reported-first. Explorers (BlockScout especially)
 * frequently misreport `optimizationUsed`/`runs`, so we can't trust the flag:
 * we search a small set of common configs and keep the one whose *opcode
 * structure* matches the deployed bytecode. High run-counts (1e6 / 999999) are
 * common for routers/AMMs that optimize for runtime gas.
 */
function optimizerCandidates(used: boolean, runs: number | null): OptimizerSetting[] {
  const seen = new Set<string>();
  const out: OptimizerSetting[] = [];
  const add = (enabled: boolean, r: number) => {
    const key = `${enabled}:${enabled ? r : 0}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ enabled, runs: r });
    }
  };
  if (used) add(true, runs ?? 200);
  add(true, 200);
  add(true, 1_000_000);
  add(true, 999_999);
  add(false, 200);
  return out;
}

/**
 * Recompile a verified contract to produce a source map + deployed bytecode,
 * GATED on opcode-structure match against the on-chain bytecode. A source map
 * is only meaningful for the trace if the recompiled opcode sequence matches
 * what's deployed (see bytecodeStructure.ts) — otherwise PC→source is
 * misaligned and we'd highlight the wrong code. Returns `null` (→ caller shows
 * opcodes-only, honestly) when no candidate compilation matches.
 *
 * Cached forever on the `verified_sources` row, so the soljson download +
 * multi-compile search only happens once per address.
 */
export async function compileForSourceMap(
  address: string,
  opts: { storageLayout?: boolean } = {},
): Promise<CompilationResult | null> {
  // The cache holds the source map only, never the storage layout. A caller
  // that needs the layout must recompile, or every contract the debugger has
  // opened reads as "no layout" from then on.
  if (!opts.storageLayout) {
    const cached = await getCachedCompilation(address);
    if (cached) return cached;
  }

  // Best-effort: getVerifiedSource can throw UpstreamError during outages.
  // Swallow it here — recompilation has nothing to do if the upstream is down.
  let source;
  try {
    source = await getVerifiedSource(address);
  } catch {
    return null;
  }
  if (!source || !source.compilerVersion) return null;

  // The deployed bytecode is the ground truth we gate against.
  let onchain: string | undefined;
  try {
    onchain = await chainClient().getCode({ address: address as `0x${string}` });
  } catch (err) {
    console.warn(`[solc] eth_getCode failed for ${address}:`, err instanceof Error ? err.message : err);
    return null;
  }
  if (!onchain || onchain === "0x") return null; // no code at address

  try {
    const fullVersion = await resolveFullVersion(source.compilerVersion);
    const compiler = await getCompiler(fullVersion);

    const sources: Record<string, { content: string }> = {};
    for (const file of source.sourceFiles) {
      sources[file.name] = { content: file.content };
    }

    for (const opt of optimizerCandidates(source.optimizationUsed, source.optimizationRuns)) {
      const input = {
        language: "Solidity",
        sources,
        settings: {
          optimizer: { enabled: opt.enabled, runs: opt.runs },
          outputSelection: {
            "*": {
              "*": [
                "abi",
                "storageLayout",
                "evm.deployedBytecode.sourceMap",
                "evm.deployedBytecode.object",
              ],
            },
          },
        },
      };

      const output = JSON.parse(compiler.compile(JSON.stringify(input))) as unknown;
      const extracted = extractCompilationData(output, source.contractName ?? "");
      if (!extracted) continue;

      if (!structuresMatch(extracted.deployedBytecode, onchain)) continue;

      // Match — this source map is valid for the deployed bytecode.
      await cacheCompilationResult(address, extracted.sourceMap, extracted.deployedBytecode);
      const storageNote = extracted.storageLayout
        ? `, storage: ${extracted.storageLayout.storage.length} entries`
        : "";
      console.log(
        `[solc] ${address}: source map verified (optimizer ${opt.enabled ? `on/${opt.runs}` : "off"}, ${extracted.sourceMap.length} chars)${storageNote}`,
      );
      return {
        sourceMap: extracted.sourceMap,
        deployedBytecode: extracted.deployedBytecode,
        abi: source.abi,
        contractName: source.contractName ?? "",
        storageLayout: extracted.storageLayout,
      };
    }

    console.warn(
      `[solc] ${address}: no optimizer setting reproduced the deployed opcode structure — source map withheld (opcodes-only)`,
    );
    return null;
  } catch (err) {
    console.warn(`[solc] recompilation failed for ${address}:`, err instanceof Error ? err.message : err);
    return null;
  }
}
