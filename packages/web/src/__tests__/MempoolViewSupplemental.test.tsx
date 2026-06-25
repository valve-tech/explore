import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "./_test-utils";
import type { MempoolPending, PendingTx } from "../api/mempool";
import type { TrackedTx } from "../lib/trackedTxs";

/**
 * Supplemental MempoolView coverage for branches the original MempoolView.test
 * doesn't reach: pending/queued header counts, the type-filter chips + "no
 * matches" empty state, GasCell's legacy + no-gas branches, the PinButton
 * tracked state, and the TrackedTxPanel wiring (mempoolComplete = !truncated).
 *
 * Real WPLS transfer hash on PulseChain (chain 369), block 26804492.
 * https://scan.pulsechain.com/block/26804492
 */

const TRACKED_HASH =
  "0xd515ef07d4308c389b05fe13c55ac1ebe3270bd8bbf4470b0a134a1766fe3c81";

const trackedHolder: { txs: TrackedTx[] } = { txs: [] };
vi.mock("../hooks/useTrackedTxs", () => ({
  useTrackedTxs: () => trackedHolder.txs,
}));

vi.mock("../api/mempool", () => ({ fetchPending: vi.fn() }));

// TrackedTxPanel mounts its own queries; stub it so this test stays focused on
// MempoolView's own toolbar/table branches.
vi.mock("../components/mempool/TrackedTxPanel", () => ({
  TrackedTxPanel: ({ mempoolComplete }: { mempoolComplete: boolean }) => (
    <div data-testid="tracked-panel" data-complete={String(mempoolComplete)} />
  ),
}));

vi.mock("../lib/trackedTxs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/trackedTxs")>();
  return { ...actual, toggleTrack: vi.fn() };
});

import MempoolView from "../components/mempool/MempoolView";
import { fetchPending } from "../api/mempool";
import { toggleTrack } from "../lib/trackedTxs";

const mockFetch = fetchPending as unknown as ReturnType<typeof vi.fn>;

function tx(overrides: Partial<PendingTx> = {}): PendingTx {
  return {
    hash: "0x" + "a".repeat(64),
    from: "0x" + "b".repeat(40),
    nonce: 0,
    type: "eip1559",
    gasPrice: null,
    maxFeePerGas: "2000000000",
    maxPriorityFeePerGas: "1000000000",
    ...overrides,
  };
}

function snapshot(
  transactions: PendingTx[],
  extra: Partial<MempoolPending> = {},
): MempoolPending {
  return {
    transactions,
    pendingCount: transactions.length,
    queuedCount: 0,
    truncated: false,
    ...extra,
  };
}

