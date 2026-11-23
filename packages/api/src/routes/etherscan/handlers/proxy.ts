/**
 * Etherscan `proxy` module handlers.
 *
 * Unlike the rest of the Etherscan API surface, `module=proxy` is a thin
 * passthrough to standard Ethereum JSON-RPC. The HTTP request still uses
 * Etherscan's query-string shape (?module=proxy&action=eth_blockNumber&...)
 * but the response body is a raw JSON-RPC 2.0 envelope —
 * `{jsonrpc, id, result}` on success, `{jsonrpc, id, error}` on failure.
 * Tools like ethers.js's EtherscanProvider feed this straight into their
 * generic JSON-RPC decoder, so the shape is non-negotiable.
 *
 * Every action here boils down to: read params from the merged map,
 * forward to the per-chain RPC client's `request` (viem's raw transport
 * call), echo back the result. Using `request` rather than typed viem
 * helpers (e.g. `getBlockNumber`) keeps the wire format exactly what the
 * upstream node returns — typed helpers do hex→BigInt parsing that callers
 * don't expect.
 *
 * The client is resolved per request from the dispatcher-supplied
 * `ChainConfig` via `getRpcClient(chainId)`. When an action is called
 * directly without a chain (unit tests), it falls back to the registry
 * default (PulseChain 369), preserving the legacy single-chain behavior.
 */

import { getRpcClient } from "../../../services/chains/clients.js";
import { redactSecrets } from "../../../lib/redact.js";
import type { ChainConfig } from "../../../services/chains/registry.js";
import { defaultChain } from "../chain.js";
import {
  jsonRpcErr,
  jsonRpcOk,
  type JsonRpcResponse,
} from "../envelope.js";

type ProxyAction = (
  params: Record<string, unknown>,
  chain?: ChainConfig,
) => Promise<JsonRpcResponse>;

function readId(params: Record<string, unknown>): number {
  const raw = params.id;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw !== "") {
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return 1;
}

function str(params: Record<string, unknown>, key: string): string {
  const v = params[key];
  return typeof v === "string" ? v : "";
}

function optStr(
  params: Record<string, unknown>,
  key: string,
): string | undefined {
  const v = params[key];
  return typeof v === "string" && v !== "" ? v : undefined;
}

async function call<T>(
  params: Record<string, unknown>,
  chain: ChainConfig | undefined,
  method: string,
  rpcParams: unknown,
): Promise<JsonRpcResponse<T>> {
  const id = readId(params);
  const client = getRpcClient((chain ?? defaultChain()).chainId);
  try {
    // viem's request() expects a method-specific param tuple type. We're
    // intentionally bypassing that typing — this module is a passthrough,
    // and viem's `request` type doesn't cover every method we forward
    // (e.g. eth_sendRawTransaction's hex input). The unknown cast keeps
    // each individual handler readable while still letting TS check the
    // rest of the file.
    const result = (await client.request({
      method,
      params: rpcParams,
    } as never)) as T;
    return jsonRpcOk(result, id);
  } catch (err) {
    // viem's message carries the upstream URL, key included. This is public.
    const message = redactSecrets(err instanceof Error ? err.message : String(err));
    return jsonRpcErr(message, -32000, id);
  }
}

// ===========================================================================
// Block / transaction lookups
// ===========================================================================

export const ethBlockNumberAction: ProxyAction = (params, chain) =>
  call(params, chain, "eth_blockNumber", []);

export const ethGetBlockByNumberAction: ProxyAction = (params, chain) => {
  const tag = str(params, "tag") || "latest";
  const txDetails = str(params, "boolean") === "true";
  return call(params, chain, "eth_getBlockByNumber", [tag, txDetails]);
};

export const ethGetBlockByHashAction: ProxyAction = (params, chain) => {
  const hash = str(params, "hash");
  const txDetails = str(params, "boolean") === "true";
  return call(params, chain, "eth_getBlockByHash", [hash, txDetails]);
};

export const ethGetBlockTransactionCountByNumberAction: ProxyAction = (
  params,
  chain,
) => {
  const tag = str(params, "tag") || "latest";
  return call(params, chain, "eth_getBlockTransactionCountByNumber", [tag]);
};

