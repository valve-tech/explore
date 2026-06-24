/**
 * Bring-your-own-RPC ERC-20/721 metadata: when a per-chain RPC override is set,
 * read decimals/symbol/name straight from the user's node via `eth_call` instead
 * of our backend's `/token/:addr/meta` endpoint — so the reads run on their
 * infrastructure. Same `TokenMetaInfo` shape, same ABI as the backend, so a
 * token that the backend can decode this client path decodes identically (and a
 * bytes32-symbol token that the backend's typed read can't decode fails here the
 * same way — `null`, never a throw that blocks a watch notification).
 *
 * Gated behind `isRpcOverridden` at the call site (see `watcher/tokenMeta.ts`),
 * so this never touches a shared proxy (there isn't one).
 */

import { encodeFunctionData, decodeFunctionResult, parseAbi } from "viem";
import { sendRpcRequest, type JsonRpcResponse } from "../api/rpc";
import type { TokenMetaInfo } from "../api/explorer";

const ERC20_META_ABI = parseAbi([
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function name() view returns (string)",
]);

/** One `eth_call` for a zero-arg metadata getter; null on any error/empty/odd
 *  return so a single bad getter never sinks the others. */
async function call(
  token: string,
  fn: "decimals" | "symbol" | "name",
  chainId: number,
): Promise<unknown | null> {
  try {
    const data = encodeFunctionData({ abi: ERC20_META_ABI, functionName: fn });
    const resp = (await sendRpcRequest(
      { jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: token, data }, "latest"] },
      chainId,
    )) as JsonRpcResponse;
    if (resp.error) return null;
    const result = resp.result as string | undefined;
    if (!result || result === "0x") return null;
    return decodeFunctionResult({
      abi: ERC20_META_ABI,
      functionName: fn,
      data: result as `0x${string}`,
    });
  } catch {
    return null;
  }
}

/** decimals/symbol/name from the user's node — mirrors the backend endpoint's
 *  shape so the watcher's token-meta cache is transport-agnostic. */
export async function fetchTokenMetaViaRpc(
  token: string,
  chainId: number,
): Promise<TokenMetaInfo> {
  const [d, s, n] = await Promise.all([
    call(token, "decimals", chainId),
    call(token, "symbol", chainId),
    call(token, "name", chainId),
  ]);
  return {
    address: token,
    decimals: d === null ? null : Number(d),
    symbol: (s as string) || null,
    name: (n as string) || null,
  };
}
