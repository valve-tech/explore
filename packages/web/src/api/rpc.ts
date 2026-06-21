import { DEFAULT_CHAIN_ID } from "../lib/chains";
import { resolveRpcUrl } from "../lib/rpcEndpoint";

// ---------------------------------------------------------------------------
// Raw JSON-RPC reads — BRING-YOUR-OWN-RPC only.
//
// There is no shared JSON-RPC proxy (it was removed). `sendRpcRequest` posts to
// the user's per-chain RPC override (their own node). The explorer's raw read
// paths call it ONLY when `isRpcOverridden(chainId)` is true; with no override
// the app uses the backend's REST/dispatcher endpoints and never touches a node.
// ---------------------------------------------------------------------------

export interface JsonRpcRequest {
  jsonrpc: string;
  id: number | string | null;
  method: string;
  params?: unknown[];
}

export interface JsonRpcResponse {
  jsonrpc: string;
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/**
 * Send a raw JSON-RPC request to the user's per-chain RPC override. Throws if no
 * override is configured for the chain — there is no fallback proxy, so callers
 * must check `isRpcOverridden` first (the explorer's BYO-RPC read paths do).
 */
export async function sendRpcRequest(
  request: JsonRpcRequest | JsonRpcRequest[],
  chainId: number = DEFAULT_CHAIN_ID,
): Promise<JsonRpcResponse | JsonRpcResponse[]> {
  const endpoint = resolveRpcUrl(chainId);
  if (!endpoint) {
    throw new Error(
      `No RPC endpoint for chain ${chainId}. Set a per-chain RPC URL in Settings to read directly from a node.`,
    );
  }
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!res.ok) throw new Error(`RPC request failed: ${res.statusText}`);
  return res.json();
}
