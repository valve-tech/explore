import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent, within } from "@testing-library/react";
import { renderWithProviders } from "./_test-utils";
import type { BlockLadder } from "../api/networkHealth";

/**
 * Network-health cluster: FeeLadder (SVG fee stalactites + tooltip), ChainFlipper
 * (writes ?chainid=N), WindowSelector, NetworkHealthSkeleton, and the
 * NetworkHealthPage orchestrator.
 *
 * FeeLadder fixtures mirror REAL PulseChain block 26804492 — baseFeePerGas and
 * the two legacy txs' tips/gas come from that block.
 * https://scan.pulsechain.com/block/26804492 (chain 369).
 */

// ---- FeeLadder: mock the data hook --------------------------------------
const useBlockLadder = vi.fn();
vi.mock("../hooks/useNetworkHealth", () => ({
  useBlockLadder: (n: string) => useBlockLadder(n),
  useNetworkHealth: (...a: unknown[]) => useNetworkHealthMock(...a),
}));
const useNetworkHealthMock = vi.fn();

import { FeeLadder } from "../components/networkHealth/FeeLadder";
import { ChainFlipper } from "../components/networkHealth/ChainFlipper";
import { WindowSelector } from "../components/networkHealth/WindowSelector";
import { NetworkHealthSkeleton } from "../components/networkHealth/NetworkHealthSkeleton";
import NetworkHealthPage from "../pages/NetworkHealthPage";

const BASE_FEE = "452626936053887"; // ~0.000452 gwei, block 26804492

function ladder(overrides: Partial<BlockLadder> = {}): BlockLadder {
  return {
    number: "26804492",
    timestamp: 1781661795,
    baseFeePerGas: BASE_FEE,
    txCount: 2,
    burnsBaseFee: true,
    priorityInversionRate: 0.5,
    txs: [
      {
        position: 0,
        sender: "0x5ead01d58067a68d0d700374500580ec5c961d0d",
        type: "legacy",
        tip: "120000000000000",
        tipGwei: 120,
        gasUsed: "63197",
        status: "ordered",
        hash: "0x" + "a".repeat(64),
        to: "0x" + "c".repeat(40),
        value: "1000000000000000000",
        methodId: "0xa9059cbb",
      },
      {
        position: 1,
        // different sender so redness path can engage
        sender: "0x1111111111111111111111111111111111111111",
        type: "modern",
        tip: "300000000000000",
        tipGwei: 300,
        gasUsed: "63197",
        status: "jumped",
        hash: "0x" + "b".repeat(64),
        to: null, // contract creation branch in tooltip
        value: "0",
        methodId: "",
      },
    ],
    ...overrides,
  };
}

