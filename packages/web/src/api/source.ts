import { apiUrl } from "../lib/apiBase";
import { scoped } from "./chainScope";
import { getActiveChainId } from "../lib/activeChain";

const API_BASE = apiUrl("/api/source");

/**
 * Source endpoints are address-keyed but chain-dependent — the same address
 * holds different code on different chains. Every fetch here is scoped to
 * the URL's active chain at call time; reactive consumers additionally key
 * their queries on `useActiveChainId()`.
 */
function sourceUrl(path: string): string {
  return scoped(`${API_BASE}${path}`, getActiveChainId());
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SourceFile {
  name: string;
  content: string;
}

export interface ContractSource {
  address: string;
  chainSource: string;
  contractName: string | null;
  compilerVersion: string | null;
  optimizationUsed: boolean;
  optimizationRuns: number | null;
  files: SourceFile[];
  abi: unknown[];
  hasSourceMap: boolean;
  hasDeployedBytecode: boolean;
}

export interface SourceLocation {
  file: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  sourceSnippet: string;
  jumpType: string; // "i" = into function, "o" = out of function, "-" = regular
}

export interface SourceResponse {
  ok: boolean;
  source?: ContractSource;
  error?: string;
  hint?: string;
  /**
   * Set by the API on an upstream failure: whether retrying can plausibly
   * produce a different answer. `false` means the chain's only verified-source
   * provider is down, so there is no second opinion to wait for and the retry
   * budget would just be burned. Absent on older responses → treat as true.
   */
  retryable?: boolean;
}

export interface SourceMapResponse {
  ok: boolean;
  mappings?: Record<number, SourceLocation | null>;
  error?: string;
  /** See `SourceResponse.retryable` — same contract, same producer. */
  retryable?: boolean;
}

export interface SlitherElement {
  type: string;
  name: string;
  sourceMapping?: {
    start: number;
    length: number;
    filename_relative: string;
    lines: number[];
  };
}

export interface SlitherFinding {
  check: string;
  impact: "High" | "Medium" | "Low" | "Informational" | "Optimization";
  confidence: "High" | "Medium" | "Low";
  description: string;
  elements: SlitherElement[];
  markdown?: string;
}

export interface SlitherResult {
  address: string;
  findings: SlitherFinding[];
  detectorCount: number;
  durationMs: number;
  error: string | null;
  analyzedAt: string;
}

export interface SlitherResponse {
  ok: boolean;
  analysis?: SlitherResult;
  warning?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

export async function fetchSource(address: string): Promise<SourceResponse> {
  const res = await fetch(sourceUrl(`/${address}`));
  return (await res.json()) as SourceResponse;
}

/**
 * Definitive-vs-transient outcome for one source fetch. Lets the trace-source
 * batcher distinguish "we asked, contract isn't verified" (cache, with TTL) from
 * "upstream is flaky" (omit, retry) — without that split, an early API hiccup
 * persists empty sources forever under our `staleTime: Infinity` defaults and
 * silently breaks the call-tree fnIndex (no source → no function names → no
 * call-site-override). Mirrors the same pattern proven out in contractMeta.ts.
 */
type SourceFetchOutcome =
  | { kind: "verified"; source: ContractSource }
  /** Definitive answer: API says the contract isn't verified (HTTP 404 from
   *  /api/source/:addr, or a 200 with `ok: false` and no transient marker). */
  | { kind: "unverified" }
  /** Upstream is flaky (5xx, network throw, AbortSignal timeout, or the
   *  "temporarily unavailable" envelope hint). Caller retries. */
  | { kind: "transient"; reason: string }
  /** Non-retryable: malformed JSON or other shape error. Caller stops. */
  | { kind: "fatal"; reason: string };

const SOURCE_FETCH_TIMEOUT_MS = 8_000;

async function attemptFetchSource(address: string): Promise<SourceFetchOutcome> {
  let res: Response;
  try {
    res = await fetch(sourceUrl(`/${address}`), {
      signal: AbortSignal.timeout(SOURCE_FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    return {
      kind: "transient",
      reason: err instanceof Error ? err.message : "network error",
    };
  }
  // 404 is the definitive "not verified" signal from routes/source.ts.
  if (res.status === 404) return { kind: "unverified" };
  // Any other HTTP error is transient — UNLESS the API says retrying can't
  // help. It says so when the chain has a single verified-source provider and
  // that provider is down (see `upstreamUnavailable` in routes/source.ts):
  // there is no second opinion coming, so spending the retry budget just turns
  // one dead contract into four dead requests. Read the body before deciding —
  // the flag rides in the error envelope, which this branch used to skip.
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as SourceResponse | null;
    if (body?.retryable === false) return { kind: "unverified" };
    return { kind: "transient", reason: `HTTP ${res.status}` };
  }
  const data = (await res.json().catch(() => null)) as SourceResponse | null;
  if (!data) return { kind: "fatal", reason: "malformed JSON" };
  if (!data.ok) {
    // 200 + ok:false with an explicit "temporarily unavailable" hint flowed
    // through `ApiError` details — treat as transient. Any other ok:false is
    // a definitive answer (treated as not verified).
    if (data.retryable === false) return { kind: "unverified" };
    if (/temporarily unavailable/i.test(data.error ?? "")) {
      return { kind: "transient", reason: data.error! };
    }
    return { kind: "unverified" };
  }
  if (!data.source) return { kind: "fatal", reason: "ok:true but no source" };
  return { kind: "verified", source: data.source };
}

/**
 * Exponential-ish backoff for transient source fetches. Three attempts, ~3.5s
 * worst case before giving up on one address. Exported so tests can override.
 */
export const SOURCE_RETRY_BACKOFF_MS = [500, 1000, 2000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Single-address source fetch with bounded retry. Returns a definitive answer
 * (verified files OR confirmed-unverified) when the upstream gives one within
 * the retry budget; `null` when transient/fatal failures exhausted the budget,
 * so the caller can omit the address from a sparse result and refetch on the
 * next mount instead of pinning the empty answer.
 */
export async function fetchTraceSourceFiles(
  address: string,
): Promise<{ files: SourceFile[]; verified: boolean } | null> {
  for (let attempt = 0; attempt < SOURCE_RETRY_BACKOFF_MS.length; attempt += 1) {
    const outcome = await attemptFetchSource(address);
    if (outcome.kind === "verified") {
      return { files: outcome.source.files, verified: true };
    }
    if (outcome.kind === "unverified") {
      return { files: [], verified: false };
    }
    if (outcome.kind === "fatal") {
      console.warn(
        `[traceSources] non-retryable error for ${address}: ${outcome.reason}`,
      );
      return null;
    }
    // transient — log on the last attempt only so we don't spam the console.
    if (attempt === SOURCE_RETRY_BACKOFF_MS.length - 1) {
      console.warn(
        `[traceSources] giving up on ${address} after ${SOURCE_RETRY_BACKOFF_MS.length} attempts: ${outcome.reason}`,
      );
      return null;
    }
    await sleep(SOURCE_RETRY_BACKOFF_MS[attempt]!);
  }
  return null;
}

/**
 * Single-address contract source fetch with bounded retry. Returns a
 * definitive ContractSource OR null (definitely unverified) within the
 * retry budget; throws on persistent transient failure so React Query
 * treats it as an error (data stays undefined, no cache poisoning).
 */
export async function fetchContractSourceWithRetry(
  address: string,
): Promise<ContractSource | null> {
  for (let attempt = 0; attempt < SOURCE_RETRY_BACKOFF_MS.length; attempt += 1) {
    const outcome = await attemptFetchSource(address);
    if (outcome.kind === "verified") return outcome.source;
    if (outcome.kind === "unverified") return null;
    if (outcome.kind === "fatal") {
      throw new Error(`[contract-source] non-retryable: ${outcome.reason}`);
    }
    if (attempt === SOURCE_RETRY_BACKOFF_MS.length - 1) {
      throw new Error(
        `[contract-source] gave up on ${address} after ${SOURCE_RETRY_BACKOFF_MS.length} attempts: ${outcome.reason}`,
      );
    }
    await sleep(SOURCE_RETRY_BACKOFF_MS[attempt]!);
  }
  throw new Error("[contract-source] unreachable");
}

export async function analyzeContract(
  address: string,
  options: { skipCache?: boolean } = {},
): Promise<SlitherResponse> {
  const res = await fetch(sourceUrl(`/${address}/analyze`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(options),
  });
  return (await res.json()) as SlitherResponse;
}

export async function fetchSourceMappings(
  address: string,
  pcs: number[],
): Promise<SourceMapResponse> {
  const res = await fetch(sourceUrl(`/${address}/map`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pcs }),
  });
  return (await res.json()) as SourceMapResponse;
}

/**
 * Definitive-vs-transient outcome for one source-map fetch, paralleling
 * SourceFetchOutcome. The backend (`POST /api/source/:addr/map`) returns:
 *   - 200 + ok:true + mappings  → mapped
 *   - 404 "Verified source not found"          → unmappable (contract isn't verified)
 *   - 404 "Source map not available — recompilation failed" → unmappable
 *   - 503 "Verification source temporarily unavailable"     → transient
 *   - other 5xx / network / timeout                          → transient
 * Recompilation can succeed later (cache priming, dependency tweak, or the
 * contract becoming verified upstream), so "unmappable" gets a TTL, not ∞.
 */
type SourceMapFetchOutcome =
  | { kind: "mapped"; mappings: Record<number, SourceLocation | null> }
  | { kind: "unmappable" }
  | { kind: "transient"; reason: string }
  | { kind: "fatal"; reason: string };

const SOURCE_MAP_FETCH_TIMEOUT_MS = 12_000; // recompile can be slow on a cold cache

async function attemptFetchSourceMap(
  address: string,
  pcs: number[],
): Promise<SourceMapFetchOutcome> {
  let res: Response;
  try {
    res = await fetch(sourceUrl(`/${address}/map`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pcs }),
      signal: AbortSignal.timeout(SOURCE_MAP_FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    return {
      kind: "transient",
      reason: err instanceof Error ? err.message : "network error",
    };
  }
  if (res.status === 404) return { kind: "unmappable" };
  // See attemptFetchSource: `retryable: false` means the chain's sole
  // verified-source provider is down, so there is nothing to wait for.
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as SourceMapResponse | null;
    if (body?.retryable === false) return { kind: "unmappable" };
    return { kind: "transient", reason: `HTTP ${res.status}` };
  }
  const data = (await res.json().catch(() => null)) as SourceMapResponse | null;
  if (!data) return { kind: "fatal", reason: "malformed JSON" };
  if (!data.ok) {
    if (data.retryable === false) return { kind: "unmappable" };
    if (/temporarily unavailable/i.test(data.error ?? "")) {
      return { kind: "transient", reason: data.error! };
    }
    return { kind: "unmappable" };
  }
  return { kind: "mapped", mappings: data.mappings ?? {} };
}

/**
 * Single-address source-map fetch with bounded retry. Returns a definitive
 * answer (mapped OR confirmed-unmappable) within the retry budget; `null`
 * when transient/fatal exhausted the budget so the caller can omit the
 * address from a sparse result and refetch on the next mount instead of
 * pinning an empty map under `staleTime: Infinity`.
 */
export async function fetchTraceSourceMap(
  address: string,
  pcs: number[],
): Promise<
  | { mappings: Record<number, SourceLocation | null>; mapped: true }
  | { mappings: Record<number, SourceLocation | null>; mapped: false }
  | null
> {
  for (let attempt = 0; attempt < SOURCE_RETRY_BACKOFF_MS.length; attempt += 1) {
    const outcome = await attemptFetchSourceMap(address, pcs);
    if (outcome.kind === "mapped") {
      return { mappings: outcome.mappings, mapped: true };
    }
    if (outcome.kind === "unmappable") {
      return { mappings: {}, mapped: false };
    }
    if (outcome.kind === "fatal") {
      console.warn(
        `[traceSourceMaps] non-retryable error for ${address}: ${outcome.reason}`,
      );
      return null;
    }
    if (attempt === SOURCE_RETRY_BACKOFF_MS.length - 1) {
      console.warn(
        `[traceSourceMaps] giving up on ${address} after ${SOURCE_RETRY_BACKOFF_MS.length} attempts: ${outcome.reason}`,
      );
      return null;
    }
    await sleep(SOURCE_RETRY_BACKOFF_MS[attempt]!);
  }
  return null;
}
