export interface SourceFile {
  name: string;
  content: string;
}

export interface VerifiedSource {
  address: string;
  /** Source provider that produced this row: "blockscout" | "sourcify" */
  chainSource: string;
  contractName: string | null;
  compilerVersion: string | null;
  optimizationUsed: boolean;
  optimizationRuns: number | null;
  sourceFiles: SourceFile[];
  abi: unknown[];
  /** Runtime source map from BlockScout's smart-contracts API, if available. */
  sourceMap: string | null;
  deployedBytecode: string | null;
}

export const SOURCIFY_API_URL = "https://sourcify.dev/server";

/**
 * Per-upstream fetch deadlines. These MUST sum to comfortably less than the
 * caller's budget: /api/tx allows getTransactionDetails 15s
 * (routes/explorer.ts). This was previously ONE shared `FETCH_TIMEOUT = 15_000`
 * — i.e. exactly the whole route budget — so a single slow upstream could spend
 * the caller's entire allowance and force a 504 with nothing left over.
 *
 * Sourcify is primary and can return megabytes of flattened source, so it takes
 * the larger share. Blockscout is only consulted on a Sourcify miss, so a dead
 * host should be discovered quickly rather than waited out: the TCP connect
 * timeout to the (currently unreachable) api.scan.pulsechain.com is ~10.5s on
 * its own, which is what made the first request on a cold container slow.
 *
 * Sum (11s) < budget (15s), leaving headroom for the RPC reads in the same
 * route. Keep it that way if you touch these.
 */
export const SOURCIFY_FETCH_TIMEOUT = 8_000;
export const BLOCKSCOUT_FETCH_TIMEOUT = 3_000;

/**
 * Thrown by a source fetcher when the upstream is transiently unavailable
 * (5xx, network error, timeout) — distinct from "upstream answered and the
 * contract isn't verified" (which is null). Lets getVerifiedSource avoid
 * caching a transient outage as a permanent "not verified", and lets the
 * route surface a 503 instead of a misleading 404.
 */
export class UpstreamError extends Error {
  readonly upstream: string;
  constructor(upstream: string, message: string) {
    super(`[${upstream}] ${message}`);
    this.name = "UpstreamError";
    this.upstream = upstream;
  }
}
