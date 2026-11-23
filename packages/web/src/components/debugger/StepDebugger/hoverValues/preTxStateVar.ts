import { scoped } from "../../../../api/chainScope";
import { apiUrl } from "../../../../lib/apiBase";
import type { SolIndex } from "../sourceNav/solIndex";
import type { StateVarRef } from "./resolveStateVar";
import { normalizeWord, slotKey } from "./slotWord";
import { formatSlotValue } from "./stateVarValue";
import type { FrameStorage } from "./storageContext";
import type { HoverValue } from "./types";

/**
 * Read one storage slot at the end of the block before `blockNumber`.
 *
 * This uses the Etherscan-shaped dispatcher that the API already serves:
 * GET /api?module=proxy&action=eth_getStorageAt&address=…&position=…&tag=….
 * It adds no route. Null when the node does not answer with a 32-byte word
 * (for example, a node without archive state).
 */
export async function fetchSlotBeforeBlock(
  address: string,
  slot: bigint,
  blockNumber: number,
  chainId: number,
  signal?: AbortSignal,
): Promise<string | null> {
  if (!Number.isInteger(blockNumber) || blockNumber < 1) return null;
  const tag = "0x" + (blockNumber - 1).toString(16);
  const url = apiUrl(
    `/api?module=proxy&action=eth_getStorageAt&address=${address}&position=${slotKey(slot)}&tag=${tag}`,
  );
  const res = await fetch(scoped(url, chainId), { signal });
  if (!res.ok) return null;
  const body = (await res.json()) as { result?: unknown; error?: unknown };
  if (body.error || typeof body.result !== "string" || body.result.length !== 66) return null;
  return normalizeWord(body.result);
}

export interface PreTxInput {
  ref: StateVarRef;
  /** The result of frameStorageAt() for the current step. */
  frameStorage: FrameStorage;
  chainId: number;
  /** Block that holds the transaction. */
  blockNumber: number;
  /** Position of the transaction in its block. Pass it when you know it. */
  txIndex?: number | null;
  index?: SolIndex;
  signal?: AbortSignal;
}

/**
 * The value of a state variable that the transaction has NOT touched yet.
 * It reads the slot from the chain, at the frame's storage address.
 *
 * It answers only when the trace proves that the slot is untouched at this
 * step. The read is at the end of the parent block. For a transaction that is
 * not first in its block, an earlier transaction of the same block can change
 * the slot, and the note says so.
 */
export async function preTxStateVarValue(input: PreTxInput): Promise<HoverValue | null> {
  const { ref, frameStorage: fs } = input;
  if (ref.kind !== "value" || fs.status !== "known" || slotKey(ref.slot) in fs.storage) return null;
  const word = await fetchSlotBeforeBlock(fs.address, ref.slot, input.blockNumber, input.chainId, input.signal);
  const value = word ? formatSlotValue(ref, word, input.index) : null;
  if (value === null) return null;
  const note = input.txIndex === 0
    ? "value before the transaction; the transaction has not touched this slot yet"
    : `approximate: value at the end of block ${input.blockNumber - 1}; an earlier transaction in block ${input.blockNumber} can change it`;
  return { name: ref.name, type: ref.typeLabel, value, source: "storage", note };
}