export const ethGetTransactionByHashAction: ProxyAction = (params, chain) => {
  const txhash = str(params, "txhash");
  return call(params, chain, "eth_getTransactionByHash", [txhash]);
};

export const ethGetTransactionByBlockNumberAndIndexAction: ProxyAction = (
  params,
  chain,
) => {
  const tag = str(params, "tag") || "latest";
  const index = str(params, "index");
  return call(params, chain, "eth_getTransactionByBlockNumberAndIndex", [
    tag,
    index,
  ]);
};

export const ethGetTransactionCountAction: ProxyAction = (params, chain) => {
  const address = str(params, "address");
  const tag = str(params, "tag") || "latest";
  return call(params, chain, "eth_getTransactionCount", [address, tag]);
};

export const ethGetTransactionReceiptAction: ProxyAction = (params, chain) => {
  const txhash = str(params, "txhash");
  return call(params, chain, "eth_getTransactionReceipt", [txhash]);
};

// ===========================================================================
// State / contract reads
// ===========================================================================

export const ethCallAction: ProxyAction = (params, chain) => {
  const to = str(params, "to");
  const data = str(params, "data");
  const tag = str(params, "tag") || "latest";
  return call(params, chain, "eth_call", [{ to, data }, tag]);
};

export const ethGetCodeAction: ProxyAction = (params, chain) => {
  const address = str(params, "address");
  const tag = str(params, "tag") || "latest";
  return call(params, chain, "eth_getCode", [address, tag]);
};

export const ethGetStorageAtAction: ProxyAction = (params, chain) => {
  const address = str(params, "address");
  const position = str(params, "position");
  const tag = str(params, "tag") || "latest";
  return call(params, chain, "eth_getStorageAt", [address, position, tag]);
};

// ===========================================================================
// Gas / writes
// ===========================================================================

export const ethGasPriceAction: ProxyAction = (params, chain) =>
  call(params, chain, "eth_gasPrice", []);

export const ethEstimateGasAction: ProxyAction = (params, chain) => {
  // Strip undefined fields so the upstream node doesn't reject the call
  // with "missing field" errors for keys it considers required-when-present.
  const tx: Record<string, string> = {};
  const to = optStr(params, "to");
  const value = optStr(params, "value");
  const data = optStr(params, "data");
  const gasPrice = optStr(params, "gasPrice");
  const gas = optStr(params, "gas");
  if (to !== undefined) tx.to = to;
  if (value !== undefined) tx.value = value;
  if (data !== undefined) tx.data = data;
  if (gasPrice !== undefined) tx.gasPrice = gasPrice;
  if (gas !== undefined) tx.gas = gas;
  return call(params, chain, "eth_estimateGas", [tx]);
};

export const ethSendRawTransactionAction: ProxyAction = (params, chain) => {
  const hex = str(params, "hex");
  return call(params, chain, "eth_sendRawTransaction", [hex]);
};

// ===========================================================================
// Action table — keyed by Etherscan's `action` parameter.
// ===========================================================================

export const proxyActions: Record<string, ProxyAction> = {
  eth_blockNumber: ethBlockNumberAction,
  eth_getBlockByNumber: ethGetBlockByNumberAction,
  eth_getBlockByHash: ethGetBlockByHashAction,
  eth_getBlockTransactionCountByNumber:
    ethGetBlockTransactionCountByNumberAction,
  eth_getTransactionByHash: ethGetTransactionByHashAction,
  eth_getTransactionByBlockNumberAndIndex:
    ethGetTransactionByBlockNumberAndIndexAction,
  eth_getTransactionCount: ethGetTransactionCountAction,
  eth_getTransactionReceipt: ethGetTransactionReceiptAction,
  eth_call: ethCallAction,
  eth_getCode: ethGetCodeAction,
  eth_getStorageAt: ethGetStorageAtAction,
  eth_gasPrice: ethGasPriceAction,
  eth_estimateGas: ethEstimateGasAction,
  eth_sendRawTransaction: ethSendRawTransactionAction,
};
