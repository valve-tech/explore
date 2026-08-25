import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "./_test-utils";
import type {
  LatestSummary,
  RecentBlocksResult,
  RecentTxsResult,
} from "../api/latest";
import type { GasOracleState } from "../api/gas";

/**
 * Explorer home (stats + gas widget + recent blocks/txs) and the gas oracle
 * widget, driven by real PulseChain (369) values:
 *   block https://scan.pulsechain.com/block/26804492
 *   WPLS  https://scan.pulsechain.com/address/0xA1077a294dDE1B09bB078844df40758a5D0f9a27
 * ExplorerHome / GasOracleWidget are TanStack-Query shells — mock api/latest +
 * api/gas and assert the loaded / loading / error surfaces.
 */

vi.mock("../api/latest", () => ({
  fetchLatestSummary: vi.fn(),
  fetchRecentBlocks: vi.fn(),
  fetchRecentTxs: vi.fn(),
}));

vi.mock("../api/gas", () => ({
  fetchGasOracle: vi.fn(),
}));

import ExplorerHome from "../components/explorer/ExplorerHome";
import { GasOracleWidget } from "../components/explorer/GasOracleWidget";
import {
  fetchLatestSummary,
  fetchRecentBlocks,
  fetchRecentTxs,
} from "../api/latest";
import { fetchGasOracle } from "../api/gas";

const mockSummary = fetchLatestSummary as unknown as ReturnType<typeof vi.fn>;
const mockBlocks = fetchRecentBlocks as unknown as ReturnType<typeof vi.fn>;
const mockTxs = fetchRecentTxs as unknown as ReturnType<typeof vi.fn>;
const mockGas = fetchGasOracle as unknown as ReturnType<typeof vi.fn>;

const nowSec = Math.floor(Date.now() / 1000);

const summary: LatestSummary = {
  latestBlock: {
    number: "26804492",
    hash: "0x" + "ab".repeat(32),
    timestamp: nowSec - 2,
    miner: "0x" + "11".repeat(20),
    transactionCount: 42,
    gasUsed: "15000000",
    gasLimit: "30000000",
    baseFeePerGas: "1000000000000",
  },
  finalizedBlock: {
    number: "26804491",
    hash: "0x" + "cd".repeat(32),
    timestamp: nowSec - 14,
    lagBlocks: 1,
  },
  gasPrice: {
    baseFeePerGas: "1000000000000",
    suggestedPriorityFee: "2000000000000",
  },
  network: { chainId: 369, name: "PulseChain" },
};

const blocksResult: RecentBlocksResult = {
  blocks: [
    {
      number: "26804492",
      hash: "0x" + "ee".repeat(32),
      timestamp: nowSec - 5,
      miner: "0x" + "22".repeat(20),
      transactionCount: 7,
      gasUsed: "15000000",
      gasLimit: "30000000",
      baseFeePerGas: "1000000000000",
    },
  ],
  cursor: null,
};

const txsResult: RecentTxsResult = {
  transactions: [
    {
      hash: "0xd515ef07d4308c389b05fe13c55ac1ebe3270bd8bbf4470b0a134a1766fe3c81",
      blockNumber: "26804224",
      timestamp: nowSec - 30,
      from: "0x155172653e94a7e5f0e04126803dcb6896796fbb",
      to: "0xA1077a294dDE1B09bB078844df40758a5D0f9a27",
      value: "5456507558918974858760",
      valuePLS: "0",
      gasUsed: "51000",
      type: "eip1559",
      gasPrice: null,
      maxFeePerGas: "3000000000000",
      maxPriorityFeePerGas: "1000000000000",
      methodId: "0xa9059cbb",
      methodName: "transfer",
    },
  ],
};

const gasState: GasOracleState = {
  chainId: 369,
  blockNumber: "26804492",
  baseFee: "1000000000000",
  baseFeeTrend: "rising",
  baseFeeHistory: Array<string>(21).fill("1000000000000"),
  mempool: {
    pendingCount: "1234",
    queuedCount: "0",
    pendingGasDemand: "0",
    blockGasLimit: "30000000",
  },
  tiers: {
    slow: {
      maxPriorityFeePerGas: "1000000000000",
      maxFeePerGas: "2000000000000",
      gasPrice: "2000000000000",
      maxFeePerBlobGas: null,
    },
    standard: {
      maxPriorityFeePerGas: "2000000000000",
      maxFeePerGas: "3000000000000",
      gasPrice: "3000000000000",
      maxFeePerBlobGas: null,
    },
    fast: {
      maxPriorityFeePerGas: "3000000000000",
      maxFeePerGas: "4000000000000",
      gasPrice: "4000000000000",
      maxFeePerBlobGas: null,
    },
    instant: {
      maxPriorityFeePerGas: "4000000000000",
      maxFeePerGas: "5000000000000",
      gasPrice: "5000000000000",
      maxFeePerBlobGas: null,
    },
  },
};

