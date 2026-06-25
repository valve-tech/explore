import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderWithProviders } from "./_test-utils";
import { screen, fireEvent, waitFor, act, within } from "@testing-library/react";
import type { ForkInfo } from "../api/testnets";

/**
 * TestNetDashboard — lists Anvil forks of PulseChain (chain 369,
 * https://scan.pulsechain.com), polls every 15s, and expands a card into the
 * real ForkControls. We mock the whole testnets API (and the active chain used
 * by the create dialog) and drive the loading/empty/error/list branches.
 */

const listForks = vi.fn();
const getFork = vi.fn();
const createFork = vi.fn();
const destroyFork = vi.fn();
// The expanded card mounts ForkControls -> child panels; stub their calls too.
vi.mock("../api/testnets", () => ({
  listForks: (...a: unknown[]) => listForks(...a),
  getFork: (...a: unknown[]) => getFork(...a),
  createFork: (...a: unknown[]) => createFork(...a),
  destroyFork: (...a: unknown[]) => destroyFork(...a),
  takeSnapshot: vi.fn(),
  revertSnapshot: vi.fn(),
  fundAddress: vi.fn(),
  mineBlocks: vi.fn(),
  timeTravel: vi.fn(),
}));
vi.mock("../lib/activeChain", () => ({ useActiveChainId: () => 369 }));

import TestNetDashboard from "../components/testnets/TestNetDashboard";

const FORK: ForkInfo = {
  id: "fork-abc123",
  port: 8545,
  rpcUrl: "http://localhost:10100/api/testnets/fork-abc123/rpc",
  blockNumber: 23000000,
  label: "Whale fork",
  createdAt: new Date(Date.now() - 5000).toISOString(),
  pid: 4242,
  currentBlock: 23000010,
  chainId: 369,
};

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.useRealTimers());

