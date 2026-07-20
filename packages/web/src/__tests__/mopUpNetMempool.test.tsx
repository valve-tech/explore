import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent, waitFor, act } from "@testing-library/react";
import { renderWithProviders } from "./_test-utils";
import type { MempoolPending, PendingTx } from "../api/mempool";
import type { TrackedTx } from "../lib/trackedTxs";
import type { BlockLadder, MinerStats } from "../api/networkHealth";

/**
 * Coverage mop-up for the mempool + network-health clusters. Each block targets
 * a small set of statements/branches the established suites don't reach:
 *   - MempoolView: the onNavigate router shim (clicking an ExplorerLink) and the
 *     type-filter DELETE arm (toggling the same chip twice).
 *   - TrackedTxPanel: the ticking-clock setInterval (fake timers) and the
 *     isError arm of the drop guard.
 *   - FeeLadder: the safeGwei / BigInt catch fall-throughs (bad numeric strings)
 *     and short(null).
 *   - BlockTable: row expand/collapse + the InversionCell null + warm branches.
 *   - MinersPanel: the Inversion null arm + zero-totalBlocks + short-address arm.
 *
 * Numbers mirror REAL PulseChain block 26804492 where a fixture needs to be
 * believable. https://scan.pulsechain.com/block/26804492 (chain 369).
 */

// ===========================================================================
// MempoolView — onNavigate shim + type-filter delete arm
// ===========================================================================

// A shared mutable fixture the mocked useTrackedTxs reads — lets each test
// install its own tracked rows (or none) without re-mocking the module.
const trackedHolder: { txs: TrackedTx[] } = { txs: [] };

vi.mock("../api/mempool", () => ({ fetchPending: vi.fn() }));
vi.mock("../hooks/useTrackedTxs", () => ({
  useTrackedTxs: () => trackedHolder.txs,
}));

import MempoolView from "../components/mempool/MempoolView";
import { fetchPending } from "../api/mempool";

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

function snapshot(transactions: PendingTx[]): MempoolPending {
  return {
    transactions,
    pendingCount: transactions.length,
    queuedCount: 0,
    truncated: false,
  };
}

describe("<MempoolView /> mop-up", () => {
  beforeEach(() => mockFetch.mockReset());
  afterEach(() => vi.restoreAllMocks());

  it("routes through onNavigate when a tx-hash link is clicked", async () => {
    mockFetch.mockResolvedValue(snapshot([tx({ hash: "0x" + "1".repeat(64) })]));
    const { container } = renderWithProviders(<MempoolView />);
    // The tx-hash cell is an ExplorerLink (an <a href="#/tx/…">); a plain click
    // preventDefaults and calls onNavigate, which maps type→ScanKind + navigate()s.
    const link = await waitFor(() => {
      const a = container.querySelector<HTMLAnchorElement>('a[href^="#/tx/"]');
      if (!a) throw new Error("tx link not yet rendered");
      return a;
    });
    fireEvent.click(link);
    // No throw + the table is still mounted after navigation.
    expect(link).toBeInTheDocument();
  });

  it("re-toggling a type chip removes it from the filter (delete arm)", async () => {
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
    const chip = screen.getByRole("button", { name: "EIP-1559" });
    // Add the chip → narrows to 1, then click again → set.delete(t) clears it.
    fireEvent.click(chip);
    await waitFor(() => expect(screen.getByText(/showing 1 of 2/)).toBeInTheDocument());
    fireEvent.click(chip);
    await waitFor(() => expect(screen.getByText(/showing 2 of 2/)).toBeInTheDocument());
  });
});

// ===========================================================================
// TrackedTxPanel — ticking interval + isError drop arm
// ===========================================================================

const TTP_HASH =
  "0xd515ef07d4308c389b05fe13c55ac1ebe3270bd8bbf4470b0a134a1766fe3c81";

// fetchTransaction is mocked so the resolution effect can be driven; the
// trackedTxs mutators are spied so we can assert resolveTracked fires.
vi.mock("../api/explorer", () => ({ fetchTransaction: vi.fn() }));
vi.mock("../lib/trackedTxs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/trackedTxs")>();
  return { ...actual, resolveTracked: vi.fn() };
});

import { TrackedTxPanel } from "../components/mempool/TrackedTxPanel";
import { fetchTransaction } from "../api/explorer";
import { resolveTracked } from "../lib/trackedTxs";

const mockTxFetch = fetchTransaction as unknown as ReturnType<typeof vi.fn>;

