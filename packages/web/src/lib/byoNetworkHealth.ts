/**
 * Bring-your-own-RPC network health: when a per-chain RPC override is set, the
 * fee-priority analysis is computed entirely in the browser from the user's own
 * node instead of our backend's cached window — so the (heavy) block + receipt
 * reads run on their infrastructure.
 *
 * The ANALYSIS is the API's pure compute, imported verbatim via the
 * `@networkHealth` alias (single source of truth, no drift). This module is only
 * the RPC adapter: it pulls each block's header + `eth_getBlockReceipts`,
 * normalizes them into the pure `BlockInput` shape, runs `computeBlock`, then the
 * same aggregators the backend uses — producing byte-identical wire shapes.
 *
 * Two deliberate constraints, surfaced honestly:
 *   - `eth_getBlockReceipts` is required (one call/block vs an N+1 receipt
 *     fan-out). A node that doesn't implement it gets a clear message, not a
 *     silent hammering of per-tx receipt calls.
 *   - A 512-block window is 512×2 RPC calls; they run throttled (CONCURRENCY)
 *     rather than all at once, so one node isn't flooded.
 */

import {
  aggregateMiners,
  aggregateWindow,
  computeBlock,
  computeLadder,
  serializeBlock,
} from "@networkHealth/compute";
import type { BlockInput, TxInput } from "@networkHealth/types";
import { sendRpcRequest, type JsonRpcResponse } from "../api/rpc";
import type { BlockLadder, NetworkHealthResult } from "../api/networkHealth";

/** Parallel block fetches in flight against the user's node — bounded so a wide
 *  window streams in rounds instead of firing every call at once. */
const CONCURRENCY = 8;

/** EIP-2718 type label → numeric category (some nodes return labels, not hex). */
const TYPE_LABELS: Record<string, number> = {
  legacy: 0,
  eip2930: 1,
  eip1559: 2,
  eip4844: 3,
  eip7702: 4,
};

function numericType(t: unknown): number {
  if (typeof t === "number") return t;
  if (typeof t === "string") {
    if (t in TYPE_LABELS) return TYPE_LABELS[t]!;
    if (t.startsWith("0x")) return Number(BigInt(t));
    const n = Number(t);
    if (Number.isFinite(n)) return n;
  }
  return 2; // unknown/future type → modern, never miscounted as legacy
}

function hexToBig(h: string | null | undefined): bigint {
  try {
    return h ? BigInt(h) : 0n;
  } catch {
    return 0n;
  }
}

function hexToInt(h: string | null | undefined): number {
  try {
    return h ? Number(BigInt(h)) : 0;
  } catch {
    return 0;
  }
}

interface RpcHeader {
  number?: string;
  timestamp?: string;
  baseFeePerGas?: string;
  gasUsed?: string;
  gasLimit?: string;
  miner?: string;
}

interface RpcFullTx {
  transactionIndex?: string;
  hash?: string;
  to?: string | null;
  value?: string;
  input?: string;
}

interface RpcHeaderWithTxs extends RpcHeader {
  transactions?: (RpcFullTx | string)[];
}

interface RpcReceipt {
  transactionIndex?: string;
  type?: string;
  from?: string;
  gasUsed?: string;
  effectiveGasPrice?: string;
}

/** Turn a node error message into a clear, actionable one (and never proceed). */
function rpcFailed(message: string): never {
  const m = message.toLowerCase();
  if (
    m.includes("method not found") ||
    m.includes("does not exist") ||
    m.includes("not supported") ||
    m.includes("unsupported method") ||
    m.includes("not available")
  ) {
    throw new Error(
      "Your node doesn't support eth_getBlockReceipts, which network health needs. " +
        "Point this chain at a reth/geth node that implements it, or clear the RPC override to use Explore's backend.",
    );
  }
  if (m.includes("429") || m.includes("too many requests")) {
    throw new Error(
      "Your RPC rate-limited the block fetch — try a smaller window or a node without rate limits.",
    );
  }
  throw new Error(message);
}

async function rpc(method: string, params: unknown[], chainId: number): Promise<unknown> {
  const resp = (await sendRpcRequest(
    { jsonrpc: "2.0", id: 1, method, params },
    chainId,
  )) as JsonRpcResponse;
  if (resp.error) rpcFailed(resp.error.message ?? "RPC error");
  return resp.result;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await fn(items[i]!);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  return out;
}