describe("TestNetDashboard", () => {
  it("shows the spinner while loading then the empty state", async () => {
    listForks.mockResolvedValue([]);
    const { container } = renderWithProviders(<TestNetDashboard />);
    expect(container.querySelector(".spinner")).toBeTruthy();
    await screen.findByText("No active testnets");
  });

  it("renders an error state when listForks rejects", async () => {
    listForks.mockRejectedValue(new Error("anvil supervisor down"));
    renderWithProviders(<TestNetDashboard />);
    await screen.findByText("anvil supervisor down");
  });

  it("uses the generic message for a non-Error list rejection", async () => {
    listForks.mockRejectedValue("boom");
    renderWithProviders(<TestNetDashboard />);
    await screen.findByText("Failed to load testnets");
  });

  it("lists forks with formatted block numbers and port", async () => {
    listForks.mockResolvedValue([FORK]);
    renderWithProviders(<TestNetDashboard />);
    await screen.findByText("Whale fork");
    expect(screen.getByText("23,000,000")).toBeTruthy(); // fork block
    expect(screen.getByText("23,000,010")).toBeTruthy(); // current block
    expect(screen.getByText("Port: 8545")).toBeTruthy();
  });

  it("expands a card into ForkControls and collapses again", async () => {
    listForks.mockResolvedValue([FORK]);
    renderWithProviders(<TestNetDashboard />);
    const header = await screen.findByText("Whale fork");

    fireEvent.click(header);
    await screen.findByText("RPC Endpoint");
    expect(screen.getByText("Forked from")).toBeTruthy();

    // Click again to collapse.
    fireEvent.click(header);
    await waitFor(() =>
      expect(screen.queryByText("RPC Endpoint")).toBeNull(),
    );
  });

  it("polls every 15s, refreshing the list", async () => {
    vi.useFakeTimers();
    listForks.mockResolvedValue([]);
    renderWithProviders(<TestNetDashboard />);
    await vi.waitFor(() => expect(listForks).toHaveBeenCalledTimes(1));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(listForks).toHaveBeenCalledTimes(2);
  });

  it("opens the create dialog and adds the new fork, expanded", async () => {
    listForks.mockResolvedValue([]);
    createFork.mockResolvedValue(FORK);
    renderWithProviders(<TestNetDashboard />);
    await screen.findByText("No active testnets");

    // The empty-state CTA opens the dialog.
    fireEvent.click(
      screen.getByRole("button", { name: "+ Create Your First TestNet" }),
    );
    await screen.findByText("Create Virtual TestNet");

    fireEvent.click(screen.getByRole("button", { name: "Create TestNet" }));
    // New fork appears as a card, auto-expanded into its controls.
    await screen.findByText("Whale fork");
    await screen.findByText("RPC Endpoint");
  });

  it("header CTA also opens the dialog (then cancel closes it)", async () => {
    listForks.mockResolvedValue([]);
    renderWithProviders(<TestNetDashboard />);
    await screen.findByText("No active testnets");

    fireEvent.click(screen.getByRole("button", { name: "+ Create TestNet" }));
    const dialogHeading = await screen.findByText("Create Virtual TestNet");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(dialogHeading).not.toBeInTheDocument());
  });

  it("renders 'latest' for a latest-block fork and omits current block when null", async () => {
    listForks.mockResolvedValue([
      { ...FORK, blockNumber: "latest", currentBlock: null },
    ]);
    renderWithProviders(<TestNetDashboard />);
    await screen.findByText("Whale fork");
    const card = screen.getByText("Whale fork").closest("button") as HTMLElement;
    expect(within(card).getByText("latest")).toBeTruthy();
    expect(within(card).queryByText(/Current Block/)).toBeNull();
  });

  it("refreshes a single fork via getFork after a control action", async () => {
    listForks.mockResolvedValue([FORK]);
    getFork.mockResolvedValue({ ...FORK, currentBlock: 23000099 });
    renderWithProviders(<TestNetDashboard />);
    fireEvent.click(await screen.findByText("Whale fork"));

    // Mine triggers onRefresh -> refreshFork -> getFork(id).
    fireEvent.click(await screen.findByRole("button", { name: "Mine" }));
    await waitFor(() => expect(getFork).toHaveBeenCalledWith(FORK.id));
    await screen.findByText("23,000,099");
  });

  it("re-lists when a single-fork refresh fails (fork gone)", async () => {
    listForks.mockResolvedValue([FORK]);
    getFork.mockRejectedValue(new Error("fork not found"));
    renderWithProviders(<TestNetDashboard />);
    fireEvent.click(await screen.findByText("Whale fork"));
    await vi.waitFor(() => expect(listForks).toHaveBeenCalledTimes(1));

    fireEvent.click(await screen.findByRole("button", { name: "Mine" }));
    // getFork rejects -> refreshFork catch -> fetchForks() re-fetches the list.
    await waitFor(() => expect(getFork).toHaveBeenCalled());
    await waitFor(() => expect(listForks).toHaveBeenCalledTimes(2));
  });

  it("formats relative ages across the s / m / h branches", async () => {
    listForks.mockResolvedValue([
      { ...FORK, id: "f-s", label: "Seconds fork", createdAt: new Date(Date.now() - 5_000).toISOString() },
      { ...FORK, id: "f-m", label: "Minutes fork", createdAt: new Date(Date.now() - 5 * 60_000).toISOString() },
      { ...FORK, id: "f-h", label: "Hours fork", createdAt: new Date(Date.now() - (2 * 3600 + 15 * 60) * 1000).toISOString() },
    ]);
    renderWithProviders(<TestNetDashboard />);
    await screen.findByText("Seconds fork");
    expect(screen.getByText("5s ago")).toBeTruthy();
    expect(screen.getByText("5m ago")).toBeTruthy();
    expect(screen.getByText("2h 15m ago")).toBeTruthy();
  });

  it("removes a destroyed fork from the list", async () => {
    listForks.mockResolvedValue([FORK]);
    destroyFork.mockResolvedValue(undefined);
    renderWithProviders(<TestNetDashboard />);
    fireEvent.click(await screen.findByText("Whale fork"));

    fireEvent.click(await screen.findByRole("button", { name: "Destroy TestNet" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, Destroy" }));

    await waitFor(() => expect(destroyFork).toHaveBeenCalledWith(FORK.id));
    // handleDestroyed filters the fork out + collapses -> empty state returns.
    await screen.findByText("No active testnets");
  });

  it("only updates the matching fork on refresh, leaving siblings intact", async () => {
    const other: ForkInfo = { ...FORK, id: "f-other", label: "Other fork", currentBlock: 100 };
    listForks.mockResolvedValue([FORK, other]);
    getFork.mockResolvedValue({ ...FORK, currentBlock: 23000099 });
    renderWithProviders(<TestNetDashboard />);

    // Expand only the first card, then mine to refresh just that one.
    fireEvent.click(await screen.findByText("Whale fork"));
    fireEvent.click(await screen.findByRole("button", { name: "Mine" }));

    await waitFor(() => expect(getFork).toHaveBeenCalledWith(FORK.id));
    await screen.findByText("23,000,099");
    // The sibling's current block is untouched (false branch of the map ternary).
    expect(screen.getByText("100")).toBeTruthy();
  });

  it("leaves the other fork in place when one of two is destroyed", async () => {
    const other: ForkInfo = { ...FORK, id: "f-other", label: "Other fork" };
    listForks.mockResolvedValue([FORK, other]);
    destroyFork.mockResolvedValue(undefined);
    renderWithProviders(<TestNetDashboard />);

    fireEvent.click(await screen.findByText("Whale fork"));
    fireEvent.click(await screen.findByRole("button", { name: "Destroy TestNet" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, Destroy" }));

    await waitFor(() => expect(destroyFork).toHaveBeenCalledWith(FORK.id));
    // The surviving fork keeps the list non-empty.
    await waitFor(() => expect(screen.queryByText("Whale fork")).toBeNull());
    expect(screen.getByText("Other fork")).toBeTruthy();
    expect(screen.queryByText("No active testnets")).toBeNull();
  });
});
