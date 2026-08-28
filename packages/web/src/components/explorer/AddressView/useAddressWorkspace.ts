/**
 * Loads the three sections of the address workspace — overview, transactions,
 * token balances — independently.
 *
 * The old shape was a single `Promise.all` over four reads with one `loading`
 * flag: the page showed a bare spinner until the SLOWEST read landed (15–30s
 * on a busy address), told the user nothing about what it was waiting for, and
 * blanked entirely the moment any one read failed. Worse, nothing bounded the
 * wait client-side, so a read that never answered spun forever.
 *
 * Now each section owns its own read, its own 40s deadline, and its own state.
 */

import { useCallback, useEffect, useState } from "react";
import {
  fetchAddressInfo,
  fetchAddressTokens,
  fetchAddressTransactions,
  type AddressInfo,
} from "../../../api/explorer";
import { fetchHoldings } from "../../../api/portfolio";
import { addressSectionSignal } from "./deadline";
import {
  loadPageSize,
  pageAtNewSize,
  savePageSize,
  type AddressPageSize,
} from "./pageSize";
import {
  LOADING,
  resolveTokensSection,
  settleSection,
  type SectionState,
  type TokenSectionData,
  type TxPageData,
} from "./sectionState";

/** The sections a user can retry by name. */
export type AddressSectionKey = "info" | "transactions" | "tokens";

export interface AddressWorkspace {
  info: SectionState<AddressInfo>;
  txs: SectionState<TxPageData>;
  tokens: SectionState<TokenSectionData>;
  /** The transaction page currently requested (1-based). */
  page: number;
  /** How many rows that page holds. */
  pageSize: AddressPageSize;
  loadPage: (page: number) => void;
  /** Change the page size, keeping the reader's first visible row in view. */
  setPageSize: (size: AddressPageSize) => void;
  retry: (section: AddressSectionKey) => void;
}

/**
 * The backend omits `total` on some paths; fall back to the page length so the
 * tab badge and the pagination never read as zero for a page that has rows.
 */
export function normalizeTxPage(data: {
  transactions: TxPageData["transactions"];
  total?: number;
}): TxPageData {
  return {
    transactions: data.transactions,
    total: data.total ?? data.transactions.length,
  };
}

/** Identity of the thing being viewed. A new one resets the page to 1. */
function scopeKey(address: string, chainId: number): string {
  return `${address}:${chainId}`;
}

export function useAddressWorkspace(
  address: string,
  chainId: number,
): AddressWorkspace {
  const [info, setInfo] = useState<SectionState<AddressInfo>>(LOADING);
  const [txs, setTxs] = useState<SectionState<TxPageData>>(LOADING);
  const [tokens, setTokens] = useState<SectionState<TokenSectionData>>(LOADING);

  // Retry counters. Bumping one re-runs exactly one section's effect.
  const [attempts, setAttempts] = useState({ info: 0, transactions: 0, tokens: 0 });

  // The requested page is stored WITH the scope it belongs to, and the scope is
  // compared during render. That keeps "a new address starts at page 1" a
  // derivation rather than a reset effect, and it means a late response for the
  // previous address can never paint over the new one.
  //
  // The size travels in the same state for the same reason: it is part of what
  // "which rows am I looking at" means, and a stale size paired with a fresh
  // page would request a window that never existed.
  const key = scopeKey(address, chainId);
  const [request, setRequest] = useState(() => ({
    key,
    page: 1,
    size: loadPageSize(),
  }));
  const sameScope = request.key === key;
  const page = sameScope ? request.page : 1;
  const pageSize = request.size;

  // --- Overview (balance + is-this-a-contract) ---------------------------
  useEffect(() => {
    let cancelled = false;
    setInfo(LOADING);
    void settleSection(
      fetchAddressInfo(address, chainId, { signal: addressSectionSignal() }),
    ).then((state) => {
      if (!cancelled) setInfo(state);
    });
    return () => {
      cancelled = true;
    };
  }, [address, chainId, attempts.info]);

  // --- Transactions (one page at a time) ---------------------------------
  useEffect(() => {
    let cancelled = false;
    setTxs(LOADING);
    void settleSection(
      fetchAddressTransactions(address, page, pageSize, chainId, {
        signal: addressSectionSignal(),
      }),
    ).then((state) => {
      if (cancelled) return;
      setTxs(state.status === "ready" ? { status: "ready", data: normalizeTxPage(state.data) } : state);
    });
    return () => {
      cancelled = true;
    };
  }, [address, chainId, page, pageSize, attempts.transactions]);

  // --- Token balances (indexed gateway, RPC list as the stand-in) ---------
  useEffect(() => {
    let cancelled = false;
    setTokens(LOADING);
    // Two reads, two deadlines, ONE section. `allSettled` — never `all` — so a
    // failed gateway read still lets the RPC list through.
    const tokenRead = fetchAddressTokens(address, chainId, {
      signal: addressSectionSignal(),
    });
    const holdingsRead = fetchHoldings(address, chainId, {
      signal: addressSectionSignal(),
    });
    void Promise.allSettled([tokenRead, holdingsRead]).then(([tokenResult, holdingsResult]) => {
      if (!cancelled) setTokens(resolveTokensSection(tokenResult!, holdingsResult!));
    });
    return () => {
      cancelled = true;
    };
  }, [address, chainId, attempts.tokens]);

  const loadPage = useCallback(
    (next: number) =>
      setRequest((prev) => ({ key, page: next, size: prev.size })),
    [key],
  );

  const setPageSize = useCallback(
    (size: AddressPageSize) => {
      savePageSize(size);
      setRequest((prev) => {
        const from = prev.key === key ? prev.page : 1;
        return { key, page: pageAtNewSize(from, prev.size, size), size };
      });
    },
    [key],
  );

  const retry = useCallback((section: AddressSectionKey) => {
    setAttempts((prev) => ({ ...prev, [section]: prev[section] + 1 }));
  }, []);

  return { info, txs, tokens, page, pageSize, loadPage, setPageSize, retry };
}
