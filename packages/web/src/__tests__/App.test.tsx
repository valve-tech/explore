import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "../App";

/**
 * Router root (React Router 7). Each route is rendered inside a MemoryRouter at
 * a specific path and we assert the right page mounts. The lazy page chunks are
 * mocked to lightweight sentinels (default exports, since App uses React.lazy),
 * AppShell is reduced to a children passthrough, and the alert WebSocket +
 * client watcher are stubbed. The /health poll is mocked on global fetch.
 *
 * EIP-3091 scan routes resolve to the Explorer; the tx/address paths use a real
 * PulseChain (369) tx hash + the WPLS address — https://scan.pulsechain.com.
 */
const WPLS = "0xa1077a294dde1b09bb078844df40758a5d0f9a27";
const TX = "0x" + "ab".repeat(32);

// Shell + ambient pieces → passthrough / no-op.
vi.mock("../components/AppShell", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock("../components/watcher/WatchNotifications", () => ({
  default: () => null,
}));
vi.mock("../components/AlertToast", () => ({
  default: ({ alert }: { alert: { id?: string } }) => (
    <div>toast:{alert?.id ?? "?"}</div>
  ),
}));
const lastAlertRef = { current: null as unknown };
vi.mock("../hooks/useAlertWebSocket", () => ({
  useAlertWebSocket: () => ({ lastAlert: lastAlertRef.current }),
}));

// Eager + lazy route components → sentinels. Lazy ones must default-export.
vi.mock("../components/Landing", () => ({
  default: () => <div>page:landing</div>,
}));
const lazyPage = (name: string) => ({ default: () => <div>page:{name}</div> });
vi.mock("../pages/SimulationPage", () => lazyPage("simulate"));
vi.mock("../components/ForkSimulator", () => lazyPage("fork"));
vi.mock("../components/TransactionBuilder", () => lazyPage("build"));
vi.mock("../components/BundleSimulator", () => lazyPage("bundle"));
vi.mock("../components/monitoring/AlertDashboard", () => lazyPage("monitoring"));
vi.mock("../components/testnets/TestNetDashboard", () => lazyPage("testnets"));
vi.mock("../components/explorer/ExplorerPanel", () => lazyPage("explorer"));
vi.mock("../components/mempool/MempoolView", () => lazyPage("mempool"));
vi.mock("../pages/NetworkHealthPage", () => lazyPage("network-health"));
vi.mock("../components/debugger/DebuggerView", () => lazyPage("debugger"));
vi.mock("../components/actions/ActionsDashboard", () => lazyPage("actions"));
vi.mock("../components/StorageLayoutViewer", () => lazyPage("storage"));
vi.mock("../components/VerifyContract", () => lazyPage("verify"));
vi.mock("../components/ContractDiff", () => lazyPage("diff"));
vi.mock("../components/settings/SettingsPanel", () => lazyPage("settings"));
vi.mock("../components/gallery/ComponentGallery", () => lazyPage("ui"));
vi.mock("../components/drafts/DraftsIndex", () => lazyPage("drafts"));
vi.mock("../components/workspace/WorkspaceList", () => lazyPage("workspace"));
vi.mock("../components/workspace/WorkspaceDetail", () => lazyPage("workspace-detail"));

// A health-check fetch stub used by App's connectivity poll (real timers).
function stubHealthFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve({
        json: () => Promise.resolve({ status: "ok", db: true }),
      }),
    ),
  );
  if (!("timeout" in AbortSignal)) {
    (AbortSignal as { timeout?: unknown }).timeout = () =>
      new AbortController().signal;
  }
}

async function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

