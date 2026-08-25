import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "./_test-utils";

/**
 * Coverage mop-up for the explorer cluster — the specific branches the existing
 * explorer / BlockView / TxDetail / ContractView tests leave uncovered:
 *
 *  - ExplorerHome   internal formatters (formatGwei/formatPls catch arms,
 *                   gasPctLabel zero-limit + catch, `ago` h/d buckets, `short`
 *                   on a short hash) — reached by rendering with crafted data.
 *  - BlockView      the success render's transaction table (Create/no-from rows)
 *                   + Prev/Next nav buttons + the null-block return.
 *  - TxDetail       the error render + the null-tx return.
 *  - ContractView   the null-info return.
 *  - GasOracleWidget  gweiNum catch (bad wei) + barHeight maxTip<=0 floor.
 *  - TokensTab      the contract-row onNavigate click.
 *  - callReadFunction  coerceArg's non-bool passthrough (line 10).
 *  - format.ts      groupDecimalString's negative-number branch (line 31).
 *
 * Real fixtures: WPLS 0xA1077a294dDE1B09bB078844df40758a5D0f9a27, block
 * 26804492 (chain 369). https://scan.pulsechain.com
 */

const WPLS = "0xA1077a294dDE1B09bB078844df40758a5D0f9a27";

/* ================================================================== */
/* ExplorerHome — formatter branches                                  */
/* ================================================================== */

vi.mock("../api/latest", () => ({
  fetchLatestSummary: vi.fn(),
  fetchRecentBlocks: vi.fn(),
  fetchRecentTxs: vi.fn(),
}));
vi.mock("../api/gas", () => ({ fetchGasOracle: vi.fn() }));

import ExplorerHome from "../components/explorer/ExplorerHome";
import {
  fetchLatestSummary,
  fetchRecentBlocks,
  fetchRecentTxs,
  type LatestSummary,
} from "../api/latest";
import { fetchGasOracle, type GasOracleState } from "../api/gas";

const mockSummary = fetchLatestSummary as unknown as ReturnType<typeof vi.fn>;
const mockBlocks = fetchRecentBlocks as unknown as ReturnType<typeof vi.fn>;
const mockTxs = fetchRecentTxs as unknown as ReturnType<typeof vi.fn>;
const mockGas = fetchGasOracle as unknown as ReturnType<typeof vi.fn>;

const nowSec = Math.floor(Date.now() / 1000);

function gasOk(tipOverride?: string): GasOracleState {
  const tier = {
    maxPriorityFeePerGas: tipOverride ?? "1000000000000",
    maxFeePerGas: "2000000000000",
    gasPrice: "2000000000000",
    maxFeePerBlobGas: null,
  };
  return {
    chainId: 369,
    blockNumber: "26804492",
    baseFee: "1000000000000",
    baseFeeTrend: "stable",
    baseFeeHistory: Array<string>(21).fill("1000000000000"),
    mempool: {
      pendingCount: "0",
      queuedCount: "0",
      pendingGasDemand: "0",
      blockGasLimit: "30000000",
    },
    tiers: { slow: tier, standard: tier, fast: tier, instant: tier },
  };
}

