import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "./_test-utils";
import type { TrackedTx } from "../lib/trackedTxs";

/**
 * TrackedTxPanel — watches pinned txs through pending → mined / dropped.
 * The tracked store hook is mocked with fixtures; fetchTransaction is mocked so
 * the resolution effect can be driven deterministically. lib/trackedTxs mutators
 * are spied so we assert resolveTracked / untrack / clear fire.
 *
 * Real tx hash: a WPLS transfer on PulseChain (chain 369), block 26804492.
 * https://scan.pulsechain.com/block/26804492
 */

const HASH = "0xd515ef07d4308c389b05fe13c55ac1ebe3270bd8bbf4470b0a134a1766fe3c81";

const trackedHolder: { txs: TrackedTx[] } = { txs: [] };
vi.mock("../hooks/useTrackedTxs", () => ({
  useTrackedTxs: () => trackedHolder.txs,
}));

vi.mock("../api/explorer", () => ({
  fetchTransaction: vi.fn(),
}));

vi.mock("../lib/trackedTxs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/trackedTxs")>();
  return {
    ...actual,
    resolveTracked: vi.fn(),
    untrackTx: vi.fn(),
    clearResolved: vi.fn(),
  };
});

import {
  TrackedTxPanel,
  NoTrackedTxs,
} from "../components/mempool/TrackedTxPanel";
import { fetchTransaction } from "../api/explorer";
import { resolveTracked, untrackTx, clearResolved } from "../lib/trackedTxs";

const mockFetch = fetchTransaction as unknown as ReturnType<typeof vi.fn>;

function track(overrides: Partial<TrackedTx> = {}): TrackedTx {
  return {
    hash: HASH,
    firstSeen: Date.now(),
    status: "pending",
    ...overrides,
  };
}

const noop = () => {};

