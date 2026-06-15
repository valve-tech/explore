import { apiUrl } from "../lib/apiBase";
import { scoped } from "./chainScope";

/**
 * Network-health endpoint client. Mirrors the wire shapes from the API's
 * services/networkHealth/types.ts (BlockStatsWire / WindowAggregateWire). All
 * money fields are raw-wei strings — format at the render edge via
 * lib/format/tokenAmount.
 */

const API_BASE = apiUrl("/api/network-health");

export interface TypeSplit<T> {
  legacy: T;
  modern: T;
}

export interface BlockStats {
  number: string;
  timestamp: number;
  baseFeePerGas: string;
  gasUsed: string;
  gasLimit: string;
  txCount: number;
  legacyGasShare: number;
  legacyCountShare: number;
  burned: string;
  tips: string;
  paid: string;
  burnedShare: number;
  burnedByType: TypeSplit<string>;
  tipsByType: TypeSplit<string>;
  paidByType: TypeSplit<string>;
  avgPositionByType: TypeSplit<number | null>;
  positionHistogram: TypeSplit<number[]>;
  priorityInversionRate: number | null;
  overPrioritizedGasByType: TypeSplit<string>;
}

export interface WindowAggregate {
  blocksAnalyzed: number;
  fromBlock: string | null;
  toBlock: string | null;
  fromTimestamp: number | null;
  toTimestamp: number | null;
  legacyGasShare: number;
  legacyCountShare: number;
  burned: string;
  tips: string;
  paid: string;
  burnedByType: TypeSplit<string>;
  tipsByType: TypeSplit<string>;
  paidByType: TypeSplit<string>;
  avgPositionByType: TypeSplit<number | null>;
  positionHistogram: TypeSplit<number[]>;
  burnedShare: number;
  priorityInversionRate: number | null;
  overPrioritizedGasByType: TypeSplit<string>;
}

export interface NetworkHealthResult {
  chainId: number;
  burnsBaseFee: boolean;
  headBlock: string;
  hasMore: boolean;
  aggregate: WindowAggregate;
  blocks: BlockStats[];
}

interface Envelope {
  ok: boolean;
  result?: NetworkHealthResult;
  error?: string;
}

const FETCH_TIMEOUT_MS = 20_000;

/**
 * Fetch the latest `limit` blocks' health stats for `chainId`. Throws on any
 * non-ok response so React Query keeps data undefined and retries — no
 * cache-poisoning of an empty window.
 */
export async function fetchNetworkHealth(
  chainId: number,
  limit: number,
): Promise<NetworkHealthResult> {
  const url = scoped(`${API_BASE}?limit=${limit}`, chainId);
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  const data = (await res.json().catch(() => null)) as Envelope | null;
  if (!res.ok || !data?.ok || !data.result) {
    throw new Error(data?.error || `network-health HTTP ${res.status}`);
  }
  return data.result;
}