describe("<ExplorerHome /> — formatter branches", () => {
  beforeEach(() => {
    mockSummary.mockReset();
    mockBlocks.mockReset();
    mockTxs.mockReset();
    mockGas.mockReset();
    mockGas.mockResolvedValue(gasOk());
  });
  afterEach(() => vi.restoreAllMocks());

  it("renders catch/zero-limit fallbacks and the h/d 'ago' buckets", async () => {
    // Summary with non-numeric gas fields → formatGwei catch → returns raw.
    const summary: LatestSummary = {
      latestBlock: {
        number: "26804492",
        hash: "0x" + "ab".repeat(32),
        timestamp: nowSec - 2,
        miner: "0x" + "11".repeat(20),
        transactionCount: 1,
        gasUsed: "0",
        gasLimit: "0",
        baseFeePerGas: "not-a-number",
      },
      finalizedBlock: {
        number: "26804491",
        hash: "0x" + "cd".repeat(32),
        timestamp: nowSec - 14,
        lagBlocks: 2, // plural branch
      },
      gasPrice: {
        baseFeePerGas: "not-a-number", // formatGwei catch → raw string
        suggestedPriorityFee: "also-bad",
      },
      network: { chainId: 369, name: "PulseChain" },
    };
    mockSummary.mockResolvedValue(summary);

    // Two blocks: one with gasLimit "0" (gasPctLabel → "—"), one with a
    // non-numeric gas pair (gasPctLabel catch → "—"). Timestamps drive the
    // `ago` h-bucket (2h) and d-bucket (2d).
    mockBlocks.mockResolvedValue({
      blocks: [
        {
          number: "26804492",
          hash: "0x" + "ee".repeat(32),
          timestamp: nowSec - 2 * 3600, // 2h ago
          miner: "0x" + "22".repeat(20),
          transactionCount: 0,
          gasUsed: "10",
          gasLimit: "0", // limit 0 → "—"
          baseFeePerGas: null,
        },
        {
          number: "26804491",
          hash: "0x" + "ff".repeat(32),
          timestamp: nowSec - 2 * 86400, // 2d ago
          miner: "0x" + "33".repeat(20),
          transactionCount: 0,
          gasUsed: "x", // non-numeric → catch → "—"
          gasLimit: "y",
          baseFeePerGas: null,
        },
        {
          // The minute bucket used to be covered by a 30-minute-old tx. The
          // tx row now shows which block included it instead of an age —
          // every tx in that list shares a block, so the age column printed
          // one fact ten times — so the m-bucket moves here, where an age is
          // still what the row says.
          number: "26804490",
          hash: "0x" + "aa".repeat(32),
          timestamp: nowSec - 30 * 60, // 30m ago
          miner: "0x" + "44".repeat(20),
          transactionCount: 0,
          gasUsed: "15000000",
          gasLimit: "30000000",
          baseFeePerGas: null,
        },
      ],
      cursor: null,
    });

    // A tx with an unparseable value → formatPls catch → returns raw string,
    // and a short hash (<14 chars) → `short` returns it unchanged.
    mockTxs.mockResolvedValue({
      transactions: [
        {
          hash: "0xshort",
          blockNumber: "1",
          timestamp: nowSec - 30 * 60,
          from: "0x" + "44".repeat(20),
          to: "0x" + "55".repeat(20),
          value: "not-wei",
          valuePLS: "0",
          gasUsed: "21000",
          type: "legacy",
          gasPrice: "1000000000",
          maxFeePerGas: null,
          maxPriorityFeePerGas: null,
          methodId: "0xdeadbeef",
          methodName: null,
        },
      ],
    });

    renderWithProviders(<ExplorerHome />);

    // plural "blocks behind"
    expect(await screen.findByText("2 blocks behind")).toBeInTheDocument();
    // formatGwei catch returns the raw bad string in the stat tile.
    expect(screen.getAllByText("not-a-number").length).toBeGreaterThan(0);
    // gasPctLabel zero-limit + catch both render "—" in the blocks card.
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
    // `ago` h-, d- and m-buckets, all three from the blocks list.
    expect(screen.getByText(/2h ago/)).toBeInTheDocument();
    expect(screen.getByText(/2d ago/)).toBeInTheDocument();
    expect(screen.getByText(/30m ago/)).toBeInTheDocument();
    // formatPls catch → the raw "not-wei" string shows in the value column.
    expect(screen.getByText(/not-wei/)).toBeInTheDocument();
    // Short hash passthrough (<14 chars stays whole) — searchable via
    // MiddleTruncate's `title` attr, which always carries the full value.
    expect(screen.getByTitle("0xshort")).toBeInTheDocument();
  });
});

/* ================================================================== */
/* GasOracleWidget — gweiNum catch + barHeight floor                  */
/* ================================================================== */

import { GasOracleWidget } from "../components/explorer/GasOracleWidget";

