import { describe, it, expect } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "./_test-utils";
import type {
  WindowAggregate,
  BlockStats,
  MinerStats,
} from "../api/networkHealth";
import { SummaryCards } from "../components/networkHealth/SummaryCards";
import { LensPanels } from "../components/networkHealth/LensPanels";
import { PositionHeatmap } from "../components/networkHealth/PositionHeatmap";
import { MinersPanel } from "../components/networkHealth/MinersPanel";
import { BlockTable } from "../components/networkHealth/BlockTable";
import { SplitBar } from "../components/networkHealth/SplitBar";

/**
 * Network Health presentational panels, driven by a REAL one-block window —
 * block 26804492 (https://explore.valve.city/block/26804492?chainid=369), two
 * legacy txs. The wei sums are the chain's own (burned/tips/paid computed from
 * its baseFee/effectiveGasPrice/gasUsed), so the rendered figures are verifiable.
 */

const BURNED = "57209328955594993478";
const TIPS = "16308415764020445994737";
const PAID = "16365625092976040988215";
const MINER = "0x5ead01d58067a68d0d700374500580ec5c961d0d";

const aggregate: WindowAggregate = {
  blocksAnalyzed: 1,
  fromBlock: "26804492",
  toBlock: "26804492",
  fromTimestamp: 1781661795,
  toTimestamp: 1781661795,
  legacyGasShare: 1, // both txs legacy
  legacyCountShare: 1,
  burned: BURNED,
  tips: TIPS,
  paid: PAID,
  burnedByType: { legacy: BURNED, modern: "0" },
  tipsByType: { legacy: TIPS, modern: "0" },
  paidByType: { legacy: PAID, modern: "0" },
  avgPositionByType: { legacy: 0.25, modern: null },
  positionHistogram: {
    legacy: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    modern: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  burnedShare: 0.003496,
  priorityInversionRate: 0,
  overPrioritizedGasByType: { legacy: "0", modern: "0" },
  paidPerBlock: { avg: PAID, median: PAID, min: PAID, max: PAID },
  tipsPerBlock: { avg: TIPS, median: TIPS, min: TIPS, max: TIPS },
};

const block: BlockStats = {
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
  positionHistogram: aggregate.positionHistogram,
  priorityInversionRate: 0,
  overPrioritizedGasByType: { legacy: "0", modern: "0" },
};

const miner: MinerStats = {
  miner: MINER,
  blocks: 1,
  gasUsed: "126394",
  legacyGasShare: 1,
  burned: BURNED,
  tips: TIPS,
  paid: PAID,
  priorityInversionRate: 0,
};

describe("networkHealth panels", () => {
  it("SummaryCards renders the gas-share and the burned figure", () => {
    renderWithProviders(
      <SummaryCards aggregate={aggregate} symbol="PLS" headBlock="26804492" />,
    );
    expect(screen.getByText("Legacy gas share")).toBeInTheDocument();
    expect(screen.getAllByText("100.0%").length).toBeGreaterThan(0); // legacy share, gas-weighted
  });

  it("LensPanels shows user cost vs validator revenue with the real paid total", () => {
    renderWithProviders(
      <LensPanels aggregate={aggregate} symbol="PLS" burnsBaseFee={true} />,
    );
    expect(screen.getByText("User cost")).toBeInTheDocument();
    expect(screen.getByText("Validator revenue")).toBeInTheDocument();
    // paid = 16365.6250… PLS → grouped to 2dp
    expect(screen.getByText("16,365.63 PLS")).toBeInTheDocument();
  });

  it("PositionHeatmap renders both type rows", () => {
    renderWithProviders(
      <PositionHeatmap
        histogram={aggregate.positionHistogram}
        avgPosition={aggregate.avgPositionByType}
      />,
    );
    expect(screen.getByText("Position distribution")).toBeInTheDocument();
    expect(screen.getByText("legacy")).toBeInTheDocument();
    expect(screen.getByText("modern")).toBeInTheDocument();
  });

  it("MinersPanel lists the validator count and expands to a table", () => {
    renderWithProviders(
      <MinersPanel miners={[miner]} symbol="PLS" totalBlocks={1} />,
    );
    const toggle = screen.getByText("Validators (1)");
    expect(toggle).toBeInTheDocument();
    // Collapsed by default — the table is hidden until clicked.
    expect(screen.queryByText("Validator")).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.getByText("Validator")).toBeInTheDocument(); // table header
    expect(screen.getByText("Blocks")).toBeInTheDocument();
  });

  it("MinersPanel renders nothing when there are no miners", () => {
    const { container } = renderWithProviders(
      <MinersPanel miners={[]} symbol="PLS" totalBlocks={0} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("BlockTable renders a row for the real block", () => {
    renderWithProviders(<BlockTable blocks={[block]} />);
    expect(screen.getByText("#26804492")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument(); // tx count
  });

  it("SplitBar widths reflect the legacy fraction", () => {
    const { container } = renderWithProviders(<SplitBar legacyFraction={0.75} />);
    // track > filled flex > [legacy, modern] segments
    const segments = container.querySelectorAll<HTMLElement>(
      ":scope > div > div > div",
    );
    expect(segments[0]!.style.width).toBe("75%");
    expect(segments[1]!.style.width).toBe("25%");
  });
});
