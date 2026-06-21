/**
 * Bring-your-own-RPC: per-chain endpoint for client-side raw reads.
 *
 * There is NO shared JSON-RPC proxy (it was removed) — raw client-side reads are
 * strictly a BYO-RPC opt-in. A user sets a per-chain override, pointing reads at
 * their own node or a provider key (Alchemy/Infura/etc.). With an override the
 * explorer's raw reads (tx/address/block) go DIRECT to that node; without one
 * the app uses the backend's purpose-built REST endpoints and the browser makes
 * no JSON-RPC calls at all. The override is stored in this browser only.
 *
 * Mirrors the shape of `apiBase.ts` (the backend-origin override) but is a
 * distinct knob: `apiBase` is where enriched API calls go; this is where raw
 * chain RPC goes. Served from IPFS with a user's own RPC set, raw reads need no
 * valve backend at all.
 *
 * An RPC URL keeps its **full path + query** (provider keys live there, e.g.
 * `…/v2/<KEY>`), so we validate the protocol but preserve the rest verbatim.
 */

/** Per-chain localStorage key, e.g. `explore:rpcUrl:369`. */
export function rpcOverrideKey(chainId: number): string {
  return `explore:rpcUrl:${chainId}`;
}

/**
 * Accept only http(s) URLs; preserve path + query (provider keys live there).
 * Returns the normalized URL string, or null for anything non-http(s) or
 * unparseable — so a `javascript:`/garbage value can never become an endpoint.
 */
export function sanitizeRpcUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  return url.toString();
}

/** The user's RPC override for a chain (sanitized), or null when unset/invalid. */
export function getRpcOverride(chainId: number): string | null {
  if (typeof localStorage === "undefined") return null;
  return sanitizeRpcUrl(localStorage.getItem(rpcOverrideKey(chainId)));
}

/**
 * Persist an RPC override for a chain. Returns the normalized URL stored, or
 * null when the input is rejected (nothing is written for invalid input).
 * Takes effect on the next read — endpoints are resolved per call.
 */
export function setRpcOverride(chainId: number, value: string): string | null {
  const url = sanitizeRpcUrl(value);
  if (!url) return null;
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(rpcOverrideKey(chainId), url);
  }
  return url;
}

/** Remove a chain's RPC override; raw reads for it then fall back to the
 *  backend REST endpoints (no direct node calls). */
export function clearRpcOverride(chainId: number): void {
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem(rpcOverrideKey(chainId));
  }
}

/**
 * The endpoint a raw JSON-RPC read for `chainId` should POST to: the user's
 * per-chain override (their node, used verbatim), or `null` when none is set —
 * there is no shared proxy, so callers must gate on a present override (see
 * `isRpcOverridden`) and otherwise use the backend's REST endpoints.
 */
export function resolveRpcUrl(chainId: number): string | null {
  return getRpcOverride(chainId);
}

/** True when reads for this chain are pointed at a user-supplied endpoint. */
export function isRpcOverridden(chainId: number): boolean {
  return getRpcOverride(chainId) !== null;
}