describe("<TrackedTxPanel />", () => {
  beforeEach(() => {
    trackedHolder.txs = [];
    mockFetch.mockReset();
    mockFetch.mockImplementation(() => new Promise(() => {})); // default: never resolves
    (resolveTracked as ReturnType<typeof vi.fn>).mockClear();
    (untrackTx as ReturnType<typeof vi.fn>).mockClear();
    (clearResolved as ReturnType<typeof vi.fn>).mockClear();
  });
  afterEach(() => vi.restoreAllMocks());

  it("renders nothing when no txs are tracked", () => {
    const { container } = renderWithProviders(
      <TrackedTxPanel
        pendingHashes={new Set()}
        mempoolComplete
        onNavigate={noop}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders a pending row with the Pending badge and tracked count", () => {
    trackedHolder.txs = [track()];
    renderWithProviders(
      <TrackedTxPanel
        pendingHashes={new Set([HASH.toLowerCase()])}
        mempoolComplete={false}
        onNavigate={noop}
      />,
    );
    expect(screen.getByText("Tracked transactions")).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("shows 'Clear resolved' once a tx has resolved, and calls clearResolved", () => {
    trackedHolder.txs = [
      track({ status: "mined", blockNumber: "26804492", resolvedAt: Date.now() }),
    ];
    renderWithProviders(
      <TrackedTxPanel
        pendingHashes={new Set()}
        mempoolComplete
        onNavigate={noop}
      />,
    );
    const clear = screen.getByRole("button", { name: /Clear resolved/i });
    fireEvent.click(clear);
    expect(clearResolved).toHaveBeenCalled();
  });

  it("renders the Mined badge + 'took' label + block link for a mined success", () => {
    trackedHolder.txs = [
      track({
        status: "mined",
        execStatus: "success",
        blockNumber: "26804492",
        resolvedAt: Date.now(),
      }),
    ];
    renderWithProviders(
      <TrackedTxPanel
        pendingHashes={new Set()}
        mempoolComplete
        onNavigate={noop}
      />,
    );
    expect(screen.getByText("Mined")).toBeInTheDocument();
    expect(screen.getByText(/block #26,804,492/)).toBeInTheDocument();
    expect(screen.getByText(/took/)).toBeInTheDocument();
  });

  it("renders the Reverted badge for a mined-but-reverted tx", () => {
    trackedHolder.txs = [
      track({ status: "mined", execStatus: "reverted", blockNumber: "26804492" }),
    ];
    renderWithProviders(
      <TrackedTxPanel
        pendingHashes={new Set()}
        mempoolComplete
        onNavigate={noop}
      />,
    );
    expect(screen.getByText("Reverted")).toBeInTheDocument();
  });

  it("renders the Dropped badge for a dropped tx", () => {
    trackedHolder.txs = [track({ status: "dropped" })];
    renderWithProviders(
      <TrackedTxPanel
        pendingHashes={new Set()}
        mempoolComplete
        onNavigate={noop}
      />,
    );
    expect(screen.getByText("Dropped")).toBeInTheDocument();
  });

  it("calls untrackTx when the stop-tracking button is clicked", () => {
    trackedHolder.txs = [track()];
    renderWithProviders(
      <TrackedTxPanel
        pendingHashes={new Set([HASH.toLowerCase()])}
        mempoolComplete={false}
        onNavigate={noop}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Stop tracking" }));
    expect(untrackTx).toHaveBeenCalledWith(HASH);
  });

  it("resolves a pending tx to mined when the lookup returns a real outcome", async () => {
    trackedHolder.txs = [track()];
    mockFetch.mockResolvedValue({
      hash: HASH,
      blockNumber: "26804492",
      status: "success",
    });
    renderWithProviders(
      <TrackedTxPanel
        pendingHashes={new Set([HASH.toLowerCase()])}
        mempoolComplete={false}
        onNavigate={noop}
      />,
    );
    await waitFor(() =>
      expect(resolveTracked).toHaveBeenCalledWith(HASH, {
        status: "mined",
        blockNumber: "26804492",
        execStatus: "success",
      }),
    );
  });

  it("marks a still-pending, gone, expired tx as dropped from a complete mempool", async () => {
    // firstSeen well past the 90s grace window, absent from pendingHashes,
    // mempool complete → dropped.
    trackedHolder.txs = [track({ firstSeen: Date.now() - 200_000 })];
    mockFetch.mockResolvedValue({
      hash: HASH,
      blockNumber: "pending",
      status: "pending",
    });
    renderWithProviders(
      <TrackedTxPanel
        pendingHashes={new Set()} // gone
        mempoolComplete
        onNavigate={noop}
      />,
    );
    await waitFor(() =>
      expect(resolveTracked).toHaveBeenCalledWith(HASH, { status: "dropped" }),
    );
  });

  it("formats an hours-long elapsed time on a resolved row (h:mm:ss)", () => {
    const firstSeen = Date.now() - 3_661_000; // 1h 1m 1s
    trackedHolder.txs = [
      track({
        status: "mined",
        execStatus: "success",
        blockNumber: "26804492",
        firstSeen,
        resolvedAt: firstSeen + 3_661_000,
      }),
    ];
    renderWithProviders(
      <TrackedTxPanel
        pendingHashes={new Set()}
        mempoolComplete
        onNavigate={noop}
      />,
    );
    expect(screen.getByText(/took\s*1:01:01/)).toBeInTheDocument();
  });

  it("NoTrackedTxs renders the empty-state copy", () => {
    renderWithProviders(<NoTrackedTxs />);
    expect(
      screen.getByText("No tracked transactions"),
    ).toBeInTheDocument();
  });

  it("does NOT drop a pending tx that is still within the grace window", async () => {
    trackedHolder.txs = [track({ firstSeen: Date.now() })]; // fresh
    mockFetch.mockRejectedValue(new Error("not found"));
    renderWithProviders(
      <TrackedTxPanel
        pendingHashes={new Set()}
        mempoolComplete
        onNavigate={noop}
      />,
    );
    // give the effect a tick
    await new Promise((r) => setTimeout(r, 0));
    expect(resolveTracked).not.toHaveBeenCalledWith(HASH, { status: "dropped" });
  });
});
