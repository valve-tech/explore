/**
 * Bring-your-own-RPC address activity: when a per-chain RPC override is set, the
 * activity watcher scans recent blocks straight from the user's node instead of
 * polling our `/address/:addr/txs` endpoint — so the reads run on their infra.
 *
 * Native-value sends have no log to filter on (unlike ERC-20 transfers, which we
 * pull with `eth_getLogs`), so a block scan is the only honest client-side
 * option. That has two consequences we own openly:
 *   - It sees TOP-LEVEL transactions only. Value moved by an internal call /
 *     contract is invisible without a trace — the same limitation the matcher
 *     already has (it only inspects top-level txs).
 *   - It costs one `eth_getBlockByNumber` (full tx bodies) per scanned block,
 *     per poll. We keep the window small and let the watcher dedupe overlap.
 *
 * Gated behind `isRpcOverridden` at the call site (`watcher/engine.ts`).
 */

import { hexToBigInt } from "viem";
import { sendRpcRequest, type JsonRpcResponse } from "../../api/rpc";
import type { AddressTransaction } from "../../api/explorer";

/**
 * How many recent blocks each poll scans. At ~10–12s/block this covers ~2–2.5
 * minutes — comfortably longer than the 15s watch poll, so overlapping scans
 * never skip a block even if a poll is slow or fails; the watcher dedupes the
 * overlap by tx hash. Kept small because each block is a full-body fetch.
 */
const SCAN_BLOCKS = 12;

/** The fields the activity matcher consumes — a structural subset of the
 *  backend's `AddressTransaction`, so both transports feed the same map. */
export type WatchActivityTx = Pick<
  AddressTransaction,
  "hash" | "from" | "to" | "value" | "blockNumber"
>;

interface RpcBlockTx {
  hash: string;
  from: string;
  to: string | null;
  value: string;
}

interface RpcBlock {
  number: string;
  transactions: RpcBlockTx[];
}

/** Hex → decimal string, matching the `AddressTransaction` contract (where
 *  `value`/`blockNumber` are decimal strings). Tolerant of a malformed field. */
function toDec(hex: string | undefined): string {
  try {
    return hex ? hexToBigInt(hex as `0x${string}`).toString() : "0";
  } catch {
    return "0";
  }
}

/**
 * Scan the last `SCAN_BLOCKS` blocks on the user's node and return the top-level
 * transactions that touch `address` (as sender or recipient). The matcher
 * re-applies the rule's direction / min-value filters; we pre-filter to the
 * address here only so the watcher's seen-set tracks relevant txs, not the whole
 * chain.
 */
export async function fetchAddressActivityViaRpc(
  address: string,
  chainId: number,
): Promise<WatchActivityTx[]> {
  const headRes = (await sendRpcRequest(
    { jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] },
    chainId,
  )) as JsonRpcResponse;
  if (headRes.error) throw new Error(headRes.error.message);
  const head = Number(BigInt(headRes.result as string));
  const first = Math.max(0, head - SCAN_BLOCKS + 1);

  const numbers: number[] = [];
  for (let n = first; n <= head; n++) numbers.push(n);

  const blocks = (await Promise.all(
    numbers.map((n) =>
      sendRpcRequest(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "eth_getBlockByNumber",
          params: ["0x" + n.toString(16), true],
        },
        chainId,
      ),
    ),
  )) as JsonRpcResponse[];

  const want = address.toLowerCase();
  const out: WatchActivityTx[] = [];
  for (const res of blocks) {
    if (res.error || !res.result) continue; // a single missing block doesn't sink the scan
    const block = res.result as RpcBlock;
    const blockNumber = toDec(block.number);
    for (const tx of block.transactions ?? []) {
      const from = tx.from?.toLowerCase();
      const to = tx.to?.toLowerCase() ?? null;
      if (from !== want && to !== want) continue;
      out.push({
        hash: tx.hash,
        from: tx.from,
        to: tx.to ?? "", // "" = contract creation, matching the Etherscan shape
        value: toDec(tx.value),
        blockNumber,
      });
    }
  }
  return out;
}