describe("<GasOracleWidget /> — numeric edge arms", () => {
  beforeEach(() => {
    mockGas.mockReset();
    try {
      localStorage.removeItem("explorer.gasTier");
    } catch {
      /* ignore */
    }
  });
  afterEach(() => vi.restoreAllMocks());

  it("handles a zero/unparseable tip (gweiNum catch + barHeight maxTip<=0)", async () => {
    // tip "0x" is unparseable by BigInt → gweiNum catch → 0 for every tier,
    // so maxTip is 0 and barHeight takes the maxTip<=0 → BAR_MIN_PX floor.
    mockGas.mockResolvedValue(gasOk("0x"));
    renderWithProviders(<GasOracleWidget />);
    expect(await screen.findByText("base")).toBeInTheDocument();
    // All four tier bars render at the floor height.
    expect(
      screen.getByRole("button", { name: "Slow priority fee" }),
    ).toBeInTheDocument();
  });
});

/* ================================================================== */
/* BlockView — success table + nav buttons + null block               */
/* ================================================================== */

vi.mock("../api/explorer", () => ({
  fetchBlock: vi.fn(),
}));

import BlockView from "../components/explorer/BlockView";
import { fetchBlock, type BlockDetails } from "../api/explorer";

const mockBlock = fetchBlock as unknown as ReturnType<typeof vi.fn>;

function blockWithTxs(): BlockDetails {
  return {
    number: "26804492",
    hash: "0x" + "ab".repeat(32),
    parentHash: "0x" + "cd".repeat(32),
    timestamp: Math.floor(Date.now() / 1000) - 600,
    miner: "0x" + "11".repeat(20),
    gasUsed: "5000000",
    gasLimit: "30000000",
    baseFeePerGas: "1000000000",
    transactionCount: 2,
    size: "1024",
    transactions: [
      {
        hash: "0x" + "1a".repeat(32),
        from: "0x" + "22".repeat(20),
        to: "0x" + "33".repeat(20),
        value: "0",
        valuePLS: "0",
        gasUsed: null,
        type: "0x2",
        gasPrice: null,
        maxFeePerGas: "3000000000",
        maxPriorityFeePerGas: "1000000000",
        methodId: "0xa9059cbb",
      },
      {
        // Contract-creation tx: to == null → "Create"; from == null → "-".
        hash: "0x" + "2b".repeat(32),
        from: null as unknown as string,
        to: null,
        value: "0",
        valuePLS: "0",
        gasUsed: null,
        type: "0x0",
        gasPrice: "1000000000",
        maxFeePerGas: null,
        maxPriorityFeePerGas: null,
        methodId: "0x", // → "Transfer" pill
      },
    ],
  };
}

