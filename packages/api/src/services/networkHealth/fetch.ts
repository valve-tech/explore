/**
 * Network-health analysis — RPC adapter.
 *
 * Pulls one block's header + receipts and folds them into BlockMetrics via the
 * pure `computeBlock`. Header gives baseFee/timestamp/gasUsed; receipts give
 * per-tx gasUsed/effectiveGasPrice/type/index — everything the analysis needs
 * in two RPC calls. `eth_getBlockReceipts` is supported by reth (the valve
 * fleet) and geth-family nodes.
 */

import { hexToBigInt, numberToHex, type PublicClient } from "viem";
import { computeBlock } from "./compute.js";
import { type BlockInput, type BlockMetrics, type TxInput } from "./types.js";

/** Minimal shape of a raw `eth_getBlockReceipts` entry (hex-encoded). */
interface RpcReceipt {
  transactionIndex?: string;
  type?: string;
  from?: string;
  gasUsed?: string;
  effectiveGasPrice?: string;
}

/** EIP-2718 type label → numeric category (viem receipts use the labels). */
const TYPE_LABELS: Record<string, number> = {
  legacy: 0,
  eip2930: 1,
  eip1559: 2,
  eip4844: 3,
  eip7702: 4,
};

export function numericType(t: unknown): number {
  if (typeof t === "number") return t;
  if (typeof t === "bigint") return Number(t);
  if (typeof t === "string") {
    if (t in TYPE_LABELS) return TYPE_LABELS[t]!;
    if (t.startsWith("0x")) return Number(BigInt(t));
    const n = Number(t);
    if (Number.isFinite(n)) return n;
  }
  // Unknown / future type — treat as modern (≥2) so it isn't miscounted as legacy.
  return 2;
}

/** Thrown when the chain's RPC doesn't implement eth_getBlockReceipts. */
export class ReceiptsUnsupportedError extends Error {
  constructor() {
    super("eth_getBlockReceipts is not supported by this chain's RPC endpoint");
    this.name = "ReceiptsUnsupportedError";
  }
}

/** Thrown when the RPC endpoint rate-limits the window warm (e.g. a demo key). */
export class RateLimitedError extends Error {
  constructor() {
    super(
      "RPC rate-limited while loading blocks — set a dedicated RPC URL for this chain",
    );
    this.name = "RateLimitedError";
  }
}

function isRateLimited(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return msg.includes("429") || msg.includes("too many requests");
}

function isMethodUnsupported(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes("method not found") ||
    msg.includes("does not exist") ||
    msg.includes("not supported") ||
    msg.includes("unsupported method") ||
    msg.includes("not available")
  );
}

/** Fetch one block's header + receipts and normalize to a BlockInput. */
export async function fetchBlockInput(
  client: PublicClient,
  blockNumber: bigint,
): Promise<BlockInput> {
  // viem 2.47 has no high-level getBlockReceipts action — call the raw method.
  // (Receipts carry per-tx gasUsed/effectiveGasPrice/type/index; the header
  // carries baseFee/timestamp/gasUsed.)
  const rpc = client.request as (args: {
    method: "eth_getBlockReceipts";
    params: [string];
  }) => Promise<RpcReceipt[] | null>;

  let header;
  let receipts;
  try {
    [header, receipts] = await Promise.all([
      client.getBlock({ blockNumber, includeTransactions: false }),
      rpc({ method: "eth_getBlockReceipts", params: [numberToHex(blockNumber)] }),
    ]);
  } catch (err) {
    if (isMethodUnsupported(err)) throw new ReceiptsUnsupportedError();
    if (isRateLimited(err)) throw new RateLimitedError();
    throw err;
  }

  const txs: TxInput[] = (receipts ?? []).map((r) => ({
    transactionIndex: r.transactionIndex ? Number(BigInt(r.transactionIndex)) : 0,
    type: numericType(r.type),
    from: (r.from ?? "").toLowerCase(),
    gasUsed: r.gasUsed ? hexToBigInt(r.gasUsed as `0x${string}`) : 0n,
    effectiveGasPrice: r.effectiveGasPrice
      ? hexToBigInt(r.effectiveGasPrice as `0x${string}`)
      : 0n,
  }));

  return {
    number: header.number ?? blockNumber,
    timestamp: Number(header.timestamp),
    baseFeePerGas: header.baseFeePerGas ?? 0n,
    gasUsed: header.gasUsed ?? 0n,
    gasLimit: header.gasLimit ?? 0n,
    miner: header.miner ?? "",
    txs,
  };
}

/**
 * Fetch one block's FULL transactions + receipts for the on-demand ladder.
 * Like `fetchBlockInput` but also carries per-tx display fields (hash, to,
 * value, methodId) sourced from the full transaction objects. Kept separate so
 * the window warm (`fetchBlockInput`) stays lean — header + receipts only.
 */
export async function fetchBlockLadderInput(
  client: PublicClient,
  blockNumber: bigint,
): Promise<BlockInput> {
  const rpc = client.request as (args: {
    method: "eth_getBlockReceipts";
    params: [string];
  }) => Promise<RpcReceipt[] | null>;

  let block;
  let receipts;
  try {
    [block, receipts] = await Promise.all([
      client.getBlock({ blockNumber, includeTransactions: true }),
      rpc({ method: "eth_getBlockReceipts", params: [numberToHex(blockNumber)] }),
    ]);
  } catch (err) {
    if (isMethodUnsupported(err)) throw new ReceiptsUnsupportedError();
    if (isRateLimited(err)) throw new RateLimitedError();
    throw err;
  }

  // Index full txs by transactionIndex for merge with receipts.
  const txByIndex = new Map<number, (typeof block.transactions)[number]>();
  for (const t of block.transactions) {
    if (typeof t === "string") continue;
    txByIndex.set(t.transactionIndex ?? 0, t);
  }

  const txs: TxInput[] = (receipts ?? []).map((r) => {
    const idx = r.transactionIndex ? Number(BigInt(r.transactionIndex)) : 0;
    const tx = txByIndex.get(idx);
    const input = tx?.input ?? "0x";
    return {
      transactionIndex: idx,
      type: numericType(r.type),
      from: (r.from ?? "").toLowerCase(),
      gasUsed: r.gasUsed ? hexToBigInt(r.gasUsed as `0x${string}`) : 0n,
      effectiveGasPrice: r.effectiveGasPrice
        ? hexToBigInt(r.effectiveGasPrice as `0x${string}`)
        : 0n,
      hash: tx?.hash ?? "",
      to: tx?.to ?? null,
      value: tx?.value ?? 0n,
      methodId: input.length >= 10 ? input.slice(0, 10) : "",
    };
  });

  return {
    number: block.number ?? blockNumber,
    timestamp: Number(block.timestamp),
    baseFeePerGas: block.baseFeePerGas ?? 0n,
    gasUsed: block.gasUsed ?? 0n,
    gasLimit: block.gasLimit ?? 0n,
    miner: block.miner ?? "",
    txs,
  };
}

export async function fetchBlockMetrics(
  client: PublicClient,
  blockNumber: bigint,
  burnsBaseFee: boolean,
): Promise<BlockMetrics> {
  return computeBlock(await fetchBlockInput(client, blockNumber), {
    burnsBaseFee,
  });
}
