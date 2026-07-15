import {
  BLOCKSCOUT_FETCH_TIMEOUT,
  UpstreamError,
  type SourceFile,
  type VerifiedSource,
} from "./types.js";
import { currentChain } from "../chains/context.js";

interface BlockScoutSourceResult {
  SourceCode: string;
  ABI: string;
  ContractName: string;
  CompilerVersion: string;
  OptimizationUsed: string;
  Runs: string;
  AdditionalSources?: Array<{ Filename: string; SourceCode: string }>;
}

/**
 * Fetch verified source from BlockScout's v1 `getsourcecode` endpoint.
 * Returns `null` only when BlockScout responds normally with "not verified"
 * (status !== "1" or empty SourceCode). Throws `UpstreamError` for transient
 * failures — 5xx, network errors, timeouts — so the caller can avoid caching
 * an outage as a permanent miss and the route can surface a 503.
 *
 * Also reaches into the v2 `smart-contracts/{address}` endpoint when
 * available to pick up `source_map` and `deployed_bytecode` — useful for
 * the source-mapped debugger view. v2 may not be enabled on every
 * BlockScout instance; absence isn't fatal.
 */
export async function fetchFromBlockScout(
  address: string,
): Promise<VerifiedSource | null> {
  // A chain without BlockScout can't have a verified source there — that's a
  // definitive miss (null), not a transient outage (UpstreamError), so the
  // caller may still consult Sourcify and safely negative-cache the result.
  const blockscoutBase = currentChain().blockscoutBase;
  if (!blockscoutBase) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BLOCKSCOUT_FETCH_TIMEOUT);

  let res: Response;
  try {
    const url = `${blockscoutBase}?module=contract&action=getsourcecode&address=${address}`;
    res = await fetch(url, { signal: controller.signal });
  } catch (err) {
    clearTimeout(timer);
    // Network error or AbortError (timeout). Either way it's transient.
    throw new UpstreamError(
      "blockscout",
      err instanceof Error ? err.message : "network error",
    );
  }

  try {
    if (res.status >= 500) {
      throw new UpstreamError("blockscout", `HTTP ${res.status}`);
    }
    if (!res.ok) return null; // 4xx → upstream answered, just no source

    const data = (await res.json()) as {
      status: string;
      result: BlockScoutSourceResult[];
    };
    if (data.status !== "1" || !data.result?.[0]) return null;

    const r = data.result[0];
    if (!r.SourceCode || r.SourceCode === "") return null;

    const sourceFiles: SourceFile[] = [
      {
        name: r.ContractName ? `${r.ContractName}.sol` : "Contract.sol",
        content: r.SourceCode,
      },
    ];

    if (r.AdditionalSources) {
      for (const s of r.AdditionalSources) {
        sourceFiles.push({ name: s.Filename, content: s.SourceCode });
      }
    }

    let abi: unknown[] = [];
    try {
      abi = JSON.parse(r.ABI) as unknown[];
    } catch {
      // ignore — empty abi is fine
    }

    const { sourceMap, deployedBytecode } = await fetchSmartContractV2(
      address,
      controller.signal,
    );

    return {
      address: address.toLowerCase(),
      chainSource: "blockscout",
      contractName: r.ContractName || null,
      compilerVersion: r.CompilerVersion || null,
      optimizationUsed: r.OptimizationUsed === "1",
      optimizationRuns: r.Runs ? parseInt(r.Runs, 10) : null,
      sourceFiles,
      abi,
      sourceMap,
      deployedBytecode,
    };
  } catch (err) {
    // Let UpstreamError propagate so getVerifiedSource can distinguish a
    // transient outage from an actual "not verified" answer (otherwise a
    // 5xx storm gets cemented in the negative cache for 10 minutes).
    if (err instanceof UpstreamError) throw err;
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchSmartContractV2(
  address: string,
  signal: AbortSignal,
): Promise<{ sourceMap: string | null; deployedBytecode: string | null }> {
  const blockscoutBase = currentChain().blockscoutBase;
  if (!blockscoutBase) return { sourceMap: null, deployedBytecode: null };
  try {
    const url = `${blockscoutBase.replace("/api", "")}/api/v2/smart-contracts/${address}`;
    const res = await fetch(url, { signal });
    if (!res.ok) return { sourceMap: null, deployedBytecode: null };
    const data = (await res.json()) as {
      deployed_bytecode?: string;
      source_map?: string;
    };
    return {
      sourceMap: data.source_map ?? null,
      deployedBytecode: data.deployed_bytecode ?? null,
    };
  } catch {
    return { sourceMap: null, deployedBytecode: null };
  }
}