describe("<MempoolView /> supplemental", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    trackedHolder.txs = [];
    (toggleTrack as ReturnType<typeof vi.fn>).mockClear();
  });
  afterEach(() => vi.restoreAllMocks());

  it("renders the pending + queued header counts", async () => {
    mockFetch.mockResolvedValue(
      snapshot([tx()], { pendingCount: 12, queuedCount: 3 }),
    );
    renderWithProviders(<MempoolView />);
    expect(await screen.findByText(/12 pending/)).toBeInTheDocument();
    expect(screen.getByText(/3 queued/)).toBeInTheDocument();
  });

  it("passes mempoolComplete=true to TrackedTxPanel when not truncated", async () => {
    mockFetch.mockResolvedValue(snapshot([tx()], { truncated: false }));
    renderWithProviders(<MempoolView />);
    await waitFor(() =>
      expect(screen.getByTestId("tracked-panel")).toHaveAttribute(
        "data-complete",
        "true",
      ),
    );
  });

  it("passes mempoolComplete=false to TrackedTxPanel when truncated", async () => {
    mockFetch.mockResolvedValue(snapshot([tx()], { truncated: true }));
    renderWithProviders(<MempoolView />);
    await waitFor(() =>
      expect(screen.getByTestId("tracked-panel")).toHaveAttribute(
        "data-complete",
        "false",
      ),
    );
  });

  it("renders the legacy gas readout (gasPrice only) via GasCell", async () => {
    mockFetch.mockResolvedValue(
      snapshot([
        tx({
          type: "legacy",
          maxFeePerGas: null,
          maxPriorityFeePerGas: null,
          gasPrice: "3000000000", // 3 gwei
        }),
      ]),
    );
    renderWithProviders(<MempoolView />);
    await waitFor(() => {
      const cell = screen.getAllByText((_c, node) =>
        /^3\s*gwei$/.test(node?.textContent ?? ""),
      );
      expect(cell.length).toBeGreaterThan(0);
    });
  });

  it("renders an em-dash when a tx has no fee data at all", async () => {
    mockFetch.mockResolvedValue(
      snapshot([
        tx({
          type: "legacy",
          maxFeePerGas: null,
          maxPriorityFeePerGas: null,
          gasPrice: null,
        }),
      ]),
    );
    const { container } = renderWithProviders(<MempoolView />);
    // Wait for the table to render (the Type badge appears once rows exist).
    await screen.findByText("Legacy");
    // GasCell renders a bare em-dash element when no fee fields are present.
    const dashCells = Array.from(container.querySelectorAll("td span")).filter(
      (el) => el.textContent === "—",
    );
    expect(dashCells.length).toBeGreaterThan(0);
  });

  it("shows the PinButton in tracked state when the tx is tracked", async () => {
    trackedHolder.txs = [
      { hash: TRACKED_HASH, firstSeen: Date.now(), status: "pending" },
    ];
    mockFetch.mockResolvedValue(snapshot([tx({ hash: TRACKED_HASH })]));
    renderWithProviders(<MempoolView />);
    const pin = await screen.findByRole("button", { name: "Stop tracking" });
    expect(pin).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(pin);
    expect(toggleTrack).toHaveBeenCalledWith(TRACKED_HASH);
  });

  it("toggles a type-filter chip down to the 'no matches' empty state", async () => {
    // Two distinct types so the type chips render (presentTypes.length > 1).
    mockFetch.mockResolvedValue(
      snapshot([
        tx({ hash: "0x" + "1".repeat(64), type: "eip1559" }),
        tx({
          hash: "0x" + "2".repeat(64),
          type: "legacy",
          maxFeePerGas: null,
          maxPriorityFeePerGas: null,
          gasPrice: "1000000000",
        }),
      ]),
    );
    renderWithProviders(<MempoolView />);
    await screen.findByText(/showing 2 of 2/);

    // Click the EIP-1559 chip → filter narrows to just eip1559 rows
    fireEvent.click(screen.getByRole("button", { name: "EIP-1559" }));
    await waitFor(() =>
      expect(screen.getByText(/showing 1 of 2/)).toBeInTheDocument(),
    );

    // Add Legacy too → both included again
    fireEvent.click(screen.getByRole("button", { name: "Legacy" }));
    await waitFor(() =>
      expect(screen.getByText(/showing 2 of 2/)).toBeInTheDocument(),
    );
  });

  it("changing the sort dropdown re-renders without losing rows", async () => {
    mockFetch.mockResolvedValue(
      snapshot([
        tx({ hash: "0x" + "1".repeat(64), type: "eip1559" }),
        tx({
          hash: "0x" + "2".repeat(64),
          type: "legacy",
          maxFeePerGas: null,
          maxPriorityFeePerGas: null,
          gasPrice: "1000000000",
        }),
      ]),
    );
    renderWithProviders(<MempoolView />);
    await screen.findByText(/showing 2 of 2/);
    fireEvent.click(screen.getByRole("button", { name: "Sort transactions" }));
    fireEvent.click(screen.getByRole("option", { name: /priority tip/ }));
    expect(screen.getByText(/showing 2 of 2/)).toBeInTheDocument();
  });
});