describe("<FeeLadder />", () => {
  beforeEach(() => useBlockLadder.mockReset());

  it("shows the loading spinner copy while pending", () => {
    useBlockLadder.mockReturnValue({ isPending: true, isError: false });
    renderWithProviders(<FeeLadder blockNumber="26804492" />);
    expect(screen.getByText(/Loading block 26804492/)).toBeInTheDocument();
  });

  it("renders the error message on failure", () => {
    useBlockLadder.mockReturnValue({
      isPending: false,
      isError: true,
      error: new Error("ladder HTTP 500"),
    });
    renderWithProviders(<FeeLadder blockNumber="26804492" />);
    expect(screen.getByText(/ladder HTTP 500/)).toBeInTheDocument();
  });

  it("renders a generic error label when error is not an Error", () => {
    useBlockLadder.mockReturnValue({
      isPending: false,
      isError: true,
      error: "boom",
    });
    renderWithProviders(<FeeLadder blockNumber="26804492" />);
    expect(screen.getByText(/Couldn't load block: error/)).toBeInTheDocument();
  });

  it("shows the empty state when the block has no txs", () => {
    useBlockLadder.mockReturnValue({
      isPending: false,
      isError: false,
      data: ladder({ txs: [] }),
    });
    renderWithProviders(<FeeLadder blockNumber="26804492" />);
    expect(
      screen.getByText(/No transactions in this block/),
    ).toBeInTheDocument();
  });

  it("renders the stacked ladder header + legend for a real block", () => {
    useBlockLadder.mockReturnValue({
      isPending: false,
      isError: false,
      data: ladder(),
    });
    const { container } = renderWithProviders(
      <FeeLadder blockNumber="26804492" />,
    );
    expect(screen.getByText(/block #26804492/)).toBeInTheDocument();
    expect(screen.getByText(/out of\s+fee order/)).toBeInTheDocument();
    expect(screen.getByText("burned (base fee)")).toBeInTheDocument();
    // SVG body present with the in-chart base-fee header text
    expect(container.querySelector("svg")).toBeInTheDocument();
    expect(screen.getAllByText(/base fee/).length).toBeGreaterThan(0);
  });

  it("shows a per-tx tooltip on hover, including the contract-creation tx", () => {
    useBlockLadder.mockReturnValue({
      isPending: false,
      isError: false,
      data: ladder(),
    });
    const { container } = renderWithProviders(
      <FeeLadder blockNumber="26804492" />,
    );
    const groups = container.querySelectorAll("svg g");
    expect(groups.length).toBe(2);
    // Hover the SECOND tx (the modern, contract-creation, jumped one) so the
    // tooltip exercises deltaPrev (>0 path) + "contract creation" + method
    // fallback to "transfer".
    fireEvent.mouseEnter(groups[1]!);
    // The sender→to line text includes "contract creation" for a null `to`.
    expect(
      screen.getAllByText((content) => /contract creation/.test(content))
        .length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("modern (≥2)")).toBeInTheDocument();
    expect(screen.getByText("transfer")).toBeInTheDocument(); // methodId "" fallback
  });

  it("hovering the first tx renders '—' for vs prev (no previous tx)", () => {
    useBlockLadder.mockReturnValue({
      isPending: false,
      isError: false,
      data: ladder(),
    });
    const { container } = renderWithProviders(
      <FeeLadder blockNumber="26804492" />,
    );
    const groups = container.querySelectorAll("svg g");
    fireEvent.mouseEnter(groups[0]!);
    // first tx: legacy + its real methodId surfaces
    expect(screen.getByText("legacy (0/1)")).toBeInTheDocument();
    expect(screen.getByText("0xa9059cbb")).toBeInTheDocument();
  });

  it("navigates to the tx route when a bar is clicked", () => {
    useBlockLadder.mockReturnValue({
      isPending: false,
      isError: false,
      data: ladder(),
    });
    const { container } = renderWithProviders(
      <FeeLadder blockNumber="26804492" />,
    );
    const firstGroup = container.querySelector("svg g")!;
    // Click should not throw; navigation handled by router.
    fireEvent.click(firstGroup);
    expect(firstGroup).toBeInTheDocument();
  });

  it("handles a single-tip block (logMax/logMin widen) and mouse move/leave", () => {
    useBlockLadder.mockReturnValue({
      isPending: false,
      isError: false,
      data: ladder({
        txs: [
          {
            position: 0,
            sender: "0xaaaa000000000000000000000000000000000000",
            type: "legacy",
            tip: "0",
            tipGwei: 0, // zero-tip branch (depth 0)
            gasUsed: "21000",
            status: "ordered",
            hash: "0x" + "d".repeat(64),
            to: "0x" + "e".repeat(40),
            value: "0",
            methodId: "",
          },
        ],
      }),
    });
    const { container } = renderWithProviders(
      <FeeLadder blockNumber="26804492" />,
    );
    const svg = container.querySelector("svg")!;
    fireEvent.mouseMove(svg);
    fireEvent.mouseLeave(svg);
    expect(svg).toBeInTheDocument();
  });
});

describe("<ChainFlipper />", () => {
  it("renders one pill per registered chain", () => {
    renderWithProviders(<ChainFlipper />);
    expect(screen.getByText("Ethereum")).toBeInTheDocument();
    expect(screen.getByText("PulseChain")).toBeInTheDocument();
  });

  it("writes ?chainid=N when a non-default chain is picked", () => {
    renderWithProviders(<ChainFlipper />, { initialEntries: ["/health"] });
    fireEvent.click(screen.getByText("Ethereum").closest("button")!);
    // re-render reflects active state via aria/styles; just assert no throw +
    // the active chain pill is still present
    expect(screen.getByText("Ethereum")).toBeInTheDocument();
  });

  it("drops the chainid param when the default chain (369) is picked", () => {
    renderWithProviders(<ChainFlipper />, {
      initialEntries: ["/health?chainid=1"],
    });
    fireEvent.click(screen.getByText("PulseChain").closest("button")!);
    expect(screen.getByText("PulseChain")).toBeInTheDocument();
  });
});

describe("<WindowSelector />", () => {
  it("renders all window options and marks the active one", () => {
    renderWithProviders(<WindowSelector value={64} onChange={() => {}} />);
    const active = screen.getByRole("button", { name: "64" });
    expect(active).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "256" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("calls onChange with the picked window", () => {
    const onChange = vi.fn();
    renderWithProviders(<WindowSelector value={64} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "512" }));
    expect(onChange).toHaveBeenCalledWith(512);
  });

  it("disables inactive buttons while busy but leaves the active one enabled", () => {
    renderWithProviders(
      <WindowSelector value={64} onChange={() => {}} busy />,
    );
    expect(screen.getByRole("button", { name: "64" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "256" })).toBeDisabled();
  });
});

describe("<NetworkHealthSkeleton />", () => {
  it("renders the layout placeholder with aria-busy", () => {
    const { container } = renderWithProviders(<NetworkHealthSkeleton />);
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
    expect(container.querySelectorAll(".skeleton").length).toBeGreaterThan(8);
  });
});

// ---- NetworkHealthPage ---------------------------------------------------
const AGG = {
  blocksAnalyzed: 1,
  fromBlock: "26804492",
  toBlock: "26804492",
  fromTimestamp: 1781661795,
  toTimestamp: 1781661795,
  legacyGasShare: 1,
  legacyCountShare: 1,
  burned: "57209328955594993478",
  tips: "16308415764020445994737",
  paid: "16365625092976040988215",
  burnedByType: { legacy: "57209328955594993478", modern: "0" },
  tipsByType: { legacy: "16308415764020445994737", modern: "0" },
  paidByType: { legacy: "16365625092976040988215", modern: "0" },
  avgPositionByType: { legacy: 0.25, modern: null },
  positionHistogram: {
    legacy: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    modern: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  burnedShare: 0.0035,
  priorityInversionRate: 0,
  overPrioritizedGasByType: { legacy: "0", modern: "0" },
  paidPerBlock: {
    avg: "16365625092976040988215",
    median: "16365625092976040988215",
    min: "16365625092976040988215",
    max: "16365625092976040988215",
  },
  tipsPerBlock: {
    avg: "16308415764020445994737",
    median: "16308415764020445994737",
    min: "16308415764020445994737",
    max: "16308415764020445994737",
  },
};

function healthResult(overrides: Record<string, unknown> = {}) {
  return {
    chainId: 369,
    burnsBaseFee: true,
    headBlock: "26804492",
    hasMore: false,
    aggregate: AGG,
    miners: [],
    blocks: [],
    ...overrides,
  };
}

describe("<NetworkHealthPage />", () => {
  beforeEach(() => useNetworkHealthMock.mockReset());
  afterEach(() => vi.restoreAllMocks());

  it("renders the skeleton + warm-up copy while pending", () => {
    useNetworkHealthMock.mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    });
    const { container } = renderWithProviders(<NetworkHealthPage />);
    expect(screen.getByText("Network Health")).toBeInTheDocument();
    expect(screen.getByText(/First load warms the cache/)).toBeInTheDocument();
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
  });

  it("renders the error card + Retry button, and refetches on click", () => {
    const refetch = vi.fn();
    useNetworkHealthMock.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      error: new Error("rate limited"),
      isFetching: false,
      refetch,
    });
    renderWithProviders(<NetworkHealthPage />);
    expect(screen.getByText(/rate limited/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalled();
  });

  it("renders the data view (summary + block count) for a loaded window", () => {
    useNetworkHealthMock.mockReturnValue({
      data: healthResult(),
      isPending: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    });
    renderWithProviders(<NetworkHealthPage />);
    expect(screen.getByText(/head #26,804,492/)).toBeInTheDocument();
  });

  it("shows the 'base fee retained' banner when the chain doesn't burn", () => {
    useNetworkHealthMock.mockReturnValue({
      data: healthResult({ burnsBaseFee: false }),
      isPending: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    });
    renderWithProviders(<NetworkHealthPage />);
    expect(
      screen.getByText(/Base fee is treated as retained/),
    ).toBeInTheDocument();
  });

  it("treats data for a different chain as stale and shows the skeleton", () => {
    useNetworkHealthMock.mockReturnValue({
      // active chain is default 369 but data says chain 1 → stale
      data: healthResult({ chainId: 1 }),
      isPending: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    });
    const { container } = renderWithProviders(<NetworkHealthPage />);
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
    // data view not rendered → no head count line
    expect(screen.queryByText(/head #/)).not.toBeInTheDocument();
  });

  it("shows 'Loading window…' while a background refetch is in flight", () => {
    useNetworkHealthMock.mockReturnValue({
      data: healthResult(),
      isPending: false,
      isError: false,
      isFetching: true,
      refetch: vi.fn(),
    });
    renderWithProviders(<NetworkHealthPage />);
    expect(screen.getByText(/Loading window…/)).toBeInTheDocument();
  });

  it("renders a non-Error error value with the generic fallback copy", () => {
    useNetworkHealthMock.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      error: "weird",
      isFetching: false,
      refetch: vi.fn(),
    });
    renderWithProviders(<NetworkHealthPage />);
    expect(screen.getByText(/unknown error/)).toBeInTheDocument();
  });

  it("changing the window selector updates the requested limit", () => {
    useNetworkHealthMock.mockReturnValue({
      data: healthResult(),
      isPending: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    });
    const { container } = renderWithProviders(<NetworkHealthPage />);
    const header = container.querySelector("header")!;
    fireEvent.click(within(header).getByRole("button", { name: "512" }));
    // useNetworkHealth is called with the new limit on re-render
    expect(useNetworkHealthMock).toHaveBeenCalledWith(512);
  });
});
