import { lazy, Suspense, useState, useEffect, useRef } from "react";
import { Routes, Route, useLocation } from "react-router-dom";
import { useAlertWebSocket, type AlertEvent } from "./hooks/useAlertWebSocket";
import AlertToast from "./components/AlertToast";
import ErrorBoundary from "./components/ErrorBoundary";
import AppShell from "./components/AppShell";
import Landing from "./components/Landing";
import RouteFallback from "./components/RouteFallback";
import WatchNotifications from "./components/watcher/WatchNotifications";

// Route-level code splitting. Landing stays eager (it's the default route and
// renders the first paint); every other route loads its chunk on demand. The
// heavyweights are the opcode debugger and the simulator family — splitting
// them keeps the entry chunk to shell + providers.
const ComponentGallery = lazy(() => import("./components/gallery/ComponentGallery"));
const SimulationPage = lazy(() => import("./pages/SimulationPage"));
const BundleSimulator = lazy(() => import("./components/BundleSimulator"));
const AlertDashboard = lazy(() => import("./components/monitoring/AlertDashboard"));
const TestNetDashboard = lazy(() => import("./components/testnets/TestNetDashboard"));
const RpcPage = lazy(() => import("./pages/RpcPage"));
const ExplorerPanel = lazy(() => import("./components/explorer/ExplorerPanel"));
const MempoolView = lazy(() => import("./components/mempool/MempoolView"));
const NetworkHealthPage = lazy(() => import("./pages/NetworkHealthPage"));
const DebuggerView = lazy(() => import("./components/debugger/DebuggerView"));
const ActionsDashboard = lazy(() => import("./components/actions/ActionsDashboard"));
const ForkSimulator = lazy(() => import("./components/ForkSimulator"));
const TransactionBuilder = lazy(() => import("./components/TransactionBuilder"));
const ContractDiff = lazy(() => import("./components/ContractDiff"));
const StorageLayoutViewer = lazy(() => import("./components/StorageLayoutViewer"));
const VerifyContract = lazy(() => import("./components/VerifyContract"));
const DraftsIndex = lazy(() => import("./components/drafts/DraftsIndex"));
const SettingsPanel = lazy(() => import("./components/drafts/SettingsPanel"));
const WorkspaceList = lazy(() => import("./components/workspace/WorkspaceList"));
const WorkspaceDetail = lazy(() => import("./components/workspace/WorkspaceDetail"));

export default function App() {
  const [apiStatus, setApiStatus] = useState<"connected" | "disconnected" | "checking">("checking");

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
        const data = (await res.json()) as { status: string; db: boolean };
        setApiStatus(data.status === "ok" && data.db ? "connected" : "disconnected");
      } catch {
        if (!cancelled) setApiStatus("disconnected");
      }
    };

    void check();
    const interval = setInterval(() => void check(), 15_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

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
        <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/simulate" element={<SimulationPage />} />
          <Route path="/fork" element={<ForkSimulator />} />
          <Route path="/build" element={<TransactionBuilder />} />
          <Route path="/bundle" element={<BundleSimulator />} />
          <Route path="/monitoring" element={<AlertDashboard />} />
          <Route path="/testnets" element={<TestNetDashboard />} />
          <Route path="/rpc" element={<RpcPage />} />
          <Route path="/explorer" element={<ExplorerPanel />} />
          {/* EIP-3091 scan endpoints — shareable, back/forward-friendly. */}
          <Route path="/tx/:hash" element={<ExplorerPanel />} />
          <Route path="/block/:id" element={<ExplorerPanel />} />
          <Route path="/address/:address" element={<ExplorerPanel />} />
          <Route path="/token/:address" element={<ExplorerPanel />} />
          <Route path="/mempool" element={<MempoolView />} />
          <Route path="/health" element={<NetworkHealthPage />} />
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
        </Suspense>
        </ErrorBoundary>
      </AppShell>
    </div>
  );
}
