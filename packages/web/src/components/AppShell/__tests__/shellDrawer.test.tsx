import { it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "../../../__tests__/_test-utils";
import AppShell from "../../AppShell";

// AppShell renders the real TopBar + Sidebar here (this test exercises the
// mobile drawer wiring end-to-end), so the wagmi-backed children are stubbed
// the same way TopBar.test.tsx / AppShell.test.tsx do — this is a shell-chrome
// test, not a wallet test, and a live WagmiProvider isn't otherwise needed.
vi.mock("../../wallet/WalletConnectButton", () => ({
  WalletConnectButton: () => <div>wallet</div>,
}));
vi.mock("../../wallet/WorkspaceSyncStatus", () => ({
  WorkspaceSyncStatus: () => <div>sync-status</div>,
}));
vi.mock("../../wallet/WorkspaceSyncAutoPush", () => ({
  WorkspaceSyncAutoPush: () => <div>auto-push</div>,
}));

// Force the mobile branch.
beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: true,
      addEventListener: () => {},
      removeEventListener: () => {},
    })),
  );
});

it("opens the drawer from the hamburger and closes on backdrop tap", () => {
  renderWithProviders(
    <AppShell apiStatus="connected">
      <div>content</div>
    </AppShell>,
  );
  fireEvent.click(screen.getByLabelText("Open menu"));
  // Backdrop is now present.
  const backdrop = screen.getByLabelText("Close menu");
  expect(backdrop).toBeInTheDocument();
  fireEvent.click(backdrop);
  expect(screen.queryByLabelText("Close menu")).not.toBeInTheDocument();
});
