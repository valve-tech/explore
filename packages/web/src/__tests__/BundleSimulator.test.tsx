import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "./_test-utils";
import type { SimulationResult, BundleTxEntry } from "../types";

/**
 * BundleSimulator orchestrates an ordered list of TxCards and renders the
 * ResultPanels / BundleResultCard / SummaryBar. api/simulate.simulateBundle is
 * mocked (tested elsewhere).
 *
 * Fixtures mirror WPLS on PulseChain 369:
 *   WPLS 0xA1077a294dDE1B09bB078844df40758a5D0f9a27 (decimals 18, verified)
 *   https://scan.pulsechain.com/address/0xA1077a294dDE1B09bB078844df40758a5D0f9a27
 */

const simulateBundle = vi.fn();
vi.mock("../api/simulate", () => ({
  simulateBundle: (...a: unknown[]) => simulateBundle(...a),
}));

import BundleSimulator from "../components/BundleSimulator";
import { TxCard } from "../components/BundleSimulator/TxCard";
import { BundleResultCard } from "../components/BundleSimulator/BundleResultCard";
import {
  LoadingPanel,
  ErrorPanel,
  EmptyPanel,
  SummaryBar,
} from "../components/BundleSimulator/ResultPanels";
import { createEmptyTx, generateId } from "../components/BundleSimulator/helpers";

const WPLS = "0xA1077a294dDE1B09bB078844df40758a5D0f9a27";
const SENDER = "0x742D35CC6634c0532925A3b844BC9E7595F0BEb0";

beforeEach(() => vi.clearAllMocks());

describe("BundleSimulator helpers", () => {
  it("generateId returns a short alphanumeric id", () => {
    const id = generateId();
    expect(id).toMatch(/^[a-z0-9]+$/);
    expect(id.length).toBeGreaterThan(0);
  });

  it("createEmptyTx seeds an empty tx with default gas", () => {
    const tx = createEmptyTx();
    expect(tx.from).toBe("");
    expect(tx.to).toBe("");
    expect(tx.gasLimit).toBe("8000000");
  });
});

describe("BundleSimulator", () => {
  it("starts with one tx card, empty results, and a disabled submit", () => {
    renderWithProviders(<BundleSimulator />);
    expect(screen.getByText("Transaction #1")).toBeInTheDocument();
    expect(screen.getByText(/No Bundle Results/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Simulate Bundle/i })).toBeDisabled();
  });

  it("adds and removes transactions", () => {
    renderWithProviders(<BundleSimulator />);
    fireEvent.click(screen.getByRole("button", { name: /Add Transaction/i }));
    expect(screen.getByText("Transaction #2")).toBeInTheDocument();
    // Remove button now visible (canRemove true)
    fireEvent.click(screen.getAllByRole("button", { name: /^Remove$/ })[0]!);
    expect(screen.queryByText("Transaction #2")).not.toBeInTheDocument();
  });

  it("simulates a valid bundle and renders the summary + per-tx cards", async () => {
    const results: SimulationResult[] = [
      { success: true, gasEstimate: "21000", returnData: "0x" },
      { success: false, gasEstimate: null, returnData: "0x", revertReason: "reverted" },
    ];
    simulateBundle.mockResolvedValue({ results });

    renderWithProviders(<BundleSimulator />);
    // Fill the first tx
    const fromInputs = screen.getAllByPlaceholderText("0x...");
    fireEvent.change(fromInputs[0]!, { target: { value: SENDER } });
    fireEvent.change(fromInputs[1]!, { target: { value: WPLS } });
    fireEvent.change(screen.getByPlaceholderText("0.0"), { target: { value: "1" } });

    const submit = screen.getByRole("button", { name: /Simulate Bundle/i });
    await waitFor(() => expect(submit).not.toBeDisabled());
    fireEvent.click(submit);

    await waitFor(() => expect(simulateBundle).toHaveBeenCalled());
    const [req] = simulateBundle.mock.calls[0]!;
    expect(req.transactions[0].value).toBe("0x" + (10n ** 18n).toString(16));

    expect(await screen.findByText("1 succeeded")).toBeInTheDocument();
    expect(screen.getByText("1 reverted")).toBeInTheDocument();
  });

  it("renders the error panel when the bundle call rejects", async () => {
    simulateBundle.mockRejectedValue(new Error("Bundle simulation failed: boom"));
    renderWithProviders(<BundleSimulator />);
    const inputs = screen.getAllByPlaceholderText("0x...");
    fireEvent.change(inputs[0]!, { target: { value: SENDER } });
    fireEvent.change(inputs[1]!, { target: { value: WPLS } });
    fireEvent.click(screen.getByRole("button", { name: /Simulate Bundle/i }));
    expect(await screen.findByText(/Bundle Simulation Error/i)).toBeInTheDocument();
    expect(screen.getByText(/boom/)).toBeInTheDocument();
  });
});

