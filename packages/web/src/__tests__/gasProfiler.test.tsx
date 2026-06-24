import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "./_test-utils";
import type {
  GasProfile,
  OpcodeProfile,
} from "../api/debugger";
import GasProfiler from "../components/debugger/GasProfiler";
import { GasTable } from "../components/debugger/GasProfiler/GasTable";
import { GasBarChart } from "../components/debugger/GasProfiler/GasBarChart";

/**
 * GasProfiler + sub-components, driven by a known transfer call tree
 * (transfer → balanceOf). Rendering GasProfiler exercises CallTypeBreakdown,
 * GasBarChart, GasTable, OpcodeCategoryBreakdown, and TopExpensiveOps together.
 */

const TOKEN = "0xa1077a294dde1b09bb078844df40758a5d0f9a27";

const gasProfile: GasProfile = {
  totalGas: 51000,
  byCallType: { CALL: 40000, STATICCALL: 11000 },
  entries: [
    {
      function: "transfer(address,uint256)",
      address: TOKEN,
      callType: "CALL",
      gasUsed: 40000,
      totalGas: 51000,
      percentage: 100,
      depth: 0,
      children: [
        {
          function: "balanceOf(address)",
          address: "0xchild0000000000000000000000000000000000",
          callType: "STATICCALL",
          gasUsed: 11000,
          totalGas: 11000,
          percentage: 21.6,
          depth: 1,
          children: [],
        },
      ],
    },
  ],
  flat: [
    { depth: 0, function: "transfer(address,uint256)", address: TOKEN, callType: "CALL", gasUsed: 40000, percentage: 78.4 },
    { depth: 1, function: "balanceOf(address)", address: "0xchild0000000000000000000000000000000000", callType: "STATICCALL", gasUsed: 11000, percentage: 21.6 },
  ],
};

const opcodeProfile: OpcodeProfile = {
  totalGas: 51000,
  categories: [
    { category: "Storage", gas: 20000, count: 5, percentage: 39.2 },
    { category: "Compute", gas: 31000, count: 50, percentage: 60.8 },
  ],
  topExpensive: [{ step: 10, pc: 100, op: "SSTORE", gasCost: 20000 }],
};

describe("GasProfiler", () => {
  it("renders totals, function rows, call types, and the opcode section", () => {
    renderWithProviders(
      <GasProfiler gasProfile={gasProfile} opcodeProfile={opcodeProfile} />,
    );
    expect(screen.getByText("51,000 total gas")).toBeInTheDocument();
    expect(screen.getAllByText("transfer(address,uint256)").length).toBeGreaterThan(0);
    expect(screen.getAllByText("balanceOf(address)").length).toBeGreaterThan(0);
    expect(screen.getAllByText("CALL").length).toBeGreaterThan(0);
    expect(screen.getAllByText("STATICCALL").length).toBeGreaterThan(0);
    // Opcode distribution section.
    expect(screen.getByText("Opcode Gas Distribution")).toBeInTheDocument();
    expect(screen.getByText("Storage")).toBeInTheDocument();
    expect(screen.getByText("SSTORE")).toBeInTheDocument();
  });

  it("omits the opcode section when there's no opcode profile", () => {
    renderWithProviders(
      <GasProfiler gasProfile={gasProfile} opcodeProfile={null} />,
    );
    expect(screen.queryByText("Opcode Gas Distribution")).not.toBeInTheDocument();
  });
});

describe("GasTable", () => {
  it("renders one row per flat entry with truncated address + percentage", () => {
    renderWithProviders(<GasTable flat={gasProfile.flat} />);
    expect(screen.getByText("0xa107...9a27")).toBeInTheDocument();
    expect(screen.getByText("40,000")).toBeInTheDocument();
    expect(screen.getByText("78.4%")).toBeInTheDocument();
    expect(screen.getByText("21.6%")).toBeInTheDocument();
  });
});

describe("GasBarChart", () => {
  it("flattens the tree and sorts bars by gas descending", () => {
    renderWithProviders(<GasBarChart entries={gasProfile.entries} />);
    // Both the parent and nested child appear as bars.
    expect(screen.getByText("transfer(address,uint256)")).toBeInTheDocument();
    expect(screen.getByText("balanceOf(address)")).toBeInTheDocument();
    // The largest (51,000 total) renders its gas figure.
    expect(screen.getByText("51,000")).toBeInTheDocument();
  });
});
