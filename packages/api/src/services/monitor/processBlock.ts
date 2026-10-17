import { type Log } from "viem";
import { DEFAULT_CHAIN_ID } from "../chains/registry.js";
import { getRpcClient } from "../chains/clients.js";
import {
  getEnabledAlerts,
  recordAlertTrigger,
  type AlertRow,
} from "../db.js";
import { dispatch, type MatchData } from "../notifier.js";
import { broadcast } from "../wsServer.js";
import type { AlertConditions, BlockTransaction } from "./types.js";
import {
  matchAddressActivity,
  matchBalanceThreshold,
  matchContractEvent,
  matchFailedTx,
  matchFunctionCall,
} from "./matchers.js";

/**
 * Per-alert cooldown tracking. Keyed by alert.id → epoch ms of the last
 * trigger. Module-level state so it survives across polls (which is what
 * lets `cooldown_seconds` actually do its job). An alert belongs to a
 * single chain, so the key needs no chain dimension.
 */
const cooldownMap = new Map<number, number>();

/**
 * Fetch a block + its logs from `chainId`'s RPC, normalize the
 * transactions, and run every enabled alert FOR THAT CHAIN against the
 * data.
 *
 * The zero-watchers early return (no block fetch at all) is preserved from
 * the single-chain era — a chain with no enabled alerts costs no RPC calls.
 */
export async function processBlock(
  blockNumber: bigint,
  chainId: number = DEFAULT_CHAIN_ID,
): Promise<void> {
  const alerts = await getEnabledAlerts(chainId);
  if (alerts.length === 0) return;

  const client = getRpcClient(chainId);

  try {
    const block = await client.getBlock({
      blockNumber,
      includeTransactions: true,
    });

    const txs: BlockTransaction[] = (
      block.transactions as Array<{
        hash: string;
        from: string;
        to: string | null;
        value: bigint;
        input: string;
      }>
    ).map((tx) => ({
      hash: tx.hash,
      from: tx.from.toLowerCase(),
      to: tx.to?.toLowerCase() ?? null,
      value: tx.value,
      input: tx.input,
    }));

    let logs: Log[] = [];
    try {
      logs = await client.getLogs({
        fromBlock: blockNumber,
        toBlock: blockNumber,
      });
    } catch (err) {
      console.warn(
        `[monitor] chain ${chainId}: failed to fetch logs for block ${blockNumber}:`,
        err,
      );
    }

    await matchAlerts(alerts, txs, logs, blockNumber, chainId);
  } catch (err) {
    console.error(
      `[monitor] chain ${chainId}: error processing block ${blockNumber}:`,
      err,
    );
  }
}

/**
 * Walk every alert, dispatch to the appropriate matcher by type, honour
 * cooldowns, and on a match fan out: persist the trigger, send
 * notifications, broadcast to WebSocket subscribers.
 */
async function matchAlerts(
  alerts: AlertRow[],
  txs: BlockTransaction[],
  logs: Log[],
  blockNumber: bigint,
  chainId: number,
): Promise<void> {
  const client = getRpcClient(chainId);

  for (const alert of alerts) {
    const lastTrigger = cooldownMap.get(alert.id);
    if (
      lastTrigger &&
      Date.now() - lastTrigger < alert.cooldown_seconds * 1000
    ) {
      continue;
    }

    const conditions = alert.conditions as unknown as AlertConditions;

    let matchData: MatchData | null = null;

    try {
      switch (alert.type) {
        case "address_activity":
          matchData = matchAddressActivity(conditions, txs, blockNumber);
          break;
        case "contract_event":
          matchData = matchContractEvent(conditions, logs, blockNumber);
          break;
        case "function_call":
          matchData = matchFunctionCall(conditions, txs, blockNumber);
          break;
        case "balance_threshold":
          matchData = await matchBalanceThreshold(
            conditions,
            blockNumber,
            client,
            chainId,
          );
          break;
        case "failed_tx":
          matchData = await matchFailedTx(conditions, txs, blockNumber, client);
          break;
      }
    } catch (err) {
      console.error(`[monitor] error matching alert ${alert.id}:`, err);
    }

    if (matchData) {
      cooldownMap.set(alert.id, Date.now());
      await recordAlertTrigger({
        alert_id: alert.id,
        tx_hash: matchData.txHash ?? null,
        block_number: Number(blockNumber),
        matched_data: JSON.stringify(matchData),
      });
      dispatch(alert, matchData).catch((err) => {
        console.error(
          `[monitor] notification dispatch error for alert ${alert.id}:`,
          err,
        );
      });
      broadcast("alert_triggered", {
        alert: {
          id: alert.id,
          name: alert.name,
          type: alert.type,
          chainId: alert.chain_id,
        },
        match: matchData,
      });
    }
  }
}