describe("BundleSimulator presentational pieces", () => {
  const tx: BundleTxEntry = {
    id: "a",
    from: "",
    to: "",
    value: "",
    data: "",
    gasLimit: "8000000",
  };

  it("TxCard fires onChange for each field and onRemove when removable", () => {
    const onChange = vi.fn();
    const onRemove = vi.fn();
    render(
      <TxCard tx={tx} index={0} onChange={onChange} onRemove={onRemove} canRemove />,
    );
    // From, To, and Calldata all use "0x..." placeholder (inputs + textarea).
    const zeroX = screen.getAllByPlaceholderText("0x...");
    fireEvent.change(zeroX[0]!, { target: { value: SENDER } });
    expect(onChange).toHaveBeenCalledWith("a", "from", SENDER);
    fireEvent.change(zeroX[1]!, { target: { value: WPLS } });
    expect(onChange).toHaveBeenCalledWith("a", "to", WPLS);
    fireEvent.change(zeroX[2]!, { target: { value: "0xa9059cbb" } });
    expect(onChange).toHaveBeenCalledWith("a", "data", "0xa9059cbb");
    fireEvent.change(screen.getByPlaceholderText("0.0"), { target: { value: "2" } });
    expect(onChange).toHaveBeenCalledWith("a", "value", "2");
    fireEvent.change(screen.getByPlaceholderText("8000000"), { target: { value: "1" } });
    expect(onChange).toHaveBeenCalledWith("a", "gasLimit", "1");
    fireEvent.click(screen.getByRole("button", { name: /Remove/ }));
    expect(onRemove).toHaveBeenCalledWith("a");
  });

  it("TxCard hides the Remove button when not removable, flags invalid addresses", () => {
    const badTx: BundleTxEntry = { ...tx, from: "0xbad", to: "0xbad" };
    render(<TxCard tx={badTx} index={1} onChange={vi.fn()} onRemove={vi.fn()} canRemove={false} />);
    expect(screen.queryByRole("button", { name: /Remove/ })).not.toBeInTheDocument();
    expect(screen.getByText("Transaction #2")).toBeInTheDocument();
  });

  it("LoadingPanel pluralizes the count", () => {
    const { rerender } = render(<LoadingPanel count={1} />);
    expect(screen.getByText(/Simulating 1 transaction\.\.\./)).toBeInTheDocument();
    rerender(<LoadingPanel count={3} />);
    expect(screen.getByText(/Simulating 3 transactions\.\.\./)).toBeInTheDocument();
  });

  it("ErrorPanel + EmptyPanel render", () => {
    const { unmount } = render(<ErrorPanel message="nope" />);
    expect(screen.getByText("nope")).toBeInTheDocument();
    unmount();
    render(<EmptyPanel />);
    expect(screen.getByText(/No Bundle Results/i)).toBeInTheDocument();
  });

  it("SummaryBar sums gas and counts successes/reverts", () => {
    const results: SimulationResult[] = [
      { success: true, gasEstimate: "21000", returnData: "0x" },
      { success: false, gasEstimate: null, returnData: "0x" },
    ];
    render(<SummaryBar results={results} />);
    expect(screen.getByText("1 succeeded")).toBeInTheDocument();
    expect(screen.getByText("1 reverted")).toBeInTheDocument();
    expect(screen.getByText(/21,000 total gas/)).toBeInTheDocument();
  });

  it("BundleResultCard renders gas, return data, revert reason and decoded call", () => {
    const result: SimulationResult = {
      success: false,
      gasEstimate: "30000",
      returnData: "0xdeadbeef",
      revertReason: "ERC20: insufficient balance",
      decodedCall: {
        functionName: "transfer",
        params: [{ name: "to", type: "address", value: WPLS }],
      },
    };
    render(<BundleResultCard result={result} index={0} />);
    expect(screen.getByText("30,000")).toBeInTheDocument();
    expect(screen.getByText("0xdeadbeef")).toBeInTheDocument();
    expect(screen.getByText(/insufficient balance/)).toBeInTheDocument();
    expect(screen.getByText(/transfer\(address\)/)).toBeInTheDocument();
  });

  it("BundleResultCard shows em-dash gas for a null estimate", () => {
    const result: SimulationResult = {
      success: true,
      gasEstimate: null,
      returnData: "0x",
    };
    render(<BundleResultCard result={result} index={1} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