/** One block's header + receipts → the pure `BlockInput` (window warm: no full txs). */
async function fetchBlockInput(blockNumber: bigint, chainId: number): Promise<BlockInput> {
  const tag = "0x" + blockNumber.toString(16);
  const [header, receipts] = (await Promise.all([
    rpc("eth_getBlockByNumber", [tag, false], chainId),
    rpc("eth_getBlockReceipts", [tag], chainId),
  ])) as [RpcHeader, RpcReceipt[] | null];

  const txs: TxInput[] = (receipts ?? []).map((r) => ({
    transactionIndex: hexToInt(r.transactionIndex),
    type: numericType(r.type),
    from: (r.from ?? "").toLowerCase(),
    gasUsed: hexToBig(r.gasUsed),
    effectiveGasPrice: hexToBig(r.effectiveGasPrice),
  }));

  return {
    number: header.number ? hexToBig(header.number) : blockNumber,
    timestamp: hexToInt(header.timestamp),
    baseFeePerGas: hexToBig(header.baseFeePerGas),
    gasUsed: hexToBig(header.gasUsed),
    gasLimit: hexToBig(header.gasLimit),
    miner: header.miner ?? "",
    txs,
  };
}

/**
 * The latest `limit` blocks' health for `chainId`, computed from the user's node.
 * Same shape as the backend's `/api/network-health` response.
 */
export async function fetchNetworkHealthViaRpc(
  chainId: number,
  limit: number,
  burnsBaseFee: boolean,
): Promise<NetworkHealthResult> {
  const head = hexToBig((await rpc("eth_blockNumber", [], chainId)) as string);
  const from = head - BigInt(limit) + 1n;
  const first = from < 0n ? 0n : from;

  const nums: bigint[] = [];
  for (let n = first; n <= head; n += 1n) nums.push(n);

  const inputs = await mapWithConcurrency(nums, CONCURRENCY, (n) =>
    fetchBlockInput(n, chainId),
  );
  // The aggregators expect the window newest-first (see aggregateWindow).
  const window = inputs
    .map((b) => computeBlock(b, { burnsBaseFee }))
    .reverse();
  const oldest = window.length ? window[window.length - 1]!.number : null;

  return {
    chainId,
    burnsBaseFee,
    headBlock: head.toString(),
    // We always fetch ending at head, so more history exists unless we hit genesis.
    hasMore: oldest !== null && oldest > 0n,
    aggregate: aggregateWindow(window),
    miners: aggregateMiners(window),
    blocks: window.map(serializeBlock),
  };
}

/** One block's fee ladder, computed from the user's node (full txs + receipts). */
export async function fetchBlockLadderViaRpc(
  chainId: number,
  blockNumber: string,
  burnsBaseFee: boolean,
): Promise<BlockLadder> {
  const tag = "0x" + BigInt(blockNumber).toString(16);
  const [block, receipts] = (await Promise.all([
    rpc("eth_getBlockByNumber", [tag, true], chainId),
    rpc("eth_getBlockReceipts", [tag], chainId),
  ])) as [RpcHeaderWithTxs, RpcReceipt[] | null];

  const txByIndex = new Map<number, RpcFullTx>();
  for (const t of block.transactions ?? []) {
    if (typeof t === "string") continue;
    txByIndex.set(hexToInt(t.transactionIndex), t);
  }

  const txs: TxInput[] = (receipts ?? []).map((r) => {
    const idx = hexToInt(r.transactionIndex);
    const tx = txByIndex.get(idx);
    const input = tx?.input ?? "0x";
    return {
      transactionIndex: idx,
      type: numericType(r.type),
      from: (r.from ?? "").toLowerCase(),
      gasUsed: hexToBig(r.gasUsed),
      effectiveGasPrice: hexToBig(r.effectiveGasPrice),
      hash: tx?.hash ?? "",
      to: tx?.to ?? null,
      value: hexToBig(tx?.value),
      methodId: input.length >= 10 ? input.slice(0, 10) : "",
    };
  });

  const blockInput: BlockInput = {
    number: block.number ? hexToBig(block.number) : BigInt(blockNumber),
    timestamp: hexToInt(block.timestamp),
    baseFeePerGas: hexToBig(block.baseFeePerGas),
    gasUsed: hexToBig(block.gasUsed),
    gasLimit: hexToBig(block.gasLimit),
    miner: block.miner ?? "",
    txs,
  };

  return computeLadder(blockInput, { burnsBaseFee });
}