describe("<ExplorerHome />", () => {
  beforeEach(() => {
    mockSummary.mockReset();
    mockBlocks.mockReset();
    mockTxs.mockReset();
    mockGas.mockReset();
    mockGas.mockResolvedValue(gasState);
  });
  afterEach(() => vi.restoreAllMocks());

  it("renders the stat tiles, a recent block and a recent tx once loaded", async () => {
    mockSummary.mockResolvedValue(summary);
    mockBlocks.mockResolvedValue(blocksResult);
    mockTxs.mockResolvedValue(txsResult);

    renderWithProviders(<ExplorerHome onNavigate={vi.fn()} />);

    // Stat tiles labels are always present.
    expect(screen.getByText("Latest block")).toBeInTheDocument();
    expect(screen.getByText("Finalized")).toBeInTheDocument();
    expect(screen.getByText("Base fee")).toBeInTheDocument();

    // Block number is localized + appears in the stats tile and the blocks card.
    expect((await screen.findAllByText("#26,804,492")).length).toBeGreaterThan(0);
    // Recent tx method label.
    expect(await screen.findByText("transfer()")).toBeInTheDocument();
    // "1 block behind" singular pluralization branch.
    expect(screen.getByText("1 block behind")).toBeInTheDocument();
  });

  it("navigates to a tx when its row link is clicked", async () => {
    mockSummary.mockResolvedValue(summary);
    mockBlocks.mockResolvedValue(blocksResult);
    mockTxs.mockResolvedValue(txsResult);
    const onNavigate = vi.fn();

    renderWithProviders(<ExplorerHome onNavigate={onNavigate} />);

    const txLink = await screen.findByText("transfer()");
    const anchor = txLink.closest("a");
    expect(anchor).not.toBeNull();
    fireEvent.click(anchor!);
    expect(onNavigate).toHaveBeenCalledWith({
      type: "tx",
      value: txsResult.transactions[0]!.hash,
    });
  });

  it("compacts a millions-PLS value, shows 'just now', and a gas percent", async () => {
    mockSummary.mockResolvedValue(summary);
    mockBlocks.mockResolvedValue(blocksResult);
    // value > 1,000,000 PLS → "…M"; timestamp now → "just now".
    mockTxs.mockResolvedValue({
      transactions: [
        {
          ...txsResult.transactions[0]!,
          value: "2000000000000000000000000", // 2,000,000 PLS
          timestamp: nowSec,
          methodName: null,
          methodId: "0xabcdef12",
        },
      ],
    });

    renderWithProviders(<ExplorerHome onNavigate={vi.fn()} />);
    expect(await screen.findByText(/2M/)).toBeInTheDocument();
    expect(screen.getAllByText("just now").length).toBeGreaterThan(0);
    // gasUsed/gasLimit → 50% in the blocks card.
    expect(screen.getByText("50%")).toBeInTheDocument();
    // methodId fallback (no methodName).
    expect(screen.getByText("0xabcdef12")).toBeInTheDocument();
  });

  it("falls back to 'transfer' label when a tx has neither method name nor id", async () => {
    mockSummary.mockResolvedValue(summary);
    mockBlocks.mockResolvedValue({ blocks: [] });
    mockTxs.mockResolvedValue({
      transactions: [
        {
          ...txsResult.transactions[0]!,
          methodName: null,
          methodId: "",
          value: "0",
        },
      ],
    });
    renderWithProviders(<ExplorerHome onNavigate={vi.fn()} />);
    expect(await screen.findByText("transfer")).toBeInTheDocument();
  });

  it("shows loading copy in the stat tile while summary is pending", () => {
    mockSummary.mockReturnValue(new Promise(() => {})); // never resolves
    mockBlocks.mockReturnValue(new Promise(() => {}));
    mockTxs.mockReturnValue(new Promise(() => {}));

    renderWithProviders(<ExplorerHome onNavigate={vi.fn()} />);
    expect(screen.getAllByText("loading…").length).toBeGreaterThan(0);
  });
});

describe("<GasOracleWidget />", () => {
  beforeEach(() => {
    mockGas.mockReset();
    try {
      localStorage.removeItem("explorer.gasTier");
    } catch {
      /* ignore */
    }
  });
  afterEach(() => vi.restoreAllMocks());

  it("shows a loading state while pending", () => {
    mockGas.mockReturnValue(new Promise(() => {}));
    renderWithProviders(<GasOracleWidget />);
    expect(screen.getByText("Loading gas tiers…")).toBeInTheDocument();
  });

  it("shows an error state on failure", async () => {
    mockGas.mockRejectedValue(new Error("nope"));
    renderWithProviders(<GasOracleWidget />);
    expect(await screen.findByText("Gas oracle unavailable")).toBeInTheDocument();
  });

  it("renders base fee, tiers, pending count and lets a tier be selected", async () => {
    mockGas.mockResolvedValue(gasState);
    renderWithProviders(<GasOracleWidget />);

    // base fee readout + pending count.
    expect(await screen.findByText("base")).toBeInTheDocument();
    expect(screen.getByText("1,234")).toBeInTheDocument();
    // Default sticky tier is "standard".
    expect(screen.getByText("Standard")).toBeInTheDocument();

    // Hovering the "Fast" bar selects it (persisted to localStorage).
    const fastBar = screen.getByRole("button", { name: "Fast priority fee" });
    fireEvent.mouseEnter(fastBar);
    await waitFor(() => expect(screen.getByText("Fast")).toBeInTheDocument());
    expect(localStorage.getItem("explorer.gasTier")).toBe("fast");

    // Focus also selects (keyboard path).
    const instantBar = screen.getByRole("button", { name: "Instant priority fee" });
    fireEvent.focus(instantBar);
    await waitFor(() => expect(screen.getByText("Instant")).toBeInTheDocument());
  });

  it("seeds the active tier from a persisted localStorage value", async () => {
    localStorage.setItem("explorer.gasTier", "slow");
    mockGas.mockResolvedValue(gasState);
    renderWithProviders(<GasOracleWidget />);
    expect(await screen.findByText("Slow")).toBeInTheDocument();
  });
});
