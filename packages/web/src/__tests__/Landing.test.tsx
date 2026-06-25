import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "./_test-utils";
import Landing from "../components/Landing";

/**
 * Landing hub. Drives the hero search (recognized vs unrecognized input → the
 * warning hint), the chain-scoped route (?chainid), the live-stats tiles fed by
 * mocked summary/mempool queries, and the feature catalogue. RecentRail + API
 * are stubbed so this is a fast presentational test.
 *
 * Real PulseChain (369) anchors — https://scan.pulsechain.com:
 *   WPLS  0xa1077a294dde1b09bb078844df40758a5d0f9a27
 *   a 66-char tx hash + a block number for the search recognizer.
 */
const WPLS = "0xa1077a294dde1b09bb078844df40758a5d0f9a27";
const TX = "0x" + "ab".repeat(32);

const navigate = vi.fn();
vi.mock("react-router-dom", async (orig) => {
  const actual = await orig<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => navigate };
});
vi.mock("../components/RecentRail", () => ({
  RecentRail: () => <div>recent-rail</div>,
}));
const fetchLatestSummary = vi.fn();
const fetchPending = vi.fn();
vi.mock("../api/latest", () => ({
  fetchLatestSummary: (...a: unknown[]) => fetchLatestSummary(...a),
}));
vi.mock("../api/mempool", () => ({
  fetchPending: (...a: unknown[]) => fetchPending(...a),
}));

function search() {
  return screen.getByPlaceholderText(/Paste a tx hash, address, block/i);
}

describe("<Landing />", () => {
  beforeEach(() => {
    navigate.mockClear();
    fetchLatestSummary.mockReset().mockResolvedValue({
      latestBlock: { number: "19000000", transactionCount: 42 },
      gasPrice: { baseFeePerGas: "1000000000" },
    });
    fetchPending.mockReset().mockResolvedValue({ pendingCount: 7 });
  });

  it("renders the brand, the feature catalogue groups, and the recent rail", () => {
    renderWithProviders(<Landing />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Explore" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Inspect")).toBeInTheDocument();
    // "Simulate" appears as both a group heading and a feature card.
    expect(screen.getAllByText("Simulate").length).toBeGreaterThan(0);
    expect(screen.getByText("recent-rail")).toBeInTheDocument();
  });

  it("submitting a recognized tx hash navigates to its scan route", () => {
    renderWithProviders(<Landing />);
    fireEvent.change(search(), { target: { value: TX } });
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    expect(navigate).toHaveBeenCalledWith(`/tx/${TX}`);
  });

  it("scopes the route to ?chainid when a specific chain is picked", () => {
    renderWithProviders(<Landing />);
    // Open the chain selector and pick Ethereum (1).
    fireEvent.click(screen.getByRole("button", { name: /All chains/i }));
    fireEvent.click(screen.getByText("Ethereum"));

    fireEvent.change(search(), { target: { value: WPLS } });
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    expect(navigate).toHaveBeenCalledWith(`/address/${WPLS}?chainid=1`);
  });

  it("shows the warning hint for unrecognized input and does not navigate", () => {
    renderWithProviders(<Landing />);
    fireEvent.change(search(), { target: { value: "not-an-entity" } });
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    expect(screen.getByText(/Unrecognized —/)).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("typing after the hint clears it", () => {
    renderWithProviders(<Landing />);
    fireEvent.change(search(), { target: { value: "garbage" } });
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    expect(screen.getByText(/Unrecognized —/)).toBeInTheDocument();
    fireEvent.change(search(), { target: { value: "g" } });
    expect(screen.queryByText(/Unrecognized —/)).not.toBeInTheDocument();
  });

  it("submitting empty input neither navigates nor shows the hint", () => {
    renderWithProviders(<Landing />);
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.queryByText(/Unrecognized —/)).not.toBeInTheDocument();
  });

  it("a feature card sets/clears its accent box-shadow on hover", () => {
    renderWithProviders(<Landing />);
    // The Explorer feature card links to /explorer.
    const card = screen
      .getAllByText("Explorer")[0]!
      .closest('a[href="/explorer"]') as HTMLElement;
    fireEvent.mouseEnter(card);
    expect(card.style.boxShadow).toContain("inset");
    fireEvent.mouseLeave(card);
    expect(card.style.boxShadow).toBe("");
  });

  it("renders the live-stats tiles from the summary + mempool queries", async () => {
    renderWithProviders(<Landing />);
    await waitFor(() =>
      expect(screen.getByText("#19,000,000")).toBeInTheDocument(),
    );
    // 42 txs in the latest block; 7 pending in the mempool.
    expect(screen.getByText("42 txs")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("7")).toBeInTheDocument());
    expect(fetchLatestSummary).toHaveBeenCalledWith(369);
  });
});
