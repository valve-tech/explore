import {
  FETCH_TIMEOUT,
  SOURCIFY_API_URL,
  UpstreamError,
  type SourceFile,
  type VerifiedSource,
} from "./types.js";
import { currentChain } from "../chains/context.js";

/**
 * Fetch verified source from Sourcify (API v2) — the primary verified-source
 * lookup; Blockscout is only a fallback.
 *
 * The chain in the URL comes from the request's chain context; chains with
 * `sourcifyEnabled: false` (e.g. the testnet) resolve to a definitive miss.
 */
export async function fetchFromSourcify(
  address: string,
): Promise<VerifiedSource | null> {
  const chain = currentChain();
  if (!chain.sourcifyEnabled) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

  try {
    const chainId = chain.chainId;

    // Sourcify API v2. v1 (`/files/any/<chain>/<addr>`) entered a scheduled
    // BROWNOUT on 2026-07-07 and now answers 503 to every request — including
    // for contracts it has verified — until at least 2027-01-08, after which
    // it is removed. A 503 is an UpstreamError, so every ABI lookup fell
    // through to the Blockscout fallback and its full timeout; that is what
    // made /api/tx exceed its budget and 504 for any tx with several distinct
    // log emitters. Do NOT "restore" a v1 path.
    //
    //   GET /v2/contract/<chain>/<addr>?fields=abi,sources,compilation
    //     200 → { abi, sources: { "<path>": { content } },
    //             compilation: { compilerVersion, name, compilerSettings }, … }
    //     404 → not verified (definitive miss, same semantics as v1)
    //
    // Field selection is required: without `?fields=` v2 returns match
    // metadata only (no abi/sources), which would look like a verified
    // contract with nothing in it.
    const url = `${SOURCIFY_API_URL}/v2/contract/${chainId}/${address}?fields=abi,sources,compilation`;
    let res: Response;
    try {
      res = await fetch(url, { signal: controller.signal });
    } catch (err) {
      throw new UpstreamError(
        "sourcify",
        err instanceof Error ? err.message : "network error",
      );
    }
    if (res.status >= 500) throw new UpstreamError("sourcify", `HTTP ${res.status}`);
    if (res.status === 404) return null; // definitive "not verified here"
    if (!res.ok) throw new UpstreamError("sourcify", `HTTP ${res.status}`);

    const body = (await res.json()) as {
      abi?: unknown[];
      sources?: Record<string, { content?: string }>;
      compilation?: {
        compilerVersion?: string;
        name?: string;
        compilerSettings?: { optimizer?: { enabled?: boolean; runs?: number } };
      };
    };

    // v2 keys sources by their compilation path ("WPLS.sol",
    // "contracts/Foo.sol"). Unlike v1 there is no metadata.json mixed into
    // the list, so take every entry rather than filtering to `.sol` — that
    // filter would have silently dropped Vyper/Yul sources.
    const sourceFiles: SourceFile[] = Object.entries(body.sources ?? {})
      .filter(([, file]) => typeof file?.content === "string")
      .map(([path, file]) => ({ name: path, content: file.content as string }));

    if (sourceFiles.length === 0) return null;

    const abi: unknown[] = Array.isArray(body.abi) ? body.abi : [];
    const compilerVersion = body.compilation?.compilerVersion ?? null;
    const optimizer = body.compilation?.compilerSettings?.optimizer;

    return {
      address: address.toLowerCase(),
      chainSource: "sourcify",
      // v2 reports the compiled contract's real name. v1 didn't, so this used
      // to be the first source file's basename — wrong whenever a file held
      // more than one contract or was named differently from its contract.
      contractName:
        body.compilation?.name ?? sourceFiles[0]?.name.replace(/\.[^.]+$/, "") ?? null,
      compilerVersion,
      // v1 exposed no optimizer settings so these were hardcoded false/null —
      // i.e. we reported "not optimized" for every verified contract. v2
      // carries the real compilerSettings, so report what the build used.
      optimizationUsed: optimizer?.enabled ?? false,
      optimizationRuns: optimizer?.runs ?? null,
      sourceFiles,
      abi,
      sourceMap: null,
      deployedBytecode: null,
    };
  } catch (err) {
    // Let UpstreamError propagate so getVerifiedSource can distinguish
    // "sourcify is down" from "sourcify said this contract isn't there".
    if (err instanceof UpstreamError) throw err;
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ===========================================================================
// Verification submit (forward an inbound verification request to Sourcify).
// ===========================================================================

/**
 * Match strength reported by Sourcify after a successful verify.
 *
 *   - `perfect`  — bytecode + metadata hash both match exactly
 *   - `partial`  — bytecode matches but metadata differs (e.g. different
 *                  source paths or comment differences); semantically OK
 *                  but suggests the build isn't reproducible
 *
 * Mirrors Etherscan's verification statuses for the dispatcher's response
 * envelope.
 */
export type SourcifyMatch = "perfect" | "partial";

export interface SourcifyVerifySuccess {
  ok: true;
  match: SourcifyMatch;
  /** ISO timestamp Sourcify recorded for the verified entry. */
  storageTimestamp: string | null;
  /** Sourcify response body, retained for the GUID-poll shim. */
  raw: unknown;
}

export interface SourcifyVerifyFailure {
  ok: false;
  /** User-facing error message from Sourcify (e.g. "deployed bytecode does not match"). */
  error: string;
  /** Sourcify response body. */
  raw: unknown;
}

export type SourcifyVerifyResult = SourcifyVerifySuccess | SourcifyVerifyFailure;

export interface SubmitToSourcifyRequest {
  /** Lowercased 0x-address of the deployed contract. */
  address: string;
  /** Numeric chainId — defaults to 369 (PulseChain mainnet) at call sites. */
  chainId: number;
  /** Map of filename → file content. MUST include a `metadata.json` whose
   *  hash matches the deployed bytecode for Sourcify to accept a perfect
   *  match; the partial-match path is more permissive. */
  files: Record<string, string>;
}

/**
 * POST a verification submission to Sourcify and return the match result.
 *
 * Sourcify's verify endpoint is synchronous — unlike Etherscan, which
 * returns a GUID and makes you poll. The Etherscan-shaped dispatcher
 * wraps this in an in-memory GUID table so callers using
 * `checkverifystatus` see the familiar async flow.
 *
 * Failures fall into two buckets:
 *   1. Sourcify reachable, said "no" (bytecode mismatch, missing
 *      metadata, etc.) → resolves with `ok: false` and the upstream
 *      message; the caller decides whether to surface or retry.
 *   2. Sourcify unreachable (network, 5xx, timeout) → throws
 *      `UpstreamError` so the dispatcher can return a 503 instead of
 *      poisoning a stable "verification failed" state.
 */
export async function submitToSourcify(
  req: SubmitToSourcifyRequest,
): Promise<SourcifyVerifyResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

  try {
    const url = `${SOURCIFY_API_URL}/verify`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: req.address.toLowerCase(),
          chain: String(req.chainId),
          files: req.files,
        }),
        signal: controller.signal,
      });
    } catch (err) {
      throw new UpstreamError(
        "sourcify",
        err instanceof Error ? err.message : "network error",
      );
    }

    // Transient — 5xx, gateway hiccups. Bubble out so the route can 503.
    if (res.status >= 500) {
      throw new UpstreamError("sourcify", `HTTP ${res.status}`);
    }

    const body = (await res.json().catch(() => null)) as
      | {
          result?: Array<{
            address?: string;
            chainId?: string;
            status?: string;
            storageTimestamp?: string;
            message?: string;
          }>;
          error?: string;
        }
      | null;

    if (!res.ok || !body) {
      return {
        ok: false,
        error: body?.error ?? `Sourcify returned HTTP ${res.status}`,
        raw: body,
      };
    }

    const entry = body.result?.[0];
    const status = entry?.status;
    if (status === "perfect" || status === "partial") {
      return {
        ok: true,
        match: status,
        storageTimestamp: entry?.storageTimestamp ?? null,
        raw: body,
      };
    }

    return {
      ok: false,
      error: entry?.message ?? body.error ?? "Sourcify rejected the submission",
      raw: body,
    };
  } finally {
    clearTimeout(timer);
  }
}
