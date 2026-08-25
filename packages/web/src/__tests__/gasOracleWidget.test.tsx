import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderWithProviders } from "./_test-utils";
import { formatGweiDisplay } from "../components/explorer/format";

/**
 * GasOracleWidget — the three production defects fixed here:
 *
 *  1. Horizontal overflow at 375px (layout — verified with Playwright, not
 *     jsdom, since jsdom does no layout; see packages/web/e2e/
 *     gasOracleWidget-overflow.spec.ts).
 *  2. Two gwei formatters disagreeing on the same page — the widget must
 *     format a sub-1-gwei base fee the SAME way the ExplorerHome stat card
 *     does (subscript notation), never as "0 gwei".
 *  3. The unused `baseFeeHistory` sparkline.
 */

vi.mock("../api/gas", () => ({ fetchGasOracle: vi.fn() }));

import { GasOracleWidget } from "../components/explorer/GasOracleWidget";
import { fetchGasOracle, type GasOracleState } from "../api/gas";

const mockGas = fetchGasOracle as unknown as ReturnType<typeof vi.fn>;

function makeGasState(overrides: Partial<GasOracleState> = {}): GasOracleState {
  const tier = {
    maxPriorityFeePerGas: "1000000000000",
    maxFeePerGas: "2000000000000",
    gasPrice: "2000000000000",
    maxFeePerBlobGas: null,
  };
  return {
    chainId: 369,
    blockNumber: "26804492",
    baseFee: "1000000000000",
    baseFeeTrend: "stable",
    baseFeeHistory: Array.from({ length: 21 }, (_, i) =>
      String(1_000_000_000n + BigInt(i) * 10_000_000n),
    ),
    mempool: {
      pendingCount: "0",
      queuedCount: "0",
      pendingGasDemand: "0",
      blockGasLimit: "30000000",
    },
    tiers: { slow: tier, standard: tier, fast: tier, instant: tier },
    ...overrides,
  };
}

beforeEach(() => {
  mockGas.mockReset();
  try {
    localStorage.removeItem("explorer.gasTier");
  } catch {
    /* ignore */
  }
});
afterEach(() => vi.restoreAllMocks());

describe("<GasOracleWidget /> — formatting agrees with the stat card (defect 2)", () => {
  it("never renders a nonzero base fee as 0 gwei — sub-1-gwei uses subscript notation", async () => {
    // 0.11 gwei, the exact production example from chain 1's stat card.
    mockGas.mockResolvedValue(makeGasState({ baseFee: "110000000" }));
    renderWithProviders(<GasOracleWidget />);

    const base = await screen.findByText("base");
    // The widget must agree with `formatGweiDisplay` (the stat card's own
    // formatter), not print a bare "0" in the base-fee cluster.
    expect(screen.getByText(formatGweiDisplay("110000000"))).toBeInTheDocument();
    expect(formatGweiDisplay("110000000")).not.toBe("0");
    expect(within(base.parentElement as HTMLElement).queryByText("0")).not.toBeInTheDocument();
  });

  it("renders the deep-subscript form for a very small base fee (chain 943 case)", async () => {
    // wei=70 -> 0.00000007 gwei -> "0.0₇7", matching ExplorerHome's own
    // subscriptSmallString output for the same value.
    mockGas.mockResolvedValue(makeGasState({ baseFee: "70" }));
    renderWithProviders(<GasOracleWidget />);

    await screen.findByText("base");
    expect(formatGweiDisplay("70")).toBe("0.0₇7"); // ₇
    expect(screen.getByText("0.0₇7")).toBeInTheDocument();
  });

  it("formats the tier gauge readout through the same helper", async () => {
    mockGas.mockResolvedValue(
      makeGasState({
        tiers: {
          slow: {
            maxPriorityFeePerGas: "500000000",
            maxFeePerGas: "600000000",
            gasPrice: "600000000",
            maxFeePerBlobGas: null,
          },
          standard: {
            maxPriorityFeePerGas: "500000000",
            maxFeePerGas: "600000000",
            gasPrice: "600000000",
            maxFeePerBlobGas: null,
          },
          fast: {
            maxPriorityFeePerGas: "500000000",
            maxFeePerGas: "600000000",
            gasPrice: "600000000",
            maxFeePerBlobGas: null,
          },
          instant: {
            maxPriorityFeePerGas: "500000000",
            maxFeePerGas: "600000000",
            gasPrice: "600000000",
            maxFeePerBlobGas: null,
          },
        },
      }),
    );
    renderWithProviders(<GasOracleWidget />);

    await screen.findByText("base");
    // 0.5 gwei tip — subscript doesn't kick in above 1e-3, so this is the
    // grouped form; the point is it's the SAME string formatGweiDisplay
    // produces, not the old zero-decimal helper's "0".
    expect(screen.getByText(formatGweiDisplay("500000000"))).toBeInTheDocument();
  });
});

describe("<GasOracleWidget /> — base-fee sparkline (defect 3)", () => {
  it("renders a 21-point sparkline from baseFeeHistory", async () => {
    mockGas.mockResolvedValue(makeGasState());
    const { container } = renderWithProviders(<GasOracleWidget />);

    await screen.findByText("base");
    const svg = container.querySelector('svg[aria-label="Base fee, last 21 blocks"]');
    expect(svg).toBeInTheDocument();
    const polyline = svg?.querySelector("polyline");
    expect(polyline).toBeInTheDocument();
    // 21 history points -> 21 "x,y" pairs.
    const pointCount = polyline?.getAttribute("points")?.trim().split(/\s+/).length;
    expect(pointCount).toBe(21);
  });

  it("omits the sparkline when history is too short to plot", async () => {
    mockGas.mockResolvedValue(makeGasState({ baseFeeHistory: ["1000000000"] }));
    const { container } = renderWithProviders(<GasOracleWidget />);

    await screen.findByText("base");
    expect(
      container.querySelector('svg[aria-label="Base fee, last 21 blocks"]'),
    ).not.toBeInTheDocument();
  });
});

describe("<GasOracleWidget /> — layout structure guards the 375px wrap fix", () => {
  it("the strip wraps instead of forcing a single no-wrap row", async () => {
    mockGas.mockResolvedValue(makeGasState());
    const { container } = renderWithProviders(<GasOracleWidget />);

    await screen.findByText("base");
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("flex-wrap");
    // The old fixed `px-3.5` (off the p-2/p-4 scale) is gone.
    expect(root.className).not.toContain("px-3.5");
  });

  it("the pending count sits in its own cluster (not a bare flex-1 spacer)", async () => {
    mockGas.mockResolvedValue(makeGasState({ mempool: { pendingCount: "42", queuedCount: "0", pendingGasDemand: "0", blockGasLimit: "30000000" } }));
    renderWithProviders(<GasOracleWidget />);

    await screen.findByText("base");
    const pending = screen.getByText("pending");
    expect(within(pending.parentElement as HTMLElement).getByText("42")).toBeInTheDocument();
  });
});
