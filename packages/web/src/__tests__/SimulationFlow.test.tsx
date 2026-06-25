import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "./_test-utils";
import type { SimulationResult } from "../types";

/**
 * Single-tx simulation flow: SimulationForm + SimulationResult + the
 * SimulationPage that wires them. The api/simulate module is mocked (it has
 * dedicated tests); here we drive the form → submit → result/error branches.
 *
 * Fixtures mirror the real on-chain WPLS token on PulseChain 369:
 *   WPLS  0xA1077a294dDE1B09bB078844df40758a5D0f9a27 (decimals 18, verified)
 *   transfer(address,uint256) selector 0xa9059cbb
 *   https://scan.pulsechain.com/address/0xA1077a294dDE1B09bB078844df40758a5D0f9a27
 */

const simulateTransaction = vi.fn();
vi.mock("../api/simulate", () => ({
  simulateTransaction: (...a: unknown[]) => simulateTransaction(...a),
}));

import SimulationPage from "../pages/SimulationPage";
import SimulationForm from "../components/SimulationForm";
import SimulationResultPanel from "../components/SimulationResult";

const WPLS = "0xA1077a294dDE1B09bB078844df40758a5D0f9a27";
const SENDER = "0x742D35CC6634c0532925A3b844BC9E7595F0BEb0";

const SUCCESS_RESULT: SimulationResult = {
  success: true,
  gasEstimate: "51234",
  returnData: "0x0000000000000000000000000000000000000000000000000000000000000001",
  decodedCall: {
    functionName: "transfer",
    params: [
      { name: "to", type: "address", value: SENDER },
      { name: "amount", type: "uint256", value: "1000000000000000000" },
    ],
  },
  decodedReturn: { values: [{ name: "", type: "bool", value: "true" }] },
  logs: [
    {
      address: WPLS,
      topics: ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"],
      data: "0x",
      decoded: {
        eventName: "Transfer",
        params: [{ name: "value", type: "uint256", value: "1000000000000000000" }],
      },
    },
  ],
};

beforeEach(() => vi.clearAllMocks());

describe("SimulationForm", () => {
  function noop() {}

  it("disables submit until from + to are valid addresses", () => {
    renderWithProviders(
      <SimulationForm onResult={noop} onLoading={noop} onError={noop} />,
    );
    const submit = screen.getByRole("button", { name: /Simulate Transaction/i });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText(/0x742d35Cc/), {
      target: { value: SENDER },
    });
    fireEvent.change(screen.getByPlaceholderText(/0xA0b86991/), {
      target: { value: WPLS },
    });
    expect(submit).not.toBeDisabled();
  });

  it("shows an invalid-address error for a malformed from address", () => {
    renderWithProviders(
      <SimulationForm onResult={noop} onLoading={noop} onError={noop} />,
    );
    fireEvent.change(screen.getByPlaceholderText(/0x742d35Cc/), {
      target: { value: "0xnotanaddress" },
    });
    expect(screen.getAllByText(/Invalid Ethereum address/i).length).toBeGreaterThan(0);
  });

  it("edits the gas-limit and block-number fields", () => {
    renderWithProviders(
      <SimulationForm onResult={noop} onLoading={noop} onError={noop} />,
    );
    const gas = screen.getByPlaceholderText("8000000");
    fireEvent.change(gas, { target: { value: "500000" } });
    expect((gas as HTMLInputElement).value).toBe("500000");
    const block = screen.getByPlaceholderText("latest");
    fireEvent.change(block, { target: { value: "26804492" } });
    expect((block as HTMLInputElement).value).toBe("26804492");
  });

  it("shows the wei conversion hint for a PLS value", () => {
    renderWithProviders(
      <SimulationForm onResult={noop} onLoading={noop} onError={noop} />,
    );
    fireEvent.change(screen.getByPlaceholderText("0.0"), {
      target: { value: "1" },
    });
    // 1 PLS = 1e18 wei, rendered via toLocaleString
    expect(screen.getByText(/wei/)).toBeInTheDocument();
  });

  it("submits with parsed value, calldata, gas and chainId, then reports the result", async () => {
    simulateTransaction.mockResolvedValue(SUCCESS_RESULT);
    const onResult = vi.fn();
    const onLoading = vi.fn();
    const onError = vi.fn();

    renderWithProviders(
      <SimulationForm onResult={onResult} onLoading={onLoading} onError={onError} />,
    );

    fireEvent.change(screen.getByPlaceholderText(/0x742d35Cc/), {
      target: { value: SENDER },
    });
    fireEvent.change(screen.getByPlaceholderText(/0xA0b86991/), {
      target: { value: WPLS },
    });
    fireEvent.change(screen.getByPlaceholderText("0.0"), {
      target: { value: "1" },
    });
    fireEvent.change(screen.getByPlaceholderText(/0xa9059cbb/), {
      target: { value: "0xa9059cbb" },
    });

    fireEvent.click(screen.getByRole("button", { name: /Simulate Transaction/i }));

    await waitFor(() => expect(simulateTransaction).toHaveBeenCalled());
    const [req] = simulateTransaction.mock.calls[0]!;
    expect(req.from).toBe(SENDER);
    expect(req.to).toBe(WPLS);
    expect(req.value).toBe("0x" + (10n ** 18n).toString(16));
    expect(req.data).toBe("0xa9059cbb");
    expect(req.gasLimit).toBe(8000000);
    expect(onLoading).toHaveBeenCalledWith(true);
    expect(onLoading).toHaveBeenLastCalledWith(false);
    expect(onResult).toHaveBeenCalledWith(SUCCESS_RESULT);
  });

  it("reports an error string when the simulate call rejects", async () => {
    simulateTransaction.mockRejectedValue(new Error("Simulation failed: execution reverted"));
    const onError = vi.fn();

    renderWithProviders(
      <SimulationForm onResult={vi.fn()} onLoading={vi.fn()} onError={onError} />,
    );
    fireEvent.change(screen.getByPlaceholderText(/0x742d35Cc/), {
      target: { value: SENDER },
    });
    fireEvent.change(screen.getByPlaceholderText(/0xA0b86991/), {
      target: { value: WPLS },
    });
    fireEvent.click(screen.getByRole("button", { name: /Simulate Transaction/i }));

    await waitFor(() =>
      expect(onError).toHaveBeenCalledWith("Simulation failed: execution reverted"),
    );
  });

  it("does not submit when canSubmit is false (no-op handleSubmit guard)", () => {
    renderWithProviders(
      <SimulationForm onResult={vi.fn()} onLoading={vi.fn()} onError={vi.fn()} />,
    );
    // Submit the form element directly even though the button is disabled.
    const form = document.querySelector("form")!;
    fireEvent.submit(form);
    expect(simulateTransaction).not.toHaveBeenCalled();
  });
});

