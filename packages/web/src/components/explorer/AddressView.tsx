import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useActiveChainId } from "../../lib/activeChain";
import {
  fetchAddressInfo,
  fetchAddressTransactions,
  fetchAddressTokens,
  type AddressInfo,
  type AddressTransaction,
  type AddressToken,
} from "../../api/explorer";
import { fetchHoldings, type Holding } from "../../api/portfolio";
import { formatAmountDisplay } from "../../lib/format/tokenAmount";
import AlsoOnBar from "./AlsoOnBar";
import { AddressHeader } from "./AddressView/AddressHeader";
import { SubTabBar, type AddressSubTab, type ExtraSubTab } from "./AddressView/SubTabBar";
import {
  TransactionsTab,
  type AddressNavTarget,
} from "./AddressView/TransactionsTab";
import { TokensTab } from "./AddressView/TokensTab";
import { ContractOnlyTabs } from "./AddressView/ContractOnlyTabs";
import { resolveActiveTab } from "./AddressView/subTabUrl";

interface AddressViewProps {
  address: string;
  onNavigate: (target: AddressNavTarget) => void;
}

/**
 * The contract-only tabs, in display order. Only shown when `info.isContract`
 * — see `resolveActiveTab` for the URL-side half of the same rule.
 */
const CONTRACT_ONLY_SUB_TABS: ExtraSubTab[] = [
  { key: "source", label: "Source" },
  { key: "storage", label: "Storage" },
  { key: "diff", label: "Diff" },
  { key: "verify", label: "Re-verify" },
];

/**
 * Map a holdings-gateway row (storage-diff truth, raw balance) to the
 * AddressToken display shape the Tokens tab renders. Balance is scaled at this
 * render edge via formatAmountDisplay — raw ints never get float math.
 */
function holdingToToken(h: Holding): AddressToken {
  let formatted: string;
  try {
    formatted = formatAmountDisplay(BigInt(h.balance), h.decimals, {
      maxFractionDigits: 4,
    });
  } catch {
    formatted = h.balance;
  }
  return {
    balance: h.balance,
    formattedBalance: formatted,
    contractAddress: h.tokenAddress,
    name: h.name,
    symbol: h.symbol,
    decimals: String(h.decimals),
    type: "ERC-20",
  };
}

export default function AddressView({
  address,
  onNavigate,
}: AddressViewProps) {
  const [info, setInfo] = useState<AddressInfo | null>(null);
  const [txs, setTxs] = useState<AddressTransaction[]>([]);
  // The address's FULL transaction count (chifra appearance count), not the
  // current page length — drives the tab badge and pagination. `txs` is
  // replaced per page, so its length is only ever the page size.
  const [total, setTotal] = useState(0);
  const [tokens, setTokens] = useState<AddressToken[]>([]);
  // True when the token list came from the indexed balance-changes gateway
  // (storage-diff truth) rather than the RPC/chifra fallback.
  const [tokensIndexed, setTokensIndexed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [searchParams, setSearchParams] = useSearchParams();
  const chainId = useActiveChainId();

  // The sub-tab lives in `?tab=` — not a path segment (chain scoping owns the
  // path) and not component state (a reload or a shared link must land on the
  // same panel). `isContract` is false while `info` is still loading, which
  // correctly keeps the initial render off the contract-only tabs until we
  // know better.
  const isContract = info?.isContract ?? false;
  const subTab: AddressSubTab = resolveActiveTab(searchParams.get("tab"), isContract);

  const selectTab = (tab: AddressSubTab) => {
    const next = new URLSearchParams(searchParams);
    next.set("tab", tab);
    setSearchParams(next);
  };

  // Storage and Re-verify are composed from top-level views that read their
  // own `?address=` (the same hook the ⌘K palette already deep-links
  // through) rather than taking a prop — keep it in sync so landing here
  // directly, or reloading, prefills them with this page's own address.
  //
  // The param is REMOVED again when you leave those two tabs. It used to be
  // set and never cleared, so one visit to Storage left `&address=0x…` riding
  // along on every later URL for the rest of the session — duplicating the
  // address already in the path, and turning any link copied afterwards into
  // a puzzle. Only ever removes the value this page put there; an `?address=`
  // pointing somewhere else is not ours to clear.
  useEffect(() => {
    const needsParam = subTab === "storage" || subTab === "verify";
    const current = searchParams.get("address");
    if (needsParam ? current === address : current === null) return;

    const next = new URLSearchParams(searchParams);
    if (needsParam) {
      next.set("address", address);
    } else if (current === address) {
      next.delete("address");
    } else {
      return;
    }
    setSearchParams(next, { replace: true });
  }, [subTab, address, searchParams, setSearchParams]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([
      fetchAddressInfo(address, chainId),
      fetchAddressTransactions(address, 1, 25, chainId),
      fetchAddressTokens(address, chainId),
      // Preferred source: the indexed balance-changes gateway (storage-diff
      // truth). Non-fatal — if it errors or isn't indexed for this chain we
      // fall back to the RPC/chifra token list so the tab never regresses.
      fetchHoldings(address, chainId).catch(() => null),
    ])
      .then(([addrInfo, txData, tokenData, holdingsData]) => {
        if (!cancelled) {
          setInfo(addrInfo);
          setTxs(txData.transactions);
          setTotal(txData.total ?? txData.transactions.length);
          const indexed = holdingsData?.indexed ?? false;
          setTokens(indexed ? holdingsData!.holdings.map(holdingToToken) : tokenData);
          setTokensIndexed(indexed);
          setPage(1);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [address, chainId]);

  const loadPage = async (newPage: number) => {
    try {
      const data = await fetchAddressTransactions(address, newPage, 25, chainId);
      setTxs(data.transactions);
      setTotal(data.total ?? data.transactions.length);
      setPage(newPage);
    } catch {
      // keep current
    }
  };

  if (loading) {
    return (
      <div
        className="rounded-lg bs p-8 flex flex-col items-center justify-center min-h-[300px] theme-card-bg"
      >
        <div className="spinner mb-3" />
        <span
          className="text-sm theme-text-secondary"
        >
          Loading address...
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg p-2 sm:p-4 theme-card-bg">
        <h3 className="text-sm font-semibold mb-1 theme-danger">
          Error
        </h3>
        <p className="text-sm theme-text-secondary">
          {error}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-stack">
      <AddressHeader
        address={address}
        info={info}
        onViewContract={() =>
          onNavigate({ type: "contract", value: address })
        }
      />

      <AlsoOnBar address={address} activeChainId={chainId} />

      <SubTabBar
        active={subTab}
        onSelect={selectTab}
        txCount={total}
        tokenCount={tokens.length}
        extraTabs={isContract ? CONTRACT_ONLY_SUB_TABS : []}
      />

      {subTab === "transactions" && (
        <TransactionsTab
          ownerAddress={address}
          txs={txs}
          page={page}
          total={total}
          onLoadPage={loadPage}
          onNavigate={onNavigate}
        />
      )}

      {subTab === "tokens" && (
        <TokensTab tokens={tokens} indexed={tokensIndexed} onNavigate={onNavigate} />
      )}

      {(subTab === "source" ||
        subTab === "storage" ||
        subTab === "diff" ||
        subTab === "verify") && (
        <ContractOnlyTabs subTab={subTab} address={address} chainId={chainId} />
      )}
    </div>
  );
}
