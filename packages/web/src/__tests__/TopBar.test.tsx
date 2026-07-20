import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "./_test-utils";
import { TopBar } from "../components/AppShell/TopBar";

/**
 * App-shell top bar. Drives the collapse toggle, the ⌘K palette opener, the
 * three apiStatus → label mappings, and the back-disabled state derived from
 * history.state.idx. Heavy wallet / sync children are stubbed so this stays a
 * focused chrome test.
 */
vi.mock("../components/wallet/WalletConnectButton", () => ({
  WalletConnectButton: () => <div>wallet</div>,
}));
vi.mock("../components/wallet/WorkspaceSyncStatus", () => ({
  WorkspaceSyncStatus: () => <div>sync-status</div>,
}));
vi.mock("../components/wallet/WorkspaceSyncAutoPush", () => ({
  WorkspaceSyncAutoPush: () => <div>auto-push</div>,
}));
vi.mock("../components/settings/RpcSourceChip", () => ({
  RpcSourceChip: () => <div>rpc-chip</div>,
}));
vi.mock("../hooks/useRecentEntities", () => ({
  useRecentEntities: () => [],
}));

function baseProps() {
  return {
    collapsed: false,
    onToggleCollapse: vi.fn(),
    onOpenDrawer: vi.fn(),
    onOpenPalette: vi.fn(),
    apiStatus: "connected" as const,
  };
}

describe("<TopBar />", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders the brand + ⌘K search affordance and opens the palette", () => {
    const props = baseProps();
    renderWithProviders(<TopBar {...props} />);
    expect(screen.getByText("Explore")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", {
        name: /Paste a tx hash, address, block, or function selector/i,
      }),
    );
    expect(props.onOpenPalette).toHaveBeenCalled();
  });

  it("the collapse toggle fires onToggleCollapse and flips its aria-label", () => {
    const props = baseProps();
    const { rerender } = renderWithProviders(<TopBar {...props} />);
    const collapseBtn = screen.getByRole("button", {
      name: "Collapse sidebar",
    });
    fireEvent.click(collapseBtn);
    expect(props.onToggleCollapse).toHaveBeenCalled();

    rerender(<TopBar {...props} collapsed />);
    expect(
      screen.getByRole("button", { name: "Expand sidebar" }),
    ).toBeInTheDocument();
  });

  it("maps each apiStatus to its status label", () => {
    const props = baseProps();
    const { rerender } = renderWithProviders(<TopBar {...props} />);
    expect(screen.getByText("Connected")).toBeInTheDocument();

    rerender(<TopBar {...props} apiStatus="disconnected" />);
    expect(screen.getByText("Disconnected")).toBeInTheDocument();

    rerender(<TopBar {...props} apiStatus="checking" />);
    expect(screen.getByText("Checking…")).toBeInTheDocument();
  });

  it("the back button goes back through history when history depth > 0", () => {
    // canGoBack derives from window.history.state.idx; seed a non-zero idx so
    // the back affordance is enabled and clicking it calls navigate(-1).
    window.history.pushState({ idx: 1 }, "");
    renderWithProviders(<TopBar {...baseProps()} />);
    const back = screen.getByRole("button", { name: "Go back" });
    expect(back).toBeEnabled();
    fireEvent.click(back);
    // navigate(-1) routes back; no throw + the bar still renders.
    expect(screen.getByText("Explore")).toBeInTheDocument();
    window.history.replaceState({ idx: 0 }, "");
  });

  it("links to Valve City and renders the stubbed right-rail widgets", () => {
    renderWithProviders(<TopBar {...baseProps()} />);
    expect(
      screen.getByRole("link", { name: "Valve City" }),
    ).toHaveAttribute("href", "https://valve.city");
    expect(screen.getByText("wallet")).toBeInTheDocument();
    expect(screen.getByText("rpc-chip")).toBeInTheDocument();
  });
});