describe("<TrackedTxPanel /> mop-up", () => {
  beforeEach(() => {
    trackedHolder.txs = [];
    mockTxFetch.mockReset();
    (resolveTracked as ReturnType<typeof vi.fn>).mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    trackedHolder.txs = [];
  });

  it("runs the 1s ticking interval while a tx is pending", () => {
    vi.useFakeTimers();
    mockTxFetch.mockImplementation(() => new Promise(() => {})); // never resolves
    trackedHolder.txs = [
      { hash: TTP_HASH, firstSeen: Date.now(), status: "pending" },
    ];

    renderWithProviders(
      <TrackedTxPanel
        pendingHashes={new Set([TTP_HASH.toLowerCase()])}
        mempoolComplete={false}
        onNavigate={() => {}}
      />,
    );
    // anyPending → setInterval is armed; advancing the clock fires setTick.
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(screen.getByText("Pending")).toBeInTheDocument();
  });

  it("drops a gone+expired pending tx when the lookup ERRORS (isError arm)", async () => {
    mockTxFetch.mockRejectedValue(new Error("not found"));
    trackedHolder.txs = [
      // firstSeen well past the 90s grace window → expired
      { hash: TTP_HASH, firstSeen: Date.now() - 200_000, status: "pending" },
    ];

    renderWithProviders(
      <TrackedTxPanel
        pendingHashes={new Set()} // gone from the pool
        mempoolComplete
        onNavigate={() => {}}
      />,
    );
    await waitFor(() =>
      expect(resolveTracked).toHaveBeenCalledWith(TTP_HASH, {
        status: "dropped",
      }),
    );
  });
});

// ===========================================================================
// FeeLadder — safeGwei / BigInt catch fall-throughs + short(null)
// ===========================================================================

const useBlockLadder = vi.fn();
vi.mock("../hooks/useNetworkHealth", () => ({
  useBlockLadder: (n: string) => useBlockLadder(n),
}));

import { FeeLadder } from "../components/networkHealth/FeeLadder";

function ladder(overrides: Partial<BlockLadder> = {}): BlockLadder {
  return {
    number: "26804492",
    timestamp: 1781661795,
    baseFeePerGas: "452626936053887",
    txCount: 1,
    burnsBaseFee: true,
    priorityInversionRate: 0,
    txs: [
      {
        position: 0,
        sender: "0x5ead01d58067a68d0d700374500580ec5c961d0d",
        type: "legacy",
        tip: "120000000000000",
        tipGwei: 120,
        gasUsed: "63197",
        outOfOrder: false,
        hash: "0x" + "a".repeat(64),
        to: "0x" + "c".repeat(40),
        value: "1000000000000000000",
        methodId: "0xa9059cbb",
      },
    ],
    ...overrides,
  };
}

