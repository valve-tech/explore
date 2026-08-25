import { apiUrl } from "../lib/apiBase";
import { scoped } from "./chainScope";
import { DEFAULT_CHAIN_ID } from "../lib/chains";
/**
 * Client for the home-view ("latest") API endpoints — Bundle 1 of
 * EXPLORER_API_SPEC §2.1–2.3.
 */

const API_BASE = apiUrl("/api");


// ---------------------------------------------------------------------------
// Wire types — mirrors `services/explorer/latest.ts` on the server.
// ---------------------------------------------------------------------------

export interface BlockHeader {
  number: string;
  hash: string;
  timestamp: number;
  miner: string;
  transactionCount: number;
  gasUsed: string;
  gasLimit: string;
  baseFeePerGas: string | null;
}

export interface LatestSummary {
  latestBlock: BlockHeader;
  finalizedBlock: {
    number: string;
    hash: string;
    timestamp: number;
    lagBlocks: number;
  };
  gasPrice: {
    baseFeePerGas: string;
    suggestedPriorityFee: string;
  };
  network: {
    chainId: number;
    name: string;
  };
}

export interface RecentBlocksResult {
  blocks: BlockHeader[];
  cursor: { before: string } | null;
}

export interface RecentTx {
  hash: string;
  blockNumber: string;
  timestamp: number;
  from: string;
  to: string | null;
  value: string;
  valuePLS: string;
  gasUsed: string | null;
  type: string;
  gasPrice: string | null;
  maxFeePerGas: string | null;
  maxPriorityFeePerGas: string | null;
  methodId: string;
  methodName: string | null;
  /**
   * How many candidate signatures leave `methodName` in doubt. 0 when nothing
   * resolved, 1 when the name is settled, N > 1 when it is one guess among N.
   * `MethodName` marks anything above 1 and fetches the alternatives only
   * when the reader asks for them.
   *
   * Not the raw registration count: the server vouches for canonical
   * signatures and reports 1 for them, so a selector with six 4byte entries
   * arrives as 1 when one of them is `transfer(address,uint256)`. See
   * `services/signatures/vouched.ts` for why.
   *
   * OPTIONAL on purpose — see the note on `functionCandidates` in
   * `api/explorer.ts`. A row served from IndexedDB predates the field.
   */
  methodCandidates?: number;
}

export interface RecentTxsResult {
  transactions: RecentTx[];
}

// ---------------------------------------------------------------------------
// Helpers (matches the envelope used by api/explorer.ts)
// ---------------------------------------------------------------------------

async function apiFetch<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    let message: string;
    try {
      const parsed = JSON.parse(text) as { error?: string };
      message = parsed.error ?? text;
    } catch {
      message = text;
    }
    throw new Error(message);
  }
  const json = (await res.json()) as { ok: boolean; result: T; error?: string };
  if (!json.ok) throw new Error(json.error ?? "Unknown API error");
  return json.result;
}

export function fetchLatestSummary(
  chainId: number = DEFAULT_CHAIN_ID,
): Promise<LatestSummary> {
  return apiFetch<LatestSummary>(scoped(`${API_BASE}/latest/summary`, chainId));
}

export function fetchRecentBlocks(opts: {
  limit?: number;
  before?: string;
  chainId?: number;
}): Promise<RecentBlocksResult> {
  const params = new URLSearchParams();
  if (opts.limit != null) params.set("limit", String(opts.limit));
  if (opts.before != null) params.set("before", opts.before);
  const qs = params.toString();
  return apiFetch<RecentBlocksResult>(
    scoped(`${API_BASE}/blocks${qs ? `?${qs}` : ""}`, opts.chainId ?? DEFAULT_CHAIN_ID),
  );
}

export function fetchRecentTxs(
  limit: number = 10,
  chainId: number = DEFAULT_CHAIN_ID,
): Promise<RecentTxsResult> {
  return apiFetch<RecentTxsResult>(
    scoped(`${API_BASE}/txs/recent?limit=${limit}`, chainId),
  );
}
