/**
 * Portfolio holdings API client. Mirrors the backend
 * GET /api/portfolio/holdings shape (services/portfolio). Token holdings come
 * from the substreams-backed gateway; `indexed: false` means the chain isn't
 * wired yet (native-only).
 */

import { apiUrl } from "../lib/apiBase";
import { scoped } from "./chainScope";
import { DEFAULT_CHAIN_ID } from "../lib/chains";

const API_BASE = apiUrl("/api");

export interface Holding {
  tokenAddress: string;
  symbol: string;
  name: string;
  /** on-chain token decimals — display metadata, applied in the UI. */
  decimals: number;
  /** raw integer balance (smallest unit). Scaled at the render edge. */
  balance: string;
}

export interface NativeHolding {
  symbol: string;
  /** raw integer wei balance. The UI scales it (native = 18 decimals). */
  balance: string;
}

export interface HoldingsResult {
  chainId: number;
  address: string;
  native: NativeHolding;
  holdings: Holding[];
  /** false when the chain's substreams sink table doesn't exist yet. */
  indexed: boolean;
}

export async function fetchHoldings(
  address: string,
  chainId: number = DEFAULT_CHAIN_ID,
  opts: { signal?: AbortSignal } = {},
): Promise<HoldingsResult> {
  // apiUrl() makes this work from an IPFS gateway (absolute backend origin);
  // scoped() appends `chainid` only for non-default chains, so the default
  // chain's request stays byte-identical to the single-chain era.
  const url = scoped(`${API_BASE}/portfolio/holdings?address=${address}`, chainId);
  // `opts.signal` carries the caller's deadline. The holdings gateway reads an
  // indexed archive, so it is usually fast — but a stalled connection must not
  // hold the address page open forever.
  const res = await fetch(url, { signal: opts.signal });
  if (!res.ok) {
    const text = await res.text();
    let message = text;
    try {
      message = (JSON.parse(text) as { error?: string }).error ?? text;
    } catch {
      /* keep raw text */
    }
    throw new Error(message);
  }
  const json = (await res.json()) as { ok: boolean; result: HoldingsResult; error?: string };
  if (!json.ok) throw new Error(json.error ?? "Unknown API error");
  return json.result;
}