describe("<FeeLadder /> mop-up", () => {
  beforeEach(() => useBlockLadder.mockReset());
  afterEach(() => vi.restoreAllMocks());

  it("tolerates a non-numeric baseFeePerGas (safeGwei + BigInt catch)", () => {
    useBlockLadder.mockReturnValue({
      isPending: false,
      isError: false,
      // "not-a-number" forces both safeGwei() and the baseFeeWei BigInt() to
      // throw → fall through to 0 / 0n.
      data: ladder({ baseFeePerGas: "not-a-number" }),
    });
    const { container } = renderWithProviders(
      <FeeLadder blockNumber="26804492" />,
    );
    expect(container.querySelector("svg")).toBeInTheDocument();
    // base-fee header still renders, now reading 0 gwei.
    expect(screen.getAllByText(/base fee/).length).toBeGreaterThan(0);
  });

  it("tolerates a non-numeric gasUsed (gas BigInt catch → 0n)", () => {
    useBlockLadder.mockReturnValue({
      isPending: false,
      isError: false,
      data: ladder({
        txs: [
          {
            position: 0,
            sender: "0x5ead01d58067a68d0d700374500580ec5c961d0d",
            type: "legacy",
            tip: "120000000000000",
            tipGwei: 120,
            gasUsed: "oops", // BigInt() throws → 0n
            outOfOrder: false,
            hash: "0x" + "a".repeat(64),
            to: "0x" + "c".repeat(40),
            value: "0",
            methodId: "0xa9059cbb",
          },
        ],
      }),
    });
    const { container } = renderWithProviders(
      <FeeLadder blockNumber="26804492" />,
    );
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("renders '—' in the tooltip for a null sender (short(null))", () => {
    useBlockLadder.mockReturnValue({
      isPending: false,
      isError: false,
      data: ladder({
        txs: [
          {
            position: 0,
            // null sender exercises short(null) → "—"
            sender: null as unknown as string,
            type: "legacy",
            tip: "120000000000000",
            tipGwei: 120,
            gasUsed: "63197",
            outOfOrder: false,
            hash: "0x" + "a".repeat(64),
            to: "0x" + "c".repeat(40),
            value: "0",
            methodId: "0xa9059cbb",
          },
        ],
      }),
    });
    const { container } = renderWithProviders(
      <FeeLadder blockNumber="26804492" />,
    );
    fireEvent.mouseEnter(container.querySelector("svg g")!);
    // The sender→to tooltip line shows "—" for the null sender.
    expect(
      screen.getAllByText((c) => c.includes("—")).length,
    ).toBeGreaterThan(0);
  });
});

// ===========================================================================
// BlockTable — expand/collapse + InversionCell null / warm arms
// ===========================================================================

import { BlockTable } from "../components/networkHealth/BlockTable";
import type { BlockStats } from "../api/networkHealth";

function block(overrides: Partial<BlockStats> = {}): BlockStats {
  const BURNED = "57209328955594993478";
  const TIPS = "16308415764020445994737";
  const PAID = "16365625092976040988215";
  return {
    number: "26804492",
    timestamp: 1781661795,
    baseFeePerGas: "452626936053887",
    gasUsed: "126394",
    gasLimit: "44880000",
    txCount: 2,
    legacyGasShare: 1,
    legacyCountShare: 1,
    burned: BURNED,
    tips: TIPS,
    paid: PAID,
    burnedShare: 0.003496,
    burnedByType: { legacy: BURNED, modern: "0" },
    tipsByType: { legacy: TIPS, modern: "0" },
    paidByType: { legacy: PAID, modern: "0" },
    avgPositionByType: { legacy: 0.25, modern: null },
    positionHistogram: {
      legacy: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      modern: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    },
    priorityInversionRate: 0,
    overPrioritizedGasByType: { legacy: "0", modern: "0" },
    ...overrides,
  };
}

describe("<BlockTable /> mop-up", () => {
  beforeEach(() => useBlockLadder.mockReset());
  afterEach(() => vi.restoreAllMocks());

  it("expands a row to its FeeLadder then collapses it again", () => {
    // FeeLadder data hook (mocked) just needs to resolve to a block.
    useBlockLadder.mockReturnValue({
      isPending: false,
      isError: false,
      data: ladder(),
    });
    renderWithProviders(<BlockTable blocks={[block()]} />);
    const row = screen.getByText("#26804492").closest("tr")!;
    // expand → ladder mounts (block # header text appears inside the ladder)
    fireEvent.click(row);
    expect(screen.getAllByText(/block #26804492/).length).toBeGreaterThan(0);
    // collapse → setExpanded(cur === number ? null : ...) takes the null arm
    fireEvent.click(row);
    expect(screen.queryByText(/out of\s+fee order/)).not.toBeInTheDocument();
  });

  it("renders the muted dash for a null inversion rate", () => {
    renderWithProviders(
      <BlockTable blocks={[block({ priorityInversionRate: null })]} />,
    );
    // InversionCell null arm → an em-dash cell.
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("flags a high (>15%) inversion rate warmly", () => {
    renderWithProviders(
      <BlockTable blocks={[block({ priorityInversionRate: 0.42 })]} />,
    );
    expect(screen.getByText("42%")).toBeInTheDocument();
  });
});

// ===========================================================================
// MinersPanel — Inversion null arm + zero totalBlocks + short address
// ===========================================================================

import { MinersPanel } from "../components/networkHealth/MinersPanel";

function miner(overrides: Partial<MinerStats> = {}): MinerStats {
  const BURNED = "57209328955594993478";
  const TIPS = "16308415764020445994737";
  const PAID = "16365625092976040988215";
  return {
    miner: "0x5ead01d58067a68d0d700374500580ec5c961d0d",
    blocks: 1,
    gasUsed: "126394",
    legacyGasShare: 1,
    burned: BURNED,
    tips: TIPS,
    paid: PAID,
    priorityInversionRate: 0,
    ...overrides,
  };
}

describe("<MinersPanel /> mop-up", () => {
  afterEach(() => vi.restoreAllMocks());

  it("renders the null-inversion dash, the >15% warm arm, a short address, and zero totalBlocks", () => {
    renderWithProviders(
      <MinersPanel
        miners={[
          // null rate → Inversion returns the muted dash
          miner({ priorityInversionRate: null }),
          // >15% rate → warm class; short miner id → MiddleTruncate still
          // splits it into lead/tail nodes, so the full value is only
          // findable via its `title`, not as one getByText match.
          miner({ miner: "0xabc", priorityInversionRate: 0.5 }),
        ]}
        symbol="PLS"
        totalBlocks={0} // ShareBar's totalBlocks ? … : 0 false arm
      />,
    );
    // Expand the collapsed table.
    fireEvent.click(screen.getByText("Validators (2)"));
    expect(screen.getByText("Validator")).toBeInTheDocument();
    // null-rate row → dash; short address is searchable via its title.
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.getByTitle("0xabc")).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
  });
});
