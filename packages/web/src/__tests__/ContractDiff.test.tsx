import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { DiffResult } from "../components/ContractDiff/types";

/**
 * ContractDiff compares verified source between two contracts. fetchDiff (raw
 * fetch in ContractDiff/api) is mocked; we drive the input validation, the
 * compare flow, the summary bar, the file diff table, and the empty/error
 * branches.
 *
 * Fixtures are PulseChain 369 contracts:
 *   WPLS 0xA1077a294dDE1B09bB078844df40758a5D0f9a27
 *   https://scan.pulsechain.com/address/0xA1077a294dDE1B09bB078844df40758a5D0f9a27
 */

const fetchDiff = vi.fn();
vi.mock("../components/ContractDiff/api", async () => {
  const actual = await vi.importActual<
    typeof import("../components/ContractDiff/api")
  >("../components/ContractDiff/api");
  return { ...actual, fetchDiff: (...a: unknown[]) => fetchDiff(...a) };
});

import ContractDiff from "../components/ContractDiff";
import { shortAddr, ADDRESS_RE } from "../components/ContractDiff/api";
import { SummaryBar } from "../components/ContractDiff/SummaryBar";
import { FileDiffView } from "../components/ContractDiff/FileDiffView";

const ADDR_A = "0xA1077a294dDE1B09bB078844df40758a5D0f9a27";
const ADDR_B = "0x95B303987A60C71504D99Aa1b13B4DA07b0790ab";

const RESULT: DiffResult = {
  contractA: { address: ADDR_A, name: "WPLS" },
  contractB: { address: ADDR_B, name: null },
  files: [
    {
      filename: "Token.sol",
      status: "changed",
      linesAdded: 2,
      linesRemoved: 1,
      lines: [
        { type: "context", lineA: 1, lineB: 1, content: "pragma solidity ^0.8.20;" },
        { type: "removed", lineA: 2, lineB: null, content: "uint256 x;" },
        { type: "added", lineA: null, lineB: 2, content: "uint256 y;" },
        { type: "added", lineA: null, lineB: 3, content: "uint256 z;" },
      ],
    },
  ],
  summary: {
    filesChanged: 1,
    filesAdded: 0,
    filesRemoved: 0,
    totalLinesAdded: 2,
    totalLinesRemoved: 1,
  },
};

beforeEach(() => vi.clearAllMocks());

describe("ContractDiff/api helpers", () => {
  it("shortAddr abbreviates", () => {
    expect(shortAddr(ADDR_A)).toBe("0xA107…9a27");
  });
  it("ADDRESS_RE validates 20-byte hex", () => {
    expect(ADDRESS_RE.test(ADDR_A)).toBe(true);
    expect(ADDRESS_RE.test("0x123")).toBe(false);
  });
});

