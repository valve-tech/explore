/**
 * Watch engine helpers — fetch a rule's recent on-chain activity from the
 * backend REST endpoints, normalize it into the pure matchers' minimal shapes,
 * and run the matchers. NO viem, no raw RPC: the browser polls purpose-built
 * endpoints (the open /rpc proxy is gone). The polling + new-vs-seen diffing
 * lives in the `RuleWatcher` component; this file stays a bag of functions.
 *
 * Errors propagate to the caller's query, where the global retry policy backs
 * off instead of hammering — a slow/rate-limited upstream must never spin.
 */

import {
  fetchAddressTransactions,
  fetchTokenTransfers,
} from "../../api/explorer";
import { getTokenMeta } from "./tokenMeta.js";
import {
  matchAddressActivity,
  matchErc20Transfer,
  type MinimalTransferLog,
  type MinimalTx,
} from "./matchers.js";
import type { WatchMatchContent, WatchRule } from "./types.js";
import { isRuleActionable } from "./rules.js";

/** A fetched, matchable item with a stable identity for new-vs-seen diffing. */
export interface RuleItem {
  /** Unique within a rule: tx hash, or `${txHash}:${logIndex}` for a log. */
  key: string;
  /** Matches this item produced for the rule (empty = didn't fire). */
  contents: WatchMatchContent[];
}

function safeBigInt(v: string): bigint {
  try {
    return BigInt(v);
  } catch {
    return 0n;
  }
}

function safeBlock(v: string): bigint | null {
  try {
    return BigInt(v);
  } catch {
    return null;
  }
}

/**
 * Poll one rule's recent activity from REST and return per-item matches, each
 * tagged with a dedupe key so the caller emits only newly-seen ones. A rule
 * that isn't actionable yet yields nothing.
 */
export async function fetchRuleItems(rule: WatchRule): Promise<RuleItem[]> {
  if (!isRuleActionable(rule)) return [];

  if (rule.kind === "address_activity") {
    const { transactions } = await fetchAddressTransactions(
      rule.address!,
      1,
      25,
      rule.chainId,
    );
    return transactions.map((t) => {
      const tx: MinimalTx = {
        hash: t.hash,
        from: t.from,
        to: t.to || null,
        value: safeBigInt(t.value),
      };
      return {
        key: t.hash,
        contents: matchAddressActivity([tx], rule, safeBlock(t.blockNumber)),
      };
    });
  }

  // erc20_transfer — token meta (decimals/symbol) and the transfer window load
  // in parallel; a missing/slow meta read just renders raw base units.
  const token = rule.contractAddress!;
  const [meta, window] = await Promise.all([
    getTokenMeta(rule.chainId, token),
    fetchTokenTransfers(token, "24h", rule.chainId),
  ]);
  return window.records
    .filter((r) => r.variant === "erc20")
    .map((r) => {
      const log: MinimalTransferLog = {
        transactionHash: r.txHash,
        blockNumber: safeBlock(String(r.blockNumber)),
        from: r.from,
        to: r.to,
        value: safeBigInt(r.value),
      };
      const content = matchErc20Transfer(log, rule, meta);
      return { key: `${r.txHash}:${r.logIndex}`, contents: content ? [content] : [] };
    });
}

/**
 * A stable string identity for a rule's subscription. Two rules with the same
 * signature watch identically, so the engine skips re-subscribing on unrelated
 * changes. Includes every field that affects what's watched (NOT `label`/`id`
 * display fields — well, `id` is included so distinct rules stay distinct).
 */
export function ruleSignature(rule: WatchRule): string {
  return [
    rule.id,
    rule.chainId,
    rule.kind,
    rule.enabled ? "1" : "0",
    rule.address ?? "",
    rule.direction ?? "",
    rule.minValueWei ?? "",
    rule.contractAddress ?? "",
    rule.counterparty ?? "",
  ].join("|");
}
