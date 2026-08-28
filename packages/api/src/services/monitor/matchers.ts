import {
  type Address,
  formatEther,
  keccak256,
  toHex,
  type Log,
  type PublicClient,
} from "viem";
import { getChain } from "../chains/registry.js";
import { type MatchData } from "../notifier.js";
import type { AlertConditions, BlockTransaction } from "./types.js";
import {
  isCheckUnhealthy,
  recordCheckFailure,
  recordCheckSuccess,
} from "./health.js";

/**
 * Five matchers, one per alert type. Each returns `MatchData` (which the
 * dispatcher uses to fire notifications + WebSocket broadcasts) or `null`
 * when the alert's conditions don't apply to the current block. Matchers
 * are pure where possible — only `matchBalanceThreshold` and
 * `matchFailedTx` need extra RPC calls; those two take the watched
 * chain's client (injected by processBlock) so every read hits the
 * chain the alert belongs to.
 */

export function matchAddressActivity(
  conditions: AlertConditions,
  txs: BlockTransaction[],
  blockNumber: bigint,
): MatchData | null {
  const addr = conditions.address?.toLowerCase();
  if (!addr) return null;

  const tx = txs.find((t) => t.from === addr || t.to === addr);
  if (!tx) return null;

  return {
    type: "address_activity",
    txHash: tx.hash,
    blockNumber: Number(blockNumber),
    from: tx.from,
    to: tx.to ?? undefined,
    value: formatEther(tx.value),
    summary: `Address ${addr} was involved in tx ${tx.hash}`,
  };
}

export function matchContractEvent(
  conditions: AlertConditions,
  logs: Log[],
  blockNumber: bigint,
): MatchData | null {
  const contractAddr = conditions.contractAddress?.toLowerCase();
  const eventSig = conditions.eventSignature;
  if (!contractAddr || !eventSig) return null;

  const topic0 = keccak256(toHex(eventSig));

  const log = logs.find(
    (l) =>
      l.address.toLowerCase() === contractAddr &&
      l.topics[0]?.toLowerCase() === topic0.toLowerCase(),
  );
  if (!log) return null;

  return {
    type: "contract_event",
    txHash: log.transactionHash ?? undefined,
    blockNumber: Number(blockNumber),
    eventSignature: eventSig,
    summary: `Event ${eventSig} emitted by ${contractAddr} in block ${blockNumber}`,
  };
}

export function matchFunctionCall(
  conditions: AlertConditions,
  txs: BlockTransaction[],
  blockNumber: bigint,
): MatchData | null {
  const contractAddr = conditions.contractAddress?.toLowerCase();
  const selector = conditions.functionSelector?.toLowerCase();
  if (!contractAddr || !selector) return null;

  const normalizedSelector = selector.startsWith("0x")
    ? selector
    : `0x${selector}`;

  const tx = txs.find(
    (t) =>
      t.to === contractAddr &&
      t.input.toLowerCase().startsWith(normalizedSelector),
  );
  if (!tx) return null;

  return {
    type: "function_call",
    txHash: tx.hash,
    blockNumber: Number(blockNumber),
    from: tx.from,
    to: tx.to ?? undefined,
    functionSelector: normalizedSelector,
    summary: `Function ${normalizedSelector} called on ${contractAddr} in tx ${tx.hash}`,
  };
}

export async function matchBalanceThreshold(
  conditions: AlertConditions,
  blockNumber: bigint,
  client: PublicClient,
  chainId: number,
): Promise<MatchData | null> {
  const addr = conditions.address;
  const threshold = conditions.threshold;
  const direction = conditions.direction;
  if (!addr || !threshold || !direction) return null;

  const symbol = getChain(chainId).nativeSymbol;

  try {
    const balance = await client.getBalance({
      address: addr as Address,
      blockNumber,
    });

    const thresholdWei = BigInt(Math.floor(parseFloat(threshold) * 1e18));
    const triggered =
      direction === "above"
        ? balance > thresholdWei
        : balance < thresholdWei;

    // The check COMPLETED, whether or not it matched. That is the distinction
    // the health channel exists to keep: "checked, no match" is healthy.
    recordCheckSuccess("balance_threshold", addr);

    if (!triggered) return null;

    return {
      type: "balance_threshold",
      blockNumber: Number(blockNumber),
      balance: formatEther(balance),
      threshold,
      direction,
      summary: `Address ${addr} balance is ${formatEther(balance)} ${symbol}, which is ${direction} threshold of ${threshold} ${symbol}`,
    };
  } catch (err) {
    // Still returns null — every caller depends on that — but the failure is
    // now recorded, so an alert that has stopped working stops looking
    // identical to one whose threshold was never crossed.
    recordCheckFailure("balance_threshold", addr, err);
    if (isCheckUnhealthy("balance_threshold", addr)) {
      console.error(
        `[monitor] balance check for ${addr} has failed repeatedly — this alert is NOT firing`,
        err,
      );
    } else {
      console.warn(`[monitor] balance check failed for ${addr}:`, err);
    }
    return null;
  }
}

export async function matchFailedTx(
  conditions: AlertConditions,
  txs: BlockTransaction[],
  blockNumber: bigint,
  client: PublicClient,
): Promise<MatchData | null> {
  const addr = conditions.address?.toLowerCase();
  if (!addr) return null;

  const relatedTxs = txs.filter((t) => t.from === addr || t.to === addr);
  if (relatedTxs.length === 0) return null;

  for (const tx of relatedTxs) {
    try {
      const receipt = await client.getTransactionReceipt({
        hash: tx.hash as `0x${string}`,
      });

      if (receipt.status === "reverted") {
        return {
          type: "failed_tx",
          txHash: tx.hash,
          blockNumber: Number(blockNumber),
          from: tx.from,
          to: tx.to ?? undefined,
          summary: `Failed transaction ${tx.hash} involving ${addr} in block ${blockNumber}`,
        };
      }
    } catch (err) {
      console.warn(`[monitor] receipt fetch failed for ${tx.hash}:`, err);
    }
  }

  return null;
}
