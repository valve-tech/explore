import { lazy, Suspense, useState, useEffect, useRef } from "react";
import { Routes, Route, useLocation } from "react-router-dom";
import { useIsFetching, useIsMutating } from "@tanstack/react-query";
import { useAlertWebSocket, type AlertEvent } from "./hooks/useAlertWebSocket";
import AlertToast from "./components/AlertToast";
import ErrorBoundary from "./components/ErrorBoundary";
import AppShell from "./components/AppShell";
import Landing from "./components/Landing";
import RouteFallback from "./components/RouteFallback";
import WatchNotifications from "./components/watcher/WatchNotifications";
import ChainScopedRoutes from "./components/routing/ChainScopedRoutes";
import LegacyChainParamRedirect from "./components/routing/LegacyChainParamRedirect";
import { useVersionDriftReload } from "./hooks/useVersionDriftReload";

// Route-level code splitting. Landing stays eager (it's the default route and
// renders the first paint); every other route loads its chunk on demand. The
// heavyweights are the opcode debugger and the simulator family — splitting
// them keeps the entry chunk to shell + providers.
const ComponentGallery = lazy(() => import("./components/gallery/ComponentGallery"));
const SimulationPage = lazy(() => import("./pages/SimulationPage"));
const BundleSimulator = lazy(() => import("./components/BundleSimulator"));
const AlertDashboard = lazy(() => import("./components/monitoring/AlertDashboard"));
const TestNetDashboard = lazy(() => import("./components/testnets/TestNetDashboard"));
const ExplorerPanel = lazy(() => import("./components/explorer/ExplorerPanel"));
const MempoolView = lazy(() => import("./components/mempool/MempoolView"));
const NetworkHealthPage = lazy(() => import("./pages/NetworkHealthPage"));
const NetworkHealthBlockPage = lazy(() => import("./pages/NetworkHealthBlockPage"));
const DebuggerView = lazy(() => import("./components/debugger/DebuggerView"));
const ActionsDashboard = lazy(() => import("./components/actions/ActionsDashboard"));
const ForkSimulator = lazy(() => import("./components/ForkSimulator"));
const TransactionBuilder = lazy(() => import("./components/TransactionBuilder"));
const ContractDiff = lazy(() => import("./components/ContractDiff"));
const StorageLayoutViewer = lazy(() => import("./components/StorageLayoutViewer"));
const VerifyContract = lazy(() => import("./components/VerifyContract"));
const DraftsIndex = lazy(() => import("./components/drafts/DraftsIndex"));
const SettingsPanel = lazy(() => import("./components/settings/SettingsPanel"));
const WorkspaceList = lazy(() => import("./components/workspace/WorkspaceList"));
const WorkspaceDetail = lazy(() => import("./components/workspace/WorkspaceDetail"));

/**
 * The full route table. Mounted twice: once under the chain-scoped prefix
 * (`/eip155/369/…`) and once bare (`/tx/0xabc`), so every route works both
 * ways without being declared twice.
 */
function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/simulate" element={<SimulationPage />} />
      <Route path="/fork" element={<ForkSimulator />} />
      <Route path="/build" element={<TransactionBuilder />} />
      <Route path="/bundle" element={<BundleSimulator />} />
      <Route path="/monitoring" element={<AlertDashboard />} />
      <Route path="/testnets" element={<TestNetDashboard />} />
      <Route path="/explorer" element={<ExplorerPanel />} />
      {/* EIP-3091 scan endpoints — shareable, back/forward-friendly. */}
      <Route path="/tx/:hash" element={<ExplorerPanel />} />
      <Route path="/block/:id" element={<ExplorerPanel />} />
      <Route path="/address/:address" element={<ExplorerPanel />} />
      <Route path="/token/:address" element={<ExplorerPanel />} />
      <Route path="/mempool" element={<MempoolView />} />
      <Route path="/network-health" element={<NetworkHealthPage />} />
      <Route path="/network-health/block/:number" element={<NetworkHealthBlockPage />} />
      <Route path="/debugger" element={<DebuggerView />} />
      <Route path="/debugger/:txHash/:tab" element={<DebuggerView />} />
      <Route path="/debugger/:txHash" element={<DebuggerView />} />
      <Route path="/actions" element={<ActionsDashboard />} />
      <Route path="/storage" element={<StorageLayoutViewer />} />
      <Route path="/verify" element={<VerifyContract />} />
      <Route path="/diff" element={<ContractDiff />} />
      <Route path="/settings" element={<SettingsPanel />} />
      <Route path="/ui" element={<ComponentGallery />} />
      <Route path="/drafts/*" element={<DraftsIndex />} />
      <Route path="/workspace" element={<WorkspaceList />} />
      <Route path="/workspace/:id" element={<WorkspaceDetail />} />
    </Routes>
  );
}

