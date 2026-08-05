import { useState, useEffect, useMemo, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  CallTree,
  GasFlamegraph,
  OpcodeViewer,
  normalizeCallFrame,
  normalizeStructLogs,
} from "@valve-tech/trace-sdk";
import {
  fetchTrace,
  fetchGasProfile,
  fetchOpcodes,
  type CallFrame,
  type GasProfile,
  type OpcodeProfile,
  type OpcodeStep,
} from "../../api/debugger";
import { fetchTransaction } from "../../api/explorer";
import { useActiveChainId } from "../../lib/activeChain";
import { useResolvedChainRedirect } from "../../lib/useResolvedChainRedirect";
import { lookupWellKnown } from "../../lib/wellKnownSignatures";
import { recordDebuggerTx } from "../../lib/recentDebuggerTxs";
import { recordVisit } from "../../lib/recentEntities";
import GasProfiler from "./GasProfiler";
import StepDebugger from "./StepDebugger";
import { isValidTxHash } from "./DebuggerView/validation";
import { SearchBar } from "./DebuggerView/SearchBar";
import { LoadingPanel } from "./DebuggerView/LoadingPanel";
import { ErrorPanel } from "./DebuggerView/ErrorPanel";
import { EmptyState } from "./DebuggerView/EmptyState";
import { NoDataPanel } from "./DebuggerView/NoDataPanel";
import { Tabs, type DebugTab } from "./DebuggerView/Tabs";

interface DebuggerData {
  callTrace: CallFrame | null;
  gasProfile: GasProfile | null;
  opcodeProfile: OpcodeProfile | null;
  opcodeSteps: OpcodeStep[];
  targetAddress: string | null;
  debugAvailable: boolean;
  error: string | null;
}

/**
 * Fetch all three trace endpoints once and fold them into a single payload.
 * Returned (not thrown) so partial results and the "no debug node" state are
 * cached by TanStack Query — which persists to IndexedDB, so a reload of the
 * same tx serves instantly from cache instead of re-hitting the backend.
 */
async function fetchDebuggerData(
  hash: string,
  chainId: number,
): Promise<DebuggerData> {
  const [traceRes, gasRes, opcodeRes] = await Promise.all([
    fetchTrace(hash, chainId),
    fetchGasProfile(hash, chainId),
    // Skeleton: the full opcode stream (no per-step stack/memory/storage).
    // Per-step state is loaded lazily by StepDebugger for the current cursor.
    fetchOpcodes(hash, undefined, chainId),
  ]);

  const data: DebuggerData = {
    callTrace: null,
    gasProfile: null,
    opcodeProfile: null,
    opcodeSteps: [],
    targetAddress: null,
    debugAvailable: false,
    error: null,
  };

  if (traceRes.ok && traceRes.trace) {
    data.callTrace = traceRes.trace;
    data.debugAvailable = true;
    data.targetAddress = traceRes.trace.to || null;
  } else {
    data.debugAvailable = traceRes.debugAvailable ?? false;
    if (traceRes.error) data.error = traceRes.error;
  }

  if (gasRes.ok && gasRes.gasProfile) {
    data.gasProfile = gasRes.gasProfile;
    if (gasRes.opcodeProfile) data.opcodeProfile = gasRes.opcodeProfile;
  }

  if (opcodeRes.ok && opcodeRes.steps) data.opcodeSteps = opcodeRes.steps;

  return data;
}

const VALID_TABS: ReadonlySet<DebugTab> = new Set(["debugger", "calltree", "gas", "opcodes"]);