describe("SimulationResultPanel", () => {
  it("renders the empty state with no result", () => {
    renderWithProviders(
      <SimulationResultPanel result={null} loading={false} error={null} />,
    );
    expect(screen.getByText(/No Simulation Results/i)).toBeInTheDocument();
  });

  it("renders the loading state", () => {
    renderWithProviders(
      <SimulationResultPanel result={null} loading={true} error={null} />,
    );
    expect(screen.getByText(/Simulating Transaction/i)).toBeInTheDocument();
  });

  it("renders the error state", () => {
    renderWithProviders(
      <SimulationResultPanel result={null} loading={false} error="reverted: bad" />,
    );
    expect(screen.getByText(/Simulation Error/i)).toBeInTheDocument();
    expect(screen.getByText(/reverted: bad/)).toBeInTheDocument();
  });

  it("renders gas, decoded call, decoded return and decoded log", () => {
    renderWithProviders(
      <SimulationResultPanel result={SUCCESS_RESULT} loading={false} error={null} />,
    );
    expect(screen.getByText(/Gas Estimate/i)).toBeInTheDocument();
    expect(screen.getByText("51,234")).toBeInTheDocument();
    expect(screen.getByText(/Decoded Function Call/i)).toBeInTheDocument();
    expect(screen.getByText(/Decoded Return Value/i)).toBeInTheDocument();
    expect(screen.getByText(/Event Logs/i)).toBeInTheDocument();
    expect(screen.getByText("Transfer")).toBeInTheDocument();
  });

  it("renders revert reason, raw return data, and an undecoded log", () => {
    const reverted: SimulationResult = {
      success: false,
      gasEstimate: null,
      returnData: "0xdeadbeef",
      revertReason: "ERC20: transfer amount exceeds balance",
      logs: [
        {
          address: WPLS,
          topics: ["0xtopic0", "0xtopic1"],
          data: "0xrawdata",
        },
      ],
    };
    renderWithProviders(
      <SimulationResultPanel result={reverted} loading={false} error={null} />,
    );
    // null gas → em dash
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText(/Return Data \(raw\)/i)).toBeInTheDocument();
    expect(screen.getByText(/transfer amount exceeds balance/)).toBeInTheDocument();
    // Undecoded log falls back to Address / Data / Topic rows
    expect(screen.getByText("Topic 0")).toBeInTheDocument();
    expect(screen.getByText("Topic 1")).toBeInTheDocument();
  });
});

describe("SimulationPage", () => {
  it("wires the form result through to the result panel", async () => {
    simulateTransaction.mockResolvedValue(SUCCESS_RESULT);
    renderWithProviders(<SimulationPage />);

    fireEvent.change(screen.getByPlaceholderText(/0x742d35Cc/), {
      target: { value: SENDER },
    });
    fireEvent.change(screen.getByPlaceholderText(/0xA0b86991/), {
      target: { value: WPLS },
    });
    // Starts in empty state
    expect(screen.getByText(/No Simulation Results/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Simulate Transaction/i }));

    expect(await screen.findByText(/Simulation Result/i)).toBeInTheDocument();
    expect(screen.getByText("51,234")).toBeInTheDocument();
  });
});
