import { lazy, Suspense, useEffect, useState } from "react";
import RouteFallback from "../../RouteFallback";
import { SourceTab } from "../ContractView/SourceCodeTab";
import { fetchContractInfo } from "../../../api/explorer";
import type { AddressSubTab } from "./SubTabBar";

// Same route-level code splitting the top-level /storage, /diff and /verify
// routes already use (see App.tsx) — an address page that never opens these
// tabs should not pay for their weight.
const LazyStorageLayoutViewer = lazy(() => import("../../StorageLayoutViewer"));
const LazyContractDiff = lazy(() => import("../../ContractDiff"));
const LazyVerifyContract = lazy(() => import("../../VerifyContract"));

type ContractOnlySubTab = Extract<
  AddressSubTab,
  "source" | "storage" | "diff" | "verify"
>;

/**
 * Body for the four contract-only sub-tabs. Each panel is the existing
 * top-level view (Storage, Diff, Verify) or leaf component (Source),
 * composed here rather than reimplemented — see
 * .superpowers/sdd/drafts-buildout/task-b-brief.md.
 */
export function ContractOnlyTabs({
  subTab,
  address,
  chainId,
}: {
  subTab: ContractOnlySubTab;
  address: string;
  chainId: number;
}) {
  switch (subTab) {
    case "source":
      return <SourceContractTab address={address} chainId={chainId} />;
    case "storage":
      return (
        <Suspense fallback={<RouteFallback />}>
          <LazyStorageLayoutViewer />
        </Suspense>
      );
    case "diff":
      return (
        <Suspense fallback={<RouteFallback />}>
          <LazyContractDiff />
        </Suspense>
      );
    case "verify":
      return (
        <Suspense fallback={<RouteFallback />}>
          <LazyVerifyContract />
        </Suspense>
      );
  }
}

/**
 * Fetches the contract's verified source and hands it to the existing
 * `SourceTab` leaf, which already renders its own "not verified" empty
 * state when `sourceCode` is null.
 */
function SourceContractTab({
  address,
  chainId,
}: {
  address: string;
  chainId: number;
}) {
  const [sourceCode, setSourceCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchContractInfo(address, chainId)
      .then((data) => {
        if (!cancelled) setSourceCode(data.sourceCode);
      })
      .catch(() => {
        if (!cancelled) setSourceCode(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [address, chainId]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[200px] p-2 sm:p-4">
        <div className="spinner mb-3" />
        <span className="text-sm theme-text-secondary">Loading source...</span>
      </div>
    );
  }

  return <SourceTab sourceCode={sourceCode} />;
}
