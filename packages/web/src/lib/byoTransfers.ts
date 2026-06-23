/**
 * Bring-your-own-RPC token transfers: when the user has set a per-chain RPC
 * override, the token chart reads Transfer logs straight from THEIR node via
 * `eth_getLogs` instead of our chifra-backed endpoint — so heavy reads run on
 * their infrastructure. Gated behind `isRpcOverridden` at the call site, so this
 * never touches a shared proxy (there isn't one); `sendRpcRequest` posts to the
 * override URL. Returns the same `ChifraTransferWindow` shape as the backend.
 *
 * One bounded `eth_getLogs` over the window's block range — a self-hoster's node
 * handles it; a node that caps ranges will surface its error and the user can
 * narrow the window. The chart buckets by actual `blockNumber`, so the
 * day→block estimate below need only be approximate.
 */

import { sendRpcRequest, type JsonRpcResponse } from "../api/rpc";
import type {
  ChifraTransfer,
  ChifraTransferWindow,
  ChifraWindow,
} from "../api/explorer";

/** keccak256("Transfer(address,address,uint256)"). */
const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

const WINDOW_DAYS: Record<ChifraWindow, number> = { "24h": 1, "7d": 7, "30d": 30 };
/** Approx blocks/day per chain (ETH ~12s, PulseChain ~10s) — only sets the
 *  starting block; bucketing uses real block numbers. */
const BLOCKS_PER_DAY: Record<number, number> = { 1: 7150, 369: 8640, 943: 8640 };

interface RawLog {
  blockNumber: string;
  transactionHash: string;
  logIndex: string;
  topics: string[];
  data: string;
}

function toNum(hex: string | undefined): number {
  try {
    return hex ? Number(BigInt(hex)) : 0;
  } catch {
    return 0;
  }
}

/** A 32-byte indexed topic carries an address in its low 20 bytes. */
function topicToAddress(topic: string): string {
  return "0x" + topic.slice(-40);
}

function decode(log: RawLog): ChifraTransfer {
  const isErc721 = log.topics.length === 4;
  let value = "0";
  try {
    value = isErc721 ? "1" : log.data && log.data !== "0x" ? BigInt(log.data).toString() : "0";
  } catch {
    value = "0";
  }
  return {
    blockNumber: toNum(log.blockNumber),
    blockTimestamp: 0, // not available from a bare log; the chart doesn't use it
    txHash: log.transactionHash,
    logIndex: toNum(log.logIndex),
    from: log.topics[1] ? topicToAddress(log.topics[1]) : "",
    to: log.topics[2] ? topicToAddress(log.topics[2]) : "",
    value,
    variant: isErc721 ? "erc721" : "erc20",
    ...(isErc721 && log.topics[3] ? { tokenId: BigInt(log.topics[3]).toString() } : {}),
  };
}

export async function fetchTransfersViaRpc(
  token: string,
  window: ChifraWindow,
  chainId: number,
): Promise<ChifraTransferWindow> {
  const headRes = (await sendRpcRequest(
    { jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] },
    chainId,
  )) as JsonRpcResponse;
  if (headRes.error) throw new Error(headRes.error.message);
  const head = toNum(headRes.result as string);

  const bpd = BLOCKS_PER_DAY[chainId] ?? 8640;
  const from = Math.max(0, head - WINDOW_DAYS[window] * bpd);

  const logsRes = (await sendRpcRequest(
    {
      jsonrpc: "2.0",
      id: 1,
      method: "eth_getLogs",
      params: [
        {
          address: token,
          topics: [TRANSFER_TOPIC],
          fromBlock: "0x" + from.toString(16),
          toBlock: "0x" + head.toString(16),
        },
      ],
    },
    chainId,
  )) as JsonRpcResponse;
  if (logsRes.error) throw new Error(logsRes.error.message);

  const records = ((logsRes.result as RawLog[]) ?? []).map(decode);
  return { records, firstBlock: from, lastBlock: head, truncated: false };
}
