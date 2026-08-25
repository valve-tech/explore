import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useActiveChainId } from "../../lib/activeChain";
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
import { LoadStatusBar } from "./AddressView/LoadStatusBar";
import { SectionFallback } from "./AddressView/SectionFallback";
import type { SectionSummary } from "./AddressView/sectionState";
import { useAddressWorkspace } from "./AddressView/useAddressWorkspace";

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
 * The address workspace.
 *
 * Every section loads on its own — see `useAddressWorkspace` for the reads and
 * their deadlines. This component only decides what each section renders:
 * its data, its own loading card, or its own failure with a retry. The page
 * itself paints immediately, so a slow upstream can no longer hold the address,
 * the header, and the tab bar hostage.
 */
export default function AddressView({
  address,
  onNavigate,
}: AddressViewProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const chainId = useActiveChainId();
  const { info, txs, tokens, page, loadPage, retry } = useAddressWorkspace(address, chainId);

  // The sub-tab lives in `?tab=` — not a path segment (chain scoping owns the
  // path) and not component state (a reload or a shared link must land on the
  // same panel). `isContract` is false while the overview is still loading,
  // which correctly keeps the initial render off the contract-only tabs until
  // we know better.
  const isContract = info.status === "ready" ? info.data.isContract : false;
  const subTab: AddressSubTab = resolveActiveTab(searchParams.get("tab"), isContract);

  // Counts drive the tab badges. A section that has not landed contributes
  // nothing — the badge hides at zero rather than claiming a total we do not
  // have yet.
  const txTotal = txs.status === "ready" ? txs.data.total : 0;
  const tokenCount = tokens.status === "ready" ? tokens.data.tokens.length : 0;

  const sections: SectionSummary[] = [
    { label: "Overview", state: info },
    { label: "Transactions", state: txs },
    { label: "Token balances", state: tokens },
  ];

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

  return (
    <div className="space-y-stack">
      <AddressHeader
        address={address}
        info={info.status === "ready" ? info.data : null}
        balanceUnavailable={info.status === "failed"}
        onViewContract={() =>
          onNavigate({ type: "contract", value: address })
        }
      />

      {info.status === "failed" && (
        <SectionFallback
          label="the address overview"
          state={info}
          onRetry={() => retry("info")}
        />
      )}

      <AlsoOnBar address={address} activeChainId={chainId} />

      <LoadStatusBar sections={sections} />

      <SubTabBar
        active={subTab}
        onSelect={selectTab}
        txCount={txTotal}
        tokenCount={tokenCount}
        extraTabs={isContract ? CONTRACT_ONLY_SUB_TABS : []}
      />

      {subTab === "transactions" &&
        (txs.status === "ready" ? (
          <TransactionsTab
            ownerAddress={address}
            txs={txs.data.transactions}
            page={page}
            total={txs.data.total}
            onLoadPage={loadPage}
            onNavigate={onNavigate}
          />
        ) : (
          <SectionFallback
            label="transactions"
            state={txs}
            onRetry={() => retry("transactions")}
          />
        ))}

      {subTab === "tokens" &&
        (tokens.status === "ready" ? (
          <TokensTab
            tokens={tokens.data.tokens}
            indexed={tokens.data.indexed}
            onNavigate={onNavigate}
          />
        ) : (
          <SectionFallback
            label="token balances"
            state={tokens}
            onRetry={() => retry("tokens")}
          />
        ))}

      {(subTab === "source" ||
        subTab === "storage" ||
        subTab === "diff" ||
        subTab === "verify") && (
        <ContractOnlyTabs subTab={subTab} address={address} chainId={chainId} />
      )}
    </div>
  );
}
