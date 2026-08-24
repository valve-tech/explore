import { apiUrl } from "../lib/apiBase";

/**
 * Client for the chain-agnostic address endpoints. These deliberately do NOT go
 * through `scoped()` — they answer "which chains?", so binding them to one
 * chain would be incoherent. `chainIds` carries the testnet toggle instead.
 */

const API_BASE = apiUrl("/api/multichain");

export interface ChainPresence {
  chainId: number;
  /** Native balance in wei, as a string. Format at the edge, never here. */
  balance: string;
  nonce: number;
  isContract: boolean;
  /** True when the probe failed. Means "unknown", NOT "absent". */
  error?: true;
}

export interface PerChainStatus {
  chainId: number;
  returned: number;
  error?: true;
}

export interface TaggedTx {
  chainId: number;
  hash: string;
  timeStamp: string;
  [key: string]: unknown;
}

export interface MergedActivity {
  rows: TaggedTx[];
  perChain: PerChainStatus[];
}

function chainsParam(chainIds?: number[]): string {
  return chainIds?.length ? `?chains=${chainIds.join(",")}` : "";
}

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `Request failed HTTP ${res.status}`);
  }
  const data = (await res.json()) as { ok: boolean; result: T };
  return data.result;
}

export async function fetchChainPresence(
  address: string,
  chainIds?: number[],
): Promise<ChainPresence[]> {
  const result = await get<{ address: string; chains: ChainPresence[] }>(
    `${API_BASE}/address/${address}${chainsParam(chainIds)}`,
  );
  return result.chains;
}

export async function fetchMergedActivity(
  address: string,
  chainIds?: number[],
  limit = 25,
): Promise<MergedActivity> {
  const suffix = chainsParam(chainIds);
  const sep = suffix ? "&" : "?";
  return get<MergedActivity>(
    `${API_BASE}/address/${address}/activity${suffix}${sep}limit=${limit}`,
  );
}

/** A chain is worth showing when the address has code, funds, or history. */
export function hasPresence(p: ChainPresence): boolean {
  if (p.error) return false;
  return p.isContract || p.nonce > 0 || p.balance !== "0";
}