describe("ContractDiff", () => {
  it("disables Compare until two distinct valid addresses are entered", () => {
    render(<ContractDiff />);
    const compare = screen.getByRole("button", { name: /Compare/ });
    expect(compare).toBeDisabled();

    const inputs = screen.getAllByPlaceholderText("0x...");
    const a = inputs[0]!;
    const b = inputs[1]!;
    fireEvent.change(a, { target: { value: ADDR_A } });
    fireEvent.change(b, { target: { value: ADDR_A } });
    // Same address → still disabled + warning
    expect(screen.getByText(/Addresses must be different/)).toBeInTheDocument();
    expect(compare).toBeDisabled();

    fireEvent.change(b, { target: { value: ADDR_B } });
    expect(compare).not.toBeDisabled();
  });

  it("flags an invalid address", () => {
    render(<ContractDiff />);
    const a = screen.getAllByPlaceholderText("0x...")[0]!;
    fireEvent.change(a, { target: { value: "0xnope" } });
    expect(screen.getByText("Invalid address")).toBeInTheDocument();
  });

  it("renders the summary + file diff on a successful compare", async () => {
    fetchDiff.mockResolvedValue({ ok: true, diff: RESULT });
    render(<ContractDiff />);
    const inputs = screen.getAllByPlaceholderText("0x...");
    const a = inputs[0]!;
    const b = inputs[1]!;
    fireEvent.change(a, { target: { value: ADDR_A } });
    fireEvent.change(b, { target: { value: ADDR_B } });
    fireEvent.click(screen.getByRole("button", { name: /Compare/ }));

    expect(await screen.findByText("Token.sol")).toBeInTheDocument();
    // Summary contract names: WPLS vs short addr (B has null name)
    expect(screen.getByText("WPLS")).toBeInTheDocument();
    expect(screen.getByText(shortAddr(ADDR_B))).toBeInTheDocument();
    // file rows (expanded by default) render added/removed content
    expect(screen.getByText("uint256 y;")).toBeInTheDocument();
    // collapse the file
    fireEvent.click(screen.getByText("Token.sol"));
    await waitFor(() =>
      expect(screen.queryByText("uint256 y;")).not.toBeInTheDocument(),
    );
  });

  it("shows the no-differences message for an empty file list", async () => {
    fetchDiff.mockResolvedValue({
      ok: true,
      diff: { ...RESULT, files: [], summary: { ...RESULT.summary, filesChanged: 0 } },
    });
    render(<ContractDiff />);
    const inputs = screen.getAllByPlaceholderText("0x...");
    const a = inputs[0]!;
    const b = inputs[1]!;
    fireEvent.change(a, { target: { value: ADDR_A } });
    fireEvent.change(b, { target: { value: ADDR_B } });
    fireEvent.click(screen.getByRole("button", { name: /Compare/ }));
    expect(
      await screen.findByText(/No source code differences/i),
    ).toBeInTheDocument();
  });

  it("shows the API error message when the response is not ok", async () => {
    fetchDiff.mockResolvedValue({ ok: false, error: "Contract B not verified" });
    render(<ContractDiff />);
    const inputs = screen.getAllByPlaceholderText("0x...");
    const a = inputs[0]!;
    const b = inputs[1]!;
    fireEvent.change(a, { target: { value: ADDR_A } });
    fireEvent.change(b, { target: { value: ADDR_B } });
    fireEvent.click(screen.getByRole("button", { name: /Compare/ }));
    expect(await screen.findByText("Contract B not verified")).toBeInTheDocument();
  });

  it("shows a thrown-error message when fetchDiff rejects", async () => {
    fetchDiff.mockRejectedValue(new Error("network down"));
    render(<ContractDiff />);
    const inputs = screen.getAllByPlaceholderText("0x...");
    const a = inputs[0]!;
    const b = inputs[1]!;
    fireEvent.change(a, { target: { value: ADDR_A } });
    fireEvent.change(b, { target: { value: ADDR_B } });
    fireEvent.click(screen.getByRole("button", { name: /Compare/ }));
    expect(await screen.findByText("network down")).toBeInTheDocument();
  });
});

describe("ContractDiff presentational pieces", () => {
  it("SummaryBar renders added/removed file counts", () => {
    const result: DiffResult = {
      ...RESULT,
      contractA: { address: ADDR_A, name: null },
      contractB: { address: ADDR_B, name: "Other" },
      summary: {
        filesChanged: 0,
        filesAdded: 2,
        filesRemoved: 1,
        totalLinesAdded: 10,
        totalLinesRemoved: 4,
      },
    };
    render(<SummaryBar result={result} />);
    expect(screen.getByText("+2 added")).toBeInTheDocument();
    expect(screen.getByText("-1 removed")).toBeInTheDocument();
    expect(screen.getByText("+10")).toBeInTheDocument();
    expect(screen.getByText("-4")).toBeInTheDocument();
    // A has null name → short addr
    expect(screen.getByText(shortAddr(ADDR_A))).toBeInTheDocument();
  });

  it("FileDiffView renders added/removed file statuses and toggles", () => {
    const onToggle = vi.fn();
    const { rerender } = render(
      <FileDiffView
        file={{ ...RESULT.files[0]!, status: "added" }}
        isExpanded={false}
        onToggle={onToggle}
      />,
    );
    expect(screen.getByText("added")).toBeInTheDocument();
    // collapsed → no table rows
    expect(screen.queryByText("uint256 y;")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Token.sol"));
    expect(onToggle).toHaveBeenCalled();

    rerender(
      <FileDiffView
        file={{ ...RESULT.files[0]!, status: "removed" }}
        isExpanded={true}
        onToggle={onToggle}
      />,
    );
    expect(screen.getByText("removed")).toBeInTheDocument();
    expect(screen.getByText("uint256 y;")).toBeInTheDocument();
  });
});