export default function DebuggerView() {
  const { txHash: urlHash, tab: urlTab } = useParams<{ txHash?: string; tab?: string }>();
  const navigate = useNavigate();
  const chainId = useActiveChainId();
  const [txHash, setTxHash] = useState(urlHash ?? "");

  // Keep the search input in sync when the route hash changes (e.g. ⌘K nav).
  useEffect(() => {
    if (urlHash) setTxHash(urlHash);
  }, [urlHash]);

  const validUrlHash = urlHash && isValidTxHash(urlHash) ? urlHash : null;

  // The active tab lives in the URL so deep-links are shareable
  // (/debugger/0xabc/gas opens the gas profile). Default tab ("debugger") is
  // canonicalized to the bare /debugger/0xabc URL — no need for a path suffix
  // when it's the default. Invalid tabs in the URL silently fall back.
  const activeTab: DebugTab =
    urlTab && VALID_TABS.has(urlTab as DebugTab) ? (urlTab as DebugTab) : "debugger";
  const setActiveTab = useCallback(
    (tab: DebugTab) => {
      if (!validUrlHash) return;
      const path =
        tab === "debugger"
          ? `/debugger/${validUrlHash}`
          : `/debugger/${validUrlHash}/${tab}`;
      navigate(path, { replace: true });
    },
    [validUrlHash, navigate],
  );

  // A shared/bookmarked /debugger/0xabc carries no ?chainid, so it would resolve
  // to PulseChain and report "no data" for a tx mined on any other chain. Point
  // the URL at the chain the hash actually lives on before spending three heavy
  // per-chain fetches on the wrong one.
  const chainRedirect = useResolvedChainRedirect(validUrlHash);
  const chainSettled = chainRedirect !== "resolving";

  // Resolve block context first (cheap). A tx hash alone isn't a stable
  // execution identity — a re-org can re-execute the same hash in a different
  // block — so the trace cache is scoped by block hash too. A not-yet-mined tx
  // has no block hash; it's keyed "pending" and never treated as final.
  const txContext = useQuery({
    queryKey: ["tx-context", validUrlHash, chainId],
    queryFn: () => fetchTransaction(validUrlHash!, chainId),
    enabled: !!validUrlHash && chainSettled,
    staleTime: Infinity,
    gcTime: Infinity,
  });

  const blockHash = txContext.data?.blockHash;
  const pending = !blockHash || /^0x0*$/.test(blockHash);
  // Gate the heavy trace on block context being resolved (success or error) so
  // we always key it correctly.
  const contextSettled = !validUrlHash || (chainSettled && !txContext.isLoading);
  const cacheScope = pending ? "pending" : blockHash!;

  // The whole trace is one cache entry, keyed by (tx hash, block hash). With
  // the persisted client + staleTime Infinity, a revisit/reload of a mined tx
  // reads it straight from IndexedDB; pending traces stay fresh (staleTime 0).
  const query = useQuery({
    queryKey: ["debugger-trace", validUrlHash, cacheScope, chainId],
    queryFn: () => fetchDebuggerData(validUrlHash!, chainId),
    enabled: !!validUrlHash && contextSettled,
    staleTime: pending ? 0 : Infinity,
    gcTime: pending ? 0 : Infinity,
  });

  const data = query.data ?? null;
  // Only a true first load (nothing cached yet) shows the loading panel; a
  // cache hit hydrates synchronously and skips it. Covers the block-context
  // resolve that precedes the trace fetch.
  const loading =
    !!validUrlHash &&
    !data &&
    (!chainSettled || txContext.isLoading || query.isFetching);
  const hasResult =
    !!data &&
    (!!data.callTrace || !!data.gasProfile || data.opcodeSteps.length > 0);
  const error =
    data?.error ?? (query.error instanceof Error ? query.error.message : null);
  const debugAvailable = data?.debugAvailable ?? null;

  const callTrace = data?.callTrace ?? null;
  const gasProfile = data?.gasProfile ?? null;
  const opcodeProfile = data?.opcodeProfile ?? null;
  const opcodeSteps = useMemo(() => data?.opcodeSteps ?? [], [data]);
  const targetAddress = data?.targetAddress ?? null;

  // Record into recents whenever a result is shown — including cache hits.
  useEffect(() => {
    if (validUrlHash && hasResult) {
      recordDebuggerTx(validUrlHash);
      recordVisit({ kind: "tx", value: validUrlHash });
    }
  }, [validUrlHash, hasResult]);

  const isValidHash = isValidTxHash(txHash);

  // Normalize wire-format trace into the SDK's canonical TraceFrame. Memoized
  // to avoid re-walking on every render.
  const normalizedTrace = useMemo(
    () => (callTrace ? normalizeCallFrame(callTrace) : null),
    [callTrace],
  );
  const normalizedSteps = useMemo(
    () => normalizeStructLogs(opcodeSteps),
    [opcodeSteps],
  );

  // Submitting the search box just navigates; the query fires off the new hash.
  const handleSubmitTrace = () => {
    if (!isValidHash) return;
    navigate(`/debugger/${txHash}`, { replace: true });
  };

  return (
    <div className="space-y-section">
      <SearchBar
        txHash={txHash}
        setTxHash={setTxHash}
        isValidHash={isValidHash}
        loading={loading}
        onSubmit={handleSubmitTrace}
      />

      {loading && <LoadingPanel />}

      {!loading && error && !hasResult && (
        <ErrorPanel error={error} debugAvailable={debugAvailable} />
      )}

      {!loading && hasResult && (
        <div className="card overflow-hidden">
          <Tabs
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            opcodeStepCount={opcodeSteps.length}
            hasCallTrace={!!callTrace}
            hasGasProfile={!!gasProfile}
          />

          {activeTab === "debugger" && (
            opcodeSteps.length > 0 ? (
              <StepDebugger
                // Keying by txHash remounts the subtree on tx change so that
                // navHistory, overrideLine, expandedFrame, pendingSearch and
                // friends — all per-trace state — reset cleanly without an
                // 8-setState useEffect chain.
                key={validUrlHash}
                steps={opcodeSteps}
                contractAddress={targetAddress ?? undefined}
                callTrace={callTrace}
                txHash={validUrlHash}
                decodedLogs={txContext.data?.decodedLogs}
                rawLogs={txContext.data?.rawLogs}
              />
            ) : (
              <NoDataPanel message="Step debugger requires opcode trace data. A debug-enabled node is needed." />
            )
          )}

          {activeTab === "calltree" && (
            normalizedTrace ? (
              <CallTree frame={normalizedTrace} />
            ) : (
              <NoDataPanel message="Call tree data is not available for this transaction." />
            )
          )}

          {activeTab === "gas" && (
            <div className="space-y-stack">
              {normalizedTrace && (
                <GasFlamegraph
                  frame={normalizedTrace}
                  resolveSelector={(sel) =>
                    lookupWellKnown(sel)?.signature?.split("(")[0]
                  }
                />
              )}
              {gasProfile ? (
                <GasProfiler
                  gasProfile={gasProfile}
                  opcodeProfile={opcodeProfile}
                />
              ) : (
                <NoDataPanel message="Gas profile data is not available for this transaction." />
              )}
            </div>
          )}

          {activeTab === "opcodes" && (
            normalizedSteps.length > 0 ? (
              <OpcodeViewer steps={normalizedSteps} />
            ) : (
              <NoDataPanel message="Opcode trace data is not available for this transaction." />
            )
          )}
        </div>
      )}

      {!loading && !error && !hasResult && <EmptyState />}
    </div>
  );
}