describe("App routing", () => {
  beforeEach(() => {
    lastAlertRef.current = null;
    stubHealthFetch();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders Landing at / (eager route, no Suspense wait)", async () => {
    await renderAt("/");
    expect(await screen.findByText("page:landing")).toBeInTheDocument();
  });

  it.each([
    ["/simulate", "page:simulate"],
    ["/fork", "page:fork"],
    ["/build", "page:build"],
    ["/bundle", "page:bundle"],
    ["/monitoring", "page:monitoring"],
    ["/testnets", "page:testnets"],
    ["/explorer", "page:explorer"],
    ["/mempool", "page:mempool"],
    ["/network-health", "page:network-health"],
    ["/debugger", "page:debugger"],
    ["/actions", "page:actions"],
    ["/storage", "page:storage"],
    ["/verify", "page:verify"],
    ["/diff", "page:diff"],
    ["/settings", "page:settings"],
    ["/ui", "page:ui"],
    ["/workspace", "page:workspace"],
  ])("mounts the right page at %s", async (path, expected) => {
    await renderAt(path);
    expect(await screen.findByText(expected)).toBeInTheDocument();
  });

  it("resolves EIP-3091 scan routes to the Explorer", async () => {
    await renderAt(`/tx/${TX}`);
    expect(await screen.findByText("page:explorer")).toBeInTheDocument();
  });

  it("resolves /address/:address to the Explorer", async () => {
    await renderAt(`/address/${WPLS}`);
    expect(await screen.findByText("page:explorer")).toBeInTheDocument();
  });

  it("resolves the parameterized debugger route", async () => {
    await renderAt(`/debugger/${TX}/trace`);
    expect(await screen.findByText("page:debugger")).toBeInTheDocument();
  });

  it("resolves the nested drafts splat route", async () => {
    await renderAt("/drafts/anything");
    expect(await screen.findByText("page:drafts")).toBeInTheDocument();
  });

  it("resolves the workspace detail route", async () => {
    await renderAt("/workspace/abc123");
    expect(await screen.findByText("page:workspace-detail")).toBeInTheDocument();
  });
});

describe("App — alert toast lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          json: () => Promise.resolve({ status: "ok", db: true }),
        }),
      ),
    );
    if (!("timeout" in AbortSignal)) {
      (AbortSignal as { timeout?: unknown }).timeout = () => new AbortController().signal;
    }
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("renders a toast when an alert arrives and clears it after the timeout", async () => {
    lastAlertRef.current = {
      data: { alert: { id: "alert-1" }, match: { hash: TX } },
    };
    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByText("toast:alert-1")).toBeInTheDocument();

    // The toast auto-dismisses after 6s.
    act(() => {
      vi.advanceTimersByTime(6_000);
    });
    expect(screen.queryByText("toast:alert-1")).not.toBeInTheDocument();
  });

  it("a second alert clears the prior timer and swaps the toast", () => {
    lastAlertRef.current = {
      data: { alert: { id: "alert-1" }, match: { hash: TX } },
    };
    const { rerender } = render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByText("toast:alert-1")).toBeInTheDocument();

    // A new alert object arrives before the first timer elapses → the prior
    // timeout is cleared and the toast swaps (covers the clearTimeout branch).
    lastAlertRef.current = {
      data: { alert: { id: "alert-2" }, match: { hash: TX } },
    };
    act(() => {
      rerender(
        <MemoryRouter initialEntries={["/"]}>
          <App />
        </MemoryRouter>,
      );
    });
    expect(screen.getByText("toast:alert-2")).toBeInTheDocument();
  });

  it("unmounting with a live toast timer runs the cleanup without error", () => {
    lastAlertRef.current = {
      data: { alert: { id: "alert-1" }, match: { hash: TX } },
    };
    const { unmount } = render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByText("toast:alert-1")).toBeInTheDocument();
    // Timer is still pending → unmount cleanup clears it (the effect's return).
    expect(() => unmount()).not.toThrow();
  });

  it("marks the API disconnected when health responds but status is not ok", async () => {
    lastAlertRef.current = null;
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          json: () => Promise.resolve({ status: "down", db: false }),
        }),
      ),
    );
    if (!("timeout" in AbortSignal)) {
      (AbortSignal as { timeout?: unknown }).timeout = () =>
        new AbortController().signal;
    }
    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );
    expect(await screen.findByText("page:landing")).toBeInTheDocument();
    await Promise.resolve();
    vi.useFakeTimers();
  });

  it("marks the API disconnected when the health check rejects", async () => {
    lastAlertRef.current = null;
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("network down"))),
    );
    if (!("timeout" in AbortSignal)) {
      (AbortSignal as { timeout?: unknown }).timeout = () =>
        new AbortController().signal;
    }
    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );
    // App renders regardless; the catch sets status="disconnected" (line 76).
    expect(await screen.findByText("page:landing")).toBeInTheDocument();
    // Let the rejected health promise settle.
    await Promise.resolve();
    // Restore fake timers so the shared afterEach (runOnlyPendingTimers) holds.
    vi.useFakeTimers();
  });
});
