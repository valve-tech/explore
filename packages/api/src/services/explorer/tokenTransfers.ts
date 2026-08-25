import { erc20Abi, TransactionReceiptNotFoundError, type Hex } from "viem";
import { chainClient, currentChainId } from "../chains/context.js";
import {
  decodeTransferLogs,
  toTransferView,
  type TokenMeta,
  type TokenTransferView,
} from "./tokenTransfers/transforms.js";

export type TokenTransfer = TokenTransferView;

export interface TokenTransfersResult {
  transfers: TokenTransfer[];
  /**
   * False when the receipt read failed for a reason other than "no receipt".
   * An empty `transfers` is only a fact about the chain when this is true.
   */
  available: boolean;
}

/**
 * True when a failed receipt read means "this transaction has no receipt
 * yet", not "the node did not answer".
 *
 * Both end in a throw from `getTransactionReceipt`, and downstream the two
 * look identical — either way we hold no logs to decode. viem separates them
 * at the source: it raises `TransactionReceiptNotFoundError` when the node
 * replied normally with a null receipt (a pending or unknown hash — a real,
 * honest "no transfers"), and raises a transport or RPC error for everything
 * else (timeout, 5xx, connection refused — an outage that must not read as a
 * fact).
 *
 * The name check is a belt-and-braces fallback: viem re-exports its error
 * classes per entry point, so an `instanceof` can miss across a duplicated
 * copy of the package in the tree.
 */
export function isReceiptMissing(err: unknown): boolean {
  return (
    err instanceof TransactionReceiptNotFoundError ||
    (err instanceof Error && err.name === "TransactionReceiptNotFoundError")
  );
}

/**
 * Token transfers emitted by a transaction, decoded straight from the
 * receipt's logs (ERC-20/721/1155 standard events) — no third-party
 * explorer involved. Token name/symbol/decimals are read once per
 * (chainId, token) via RPC and memoized for the process lifetime; a token
 * whose metadata reads fail renders with empty strings rather than
 * dropping the transfer.
 *
 * Reports `available: false` when the node did not answer, so the caller
 * never presents an RPC outage as "this transaction moved no tokens".
 */
export async function getTokenTransfers(
  hash: string,
): Promise<TokenTransfersResult> {
  let logs;
  try {
    const receipt = await chainClient().getTransactionReceipt({
      hash: hash as Hex,
    });
    logs = receipt.logs;
  } catch (err) {
    // Pending or unknown tx — no receipt, no transfers. Anything else is the
    // node failing to answer, and an empty list would be a lie.
    return { transfers: [], available: isReceiptMissing(err) };
  }

  const raw = decodeTransferLogs(
    logs.map((l) => ({ address: l.address, topics: l.topics, data: l.data })),
    hash,
  );
  if (raw.length === 0) return { transfers: [], available: true };

  const tokens = [...new Set(raw.map((t) => t.contractAddress))];
  const metas = new Map<string, TokenMeta | null>();
  await Promise.all(
    tokens.map(async (token) => {
      metas.set(token, await getTokenMeta(token));
    }),
  );

  return {
    transfers: raw.map((t) =>
      toTransferView(t, metas.get(t.contractAddress) ?? null),
    ),
    available: true,
  };
}

// ---------------------------------------------------------------------------
// Token metadata — one read per (chainId, token), memoized. Failed reads are
// NOT cached so a transient RPC hiccup self-heals on the next transfer
// instead of pinning empty metadata (the in-memory cousin of the
// idb-cache-poisoning failure mode).
// ---------------------------------------------------------------------------

const metaCache = new Map<string, TokenMeta>();

async function getTokenMeta(token: string): Promise<TokenMeta | null> {
  const key = `${currentChainId()}:${token}`;
  const cached = metaCache.get(key);
  if (cached) return cached;

  const client = chainClient();
  const address = token as Hex;
  const [name, symbol, decimals] = await Promise.all([
    client.readContract({ address, abi: erc20Abi, functionName: "name" }).catch(() => null),
    client.readContract({ address, abi: erc20Abi, functionName: "symbol" }).catch(() => null),
    client.readContract({ address, abi: erc20Abi, functionName: "decimals" }).catch(() => null),
  ]);

  if (name === null && symbol === null && decimals === null) return null;

  const meta: TokenMeta = {
    name: name ?? "",
    symbol: symbol ?? "",
    decimals: decimals === null ? "" : String(decimals),
  };
  metaCache.set(key, meta);
  return meta;
}