describe("<BlockView /> — success table + navigation", () => {
  beforeEach(() => {
    mockBlock.mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  it("renders the tx table with Create/no-from rows and the Transfer pill", async () => {
    mockBlock.mockResolvedValue(blockWithTxs());
    renderWithProviders(<BlockView numberOrHash="26804492" onNavigate={vi.fn()} />);

    expect(await screen.findByText(/26,804,492/)).toBeInTheDocument();
    // methodId pill for the first tx, Transfer + Create for the second.
    expect(screen.getByText("0xa9059cbb")).toBeInTheDocument();
    expect(screen.getByText("Transfer")).toBeInTheDocument();
    expect(screen.getByText("Create")).toBeInTheDocument();
    // no-from row renders the "-" placeholder.
    expect(screen.getByText("-")).toBeInTheDocument();
  });

  it("navigates to the previous and next block via the nav buttons", async () => {
    mockBlock.mockResolvedValue(blockWithTxs());
    const onNavigate = vi.fn();
    renderWithProviders(
      <BlockView numberOrHash="26804492" onNavigate={onNavigate} />,
    );
    await screen.findByText(/26,804,492/);

    fireEvent.click(screen.getByRole("button", { name: "Prev" }));
    expect(onNavigate).toHaveBeenCalledWith({ type: "block", value: "26804491" });

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(onNavigate).toHaveBeenCalledWith({ type: "block", value: "26804493" });
  });

  it("does not navigate Prev past block 0 (disabled / guard)", async () => {
    mockBlock.mockResolvedValue({ ...blockWithTxs(), number: "0", transactions: [] });
    const onNavigate = vi.fn();
    renderWithProviders(<BlockView numberOrHash="0" onNavigate={onNavigate} />);
    await screen.findByText("No transactions in this block");
    const prev = screen.getByRole("button", { name: "Prev" }) as HTMLButtonElement;
    expect(prev.disabled).toBe(true);
  });

  it("renders nothing once loading finishes with a null block", async () => {
    mockBlock.mockResolvedValue(null);
    const { container } = renderWithProviders(
      <BlockView numberOrHash="999" onNavigate={vi.fn()} />,
    );
    // Loading spinner clears, then `if (!block) return null` → empty render.
    await waitFor(() =>
      expect(screen.queryByText(/Loading block/i)).not.toBeInTheDocument(),
    );
    expect(container.textContent).toBe("");
  });
});

// TxDetail's error + null arms live in explorerFetchEdges.test.tsx — kept in a
// dedicated file so the rejected-promise fixture isn't attributed to a sibling
// test by vitest's shared unhandled-rejection tracker in this multi-mock file.

/* ================================================================== */
/* ContractView — null info return                                    */
/* ================================================================== */

// NOTE: ContractView's `if (!info) return null` (line 100) is unreachable —
// fetchContractInfo is typed to return a ContractInfo, and a null resolve
// crashes earlier at `setSubTab(pickInitialTab(data))` (pickInitialTab reads
// data.abi). So the guard can never be hit through the fetch path. Left
// uncovered deliberately rather than contorting the test.

/* ================================================================== */
/* TokensTab — contract-row navigation                               */
/* ================================================================== */

import { TokensTab } from "../components/explorer/AddressView/TokensTab";

describe("<TokensTab /> — row navigation", () => {
  afterEach(() => vi.restoreAllMocks());

  it("fires onNavigate with the token's contract address on row click", () => {
    const onNavigate = vi.fn();
    renderWithProviders(
      <TokensTab
        tokens={[
          {
            balance: "1000000000000000000",
            formattedBalance: "1.0",
            contractAddress: WPLS,
            name: "", // falsy → "Unknown" label branch
            symbol: "WPLS",
            decimals: "18",
            type: "ERC-20",
          },
        ]}
        onNavigate={onNavigate}
      />,
    );
    // The contract address renders via MiddleTruncate (visually clipped, full
    // value searchable via its title attribute) inside a button.
    fireEvent.click(screen.getByTitle(WPLS));
    expect(onNavigate).toHaveBeenCalledWith({ type: "address", value: WPLS });
    // name "" → "Unknown" fallback rendered.
    expect(screen.getByText("Unknown")).toBeInTheDocument();
  });
});

/* ================================================================== */
/* callReadFunction — non-bool arg passthrough                       */
/* ================================================================== */

import { callReadFunction } from "../components/explorer/ContractView/callReadFunction";
import type { AbiItem } from "../components/explorer/ContractView/types";

describe("callReadFunction — non-bool coerceArg passthrough", () => {
  afterEach(() => vi.restoreAllMocks());

  it("passes a non-bool (address) arg through unchanged", async () => {
    const fn: AbiItem = {
      name: "balanceOf",
      type: "function",
      stateMutability: "view",
      inputs: [{ name: "owner", type: "address" }],
      outputs: [{ name: "", type: "uint256" }],
    } as AbiItem;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      json: async () => ({
        ok: true,
        result: { decodedReturn: { values: [{ name: "", type: "uint256", value: 0 }] } },
      }),
    } as Response);

    const res = await callReadFunction(fn, WPLS, {
      owner: "0x0000000000000000000000000000000000000001",
    });
    expect(res.ok).toBe(true);
    // The address arg was encoded into the calldata (non-bool passthrough).
    const body = JSON.parse(
      (fetchSpy.mock.calls[0]![1] as RequestInit).body as string,
    );
    expect(body.data.toLowerCase()).toContain(
      "0000000000000000000000000000000000000001",
    );
  });
});

/* ================================================================== */
/* format.ts — groupDecimalString negative branch                    */
/* ================================================================== */

import { groupDecimalString } from "../components/explorer/format";

describe("format — groupDecimalString negative branch", () => {
  it("keeps the leading minus and groups the integer part", () => {
    expect(groupDecimalString("-1234567.891", 2)).toBe("-1,234,567.89");
    expect(groupDecimalString("-0.5", 4)).toBe("-0.5");
  });
});