export default function App() {
  const [apiStatus, setApiStatus] = useState<"connected" | "disconnected" | "checking">("checking");
  const [servedSha, setServedSha] = useState<string | null>(null);

  const { lastAlert } = useAlertWebSocket();
  const location = useLocation();
  const [appToast, setAppToast] = useState<AlertEvent | null>(null);
  const appToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevLastAlertRef = useRef<AlertEvent | null>(null);

  useEffect(() => {
    if (lastAlert === null || lastAlert === prevLastAlertRef.current) return;
    prevLastAlertRef.current = lastAlert;

    if (appToastTimerRef.current !== null) {
      clearTimeout(appToastTimerRef.current);
    }
    setAppToast(lastAlert);
    appToastTimerRef.current = setTimeout(() => {
      setAppToast(null);
      appToastTimerRef.current = null;
    }, 6_000);
  }, [lastAlert]);

  useEffect(() => {
    return () => {
      if (appToastTimerRef.current !== null) {
        clearTimeout(appToastTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      try {
        const res = await fetch("/health", { signal: AbortSignal.timeout(3000) });
        if (cancelled) return;
        const data = (await res.json()) as {
          status: string;
          db: boolean;
          version?: { sha?: string };
        };
        setApiStatus(data.status === "ok" && data.db ? "connected" : "disconnected");
        setServedSha(data.version?.sha ?? null);
      } catch {
        if (!cancelled) setApiStatus("disconnected");
      }
    };

    void check();
    const interval = setInterval(() => void check(), 15_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  // Auto-reload a stale tab once the deployed build moves ahead of this bundle.
  // `busy` defers the reload past in-flight work (a running simulation, fork op,
  // or debugger step) — the hook re-fires once the app goes idle.
  const busy = useIsFetching() + useIsMutating() > 0;
  useVersionDriftReload(servedSha, busy);

  return (
    <div
      className="h-screen flex flex-col theme-primary-bg"
    >
      {appToast !== null && (
        <AlertToast alert={appToast.data.alert} match={appToast.data.match} />
      )}

      {/* Client-side watcher: owns viem subscriptions app-wide + fires toasts. */}
      <WatchNotifications />

      <AppShell apiStatus={apiStatus}>
        <ErrorBoundary resetKey={location.pathname}>
        <LegacyChainParamRedirect />
        <Suspense fallback={<RouteFallback />}>
        <Routes>
          {/* Chain-scoped subtree: /eip155/369/tx/0xabc…
              The namespace is a LITERAL segment, one route per supported namespace.
              A param (`/:ns/:ref/*`) does NOT work: this outer <Routes> ranks only
              its own two routes and never sees the static segments inside
              <AppRoutes>, so `/tx/0xabc` matches with ns="tx" and renders
              not-found. A static first segment ranks correctly against `/*`, so a
              legacy URL never matches here at all. */}
          <Route
            path="/eip155/:ref/*"
            element={
              <ChainScopedRoutes namespace="eip155">
                <AppRoutes />
              </ChainScopedRoutes>
            }
          />
          <Route path="/*" element={<AppRoutes />} />
        </Routes>
        </Suspense>
        </ErrorBoundary>
      </AppShell>
    </div>
  );
}
