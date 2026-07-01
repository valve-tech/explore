import { apiUrl } from "../lib/apiBase";

/**
 * Client for the cross-chain resolve endpoint (`GET /api/resolve?q=…`).
 *
 * A pasted tx hash / address / block number is chain-specific, but the search
 * UIs don't always know the chain. This asks the backend which registered
 * chain(s) the entity actually exists on, so the caller can route with the
 * right `?chainid=N` instead of silently defaulting to one chain.
 */

const API_BASE = apiUrl("/api");

export type ResolveKind = "tx" | "address" | "block" | "selector" | "unknown";

export interface ResolveMatch {
  chainId: number;
  /** address results only: whether the address has bytecode on that chain. */
  isContract?: boolean;
}

export interface ResolveResult {
  kind: ResolveKind;
  query: string;
  matches: ResolveMatch[];
}

export async function resolveEntity(q: string): Promise<ResolveResult> {
  const res = await fetch(`${API_BASE}/resolve?q=${encodeURIComponent(q)}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Resolve failed" }));
    throw new Error((err as { error?: string }).error ?? "Resolve failed");
  }
  const data = (await res.json()) as { ok: boolean; result: ResolveResult };
  return data.result;
}
