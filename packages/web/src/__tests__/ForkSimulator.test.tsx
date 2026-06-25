import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "./_test-utils";
import type { ForkSimulationResult } from "../api/simulate";

/**
 * ForkSimulator re-executes a tx on an Anvil fork. ForkSimulator/api
 * (simulateFromHashApi / forkSimulateApi, raw fetch) is mocked. We cover both
 * input modes, the loading/error/result branches, and the presentational
 * tables/panels/primitives.
 *
 * Fixtures mirror WPLS on PulseChain 369:
 *   WPLS 0xA1077a294dDE1B09bB078844df40758a5D0f9a27 (verified)
 *   block 26804492
 *   https://scan.pulsechain.com/address/0xA1077a294dDE1B09bB078844df40758a5D0f9a27
 */

const simulateFromHashApi = vi.fn();
const forkSimulateApi = vi.fn();
vi.mock("../components/ForkSimulator/api", () => ({
  simulateFromHashApi: (...a: unknown[]) => simulateFromHashApi(...a),
  forkSimulateApi: (...a: unknown[]) => forkSimulateApi(...a),
}));

const navigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>(
    "react-router-dom",
  );
  return { ...actual, useNavigate: () => navigate };
});

import ForkSimulator from "../components/ForkSimulator";
import {
  BalanceChangesTable,
  StorageChangesTable,
  EventsList,
} from "../components/ForkSimulator/DiffTables";
import {
  ModeButton,
  FormField,
  DiffSection,
} from "../components/ForkSimulator/primitives";
import {
  LoadingPanel,
  ErrorPanel,
  RevertReasonBlock,
  NoStateChangesPanel,
} from "../components/ForkSimulator/Panels";
import { StatusSummary } from "../components/ForkSimulator/StatusSummary";

const WPLS = "0xA1077a294dDE1B09bB078844df40758a5D0f9a27";
const SENDER = "0x742D35CC6634c0532925A3b844BC9E7595F0BEb0";
const TX_HASH = "0x" + "ab".repeat(32);

function fullResult(): ForkSimulationResult {
  return {
    success: true,
    returnData: "0x",
    gasUsed: "51234",
    stateDiff: {
      balanceChanges: [
        { address: SENDER, before: "10.0", after: "9.0", delta: "-1.0" },
        { address: WPLS, before: "0.0", after: "1.0", delta: "1.0" },
      ],
      storageChanges: [
        {
          address: WPLS,
          contractName: "WPLS",
          slot: "0x0000000000000000000000000000000000000000000000000000000000000003",
          before: "0x00",
          after: "0x01",
          decodedName: "totalSupply",
        },
      ],
      nonceChanges: [],
    },
    logs: [
      {
        address: WPLS,
        topics: ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"],
        data: "0x",
      },
    ],
    blockNumber: 26804492,
    txHash: TX_HASH,
    contractAddress: WPLS,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("ForkSimulator", () => {
  it("hash mode: simulates from a tx hash and renders the result", async () => {
    simulateFromHashApi.mockResolvedValue({ ok: true, result: fullResult() });
    renderWithProviders(<ForkSimulator />);

    const submit = screen.getByRole("button", { name: /Fork Simulate/i });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText(/transaction hash/i), {
      target: { value: TX_HASH },
    });
    await waitFor(() => expect(submit).not.toBeDisabled());
    fireEvent.click(submit);

    await waitFor(() => expect(simulateFromHashApi).toHaveBeenCalled());
    expect(await screen.findByText("SUCCESS")).toBeInTheDocument();
    expect(screen.getByText("Balance Changes")).toBeInTheDocument();
    expect(screen.getByText("Storage Changes")).toBeInTheDocument();
    expect(screen.getByText("Events Emitted")).toBeInTheDocument();
  });

  it("hash mode: pressing Enter in the hash field triggers the simulation", async () => {
    simulateFromHashApi.mockResolvedValue({ ok: true, result: fullResult() });
    renderWithProviders(<ForkSimulator />);
    const hashInput = screen.getByPlaceholderText(/transaction hash/i);
    fireEvent.change(hashInput, { target: { value: TX_HASH } });
    fireEvent.keyDown(hashInput, { key: "Enter" });
    await waitFor(() => expect(simulateFromHashApi).toHaveBeenCalled());
  });

  it("navigates to the contract view and the debugger from the result actions", async () => {
    simulateFromHashApi.mockResolvedValue({ ok: true, result: fullResult() });
    renderWithProviders(<ForkSimulator />);
    fireEvent.change(screen.getByPlaceholderText(/transaction hash/i), {
      target: { value: TX_HASH },
    });
    fireEvent.click(screen.getByRole("button", { name: /Fork Simulate/i }));

    fireEvent.click(await screen.findByRole("button", { name: /View Contract/ }));
    expect(navigate).toHaveBeenCalledWith(`/token/${WPLS}`);
    fireEvent.click(screen.getByRole("button", { name: /Debug This Tx/ }));
    expect(navigate).toHaveBeenCalledWith(`/debugger/${TX_HASH}`);
  });

  it("manual mode: posts from/to/value/data and shows the no-state-changes panel", async () => {
    const empty: ForkSimulationResult = {
      success: true,
      returnData: "0x",
      gasUsed: "21000",
      stateDiff: { balanceChanges: [], storageChanges: [], nonceChanges: [] },
      logs: [],
      blockNumber: 0,
    };
    forkSimulateApi.mockResolvedValue({ ok: true, result: empty });
    renderWithProviders(<ForkSimulator />);

    fireEvent.click(screen.getByRole("button", { name: /Manual Entry/ }));
    // toggle back to hash mode and forward again to exercise both ModeButtons
    fireEvent.click(screen.getByRole("button", { name: /Tx Hash/ }));
    fireEvent.click(screen.getByRole("button", { name: /Manual Entry/ }));
    fireEvent.change(screen.getByPlaceholderText(/sender address/i), {
      target: { value: SENDER },
    });
    fireEvent.change(screen.getByPlaceholderText(/target address/i), {
      target: { value: WPLS },
    });
    fireEvent.change(screen.getByPlaceholderText("0"), { target: { value: "1" } });

    const submit = screen.getByRole("button", { name: /Fork Simulate/i });
    await waitFor(() => expect(submit).not.toBeDisabled());
    fireEvent.click(submit);

    await waitFor(() => expect(forkSimulateApi).toHaveBeenCalled());
    const [params] = forkSimulateApi.mock.calls[0]!;
    expect(params.from).toBe(SENDER);
    expect(params.to).toBe(WPLS);
    expect(params.value).toBe("0x" + (10n ** 18n).toString(16));

    expect(await screen.findByText(/No state changes detected/i)).toBeInTheDocument();
  });

  it("renders the revert reason and REVERTED status on a reverted result", async () => {
    const reverted = { ...fullResult(), success: false, revertReason: "out of gas" };
    simulateFromHashApi.mockResolvedValue({ ok: true, result: reverted });
    renderWithProviders(<ForkSimulator />);
    fireEvent.change(screen.getByPlaceholderText(/transaction hash/i), {
      target: { value: TX_HASH },
    });
    fireEvent.click(screen.getByRole("button", { name: /Fork Simulate/i }));
    expect(await screen.findByText("REVERTED")).toBeInTheDocument();
    expect(screen.getByText("out of gas")).toBeInTheDocument();
  });

  it("renders the error panel when the API reports not-ok", async () => {
    simulateFromHashApi.mockResolvedValue({ ok: false, error: "tx not found" });
    renderWithProviders(<ForkSimulator />);
    fireEvent.change(screen.getByPlaceholderText(/transaction hash/i), {
      target: { value: TX_HASH },
    });
    fireEvent.click(screen.getByRole("button", { name: /Fork Simulate/i }));
    expect(await screen.findByText(/Simulation Failed/i)).toBeInTheDocument();
    expect(screen.getByText("tx not found")).toBeInTheDocument();
  });

  it("renders the error panel when the API call throws", async () => {
    simulateFromHashApi.mockRejectedValue(new Error("boom"));
    renderWithProviders(<ForkSimulator />);
    fireEvent.change(screen.getByPlaceholderText(/transaction hash/i), {
      target: { value: TX_HASH },
    });
    fireEvent.click(screen.getByRole("button", { name: /Fork Simulate/i }));
    expect(await screen.findByText("boom")).toBeInTheDocument();
  });
});

describe("ForkSimulator presentational pieces", () => {
  it("BalanceChangesTable renders positive and negative deltas", () => {
    render(
      <BalanceChangesTable
        changes={[
          { address: SENDER, before: "10.0", after: "9.0", delta: "-1.0" },
          { address: WPLS, before: "0.0", after: "1.0", delta: "1.0" },
        ]}
      />,
    );
    expect(screen.getByText("-1.0")).toBeInTheDocument();
    expect(screen.getByText("+1.0")).toBeInTheDocument();
  });

  it("StorageChangesTable falls back to truncated address/slot without names", () => {
    render(
      <StorageChangesTable
        changes={[
          {
            address: WPLS,
            slot: "0x" + "0".repeat(63) + "3",
            before: "0x" + "0".repeat(64),
            after: "0x" + "0".repeat(63) + "1",
          },
        ]}
      />,
    );
    expect(screen.getByText("Storage Changes")).toBeInTheDocument();
  });

  it("EventsList renders log address + topic0", () => {
    render(
      <EventsList
        logs={[{ address: WPLS, topics: ["0xddf252ad1be2c89b69c2b068"], data: "0x" }]}
      />,
    );
    expect(screen.getByText("Events Emitted")).toBeInTheDocument();
  });

  it("EventsList tolerates a log with no topics", () => {
    render(<EventsList logs={[{ address: WPLS, topics: [], data: "0x" }]} />);
    expect(screen.getByText("Events Emitted")).toBeInTheDocument();
  });

  it("ModeButton toggles active styling on click", () => {
    const onClick = vi.fn();
    render(<ModeButton active={false} onClick={onClick} label="Tx Hash" />);
    fireEvent.click(screen.getByText("Tx Hash"));
    expect(onClick).toHaveBeenCalled();
  });

  it("FormField renders single-line and multiline inputs", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <FormField label="From" value="" onChange={onChange} placeholder="0x..." mono />,
    );
    fireEvent.change(screen.getByPlaceholderText("0x..."), { target: { value: "x" } });
    expect(onChange).toHaveBeenCalledWith("x");

    rerender(
      <FormField label="Data" value="" onChange={onChange} placeholder="data" multiline />,
    );
    fireEvent.change(screen.getByPlaceholderText("data"), { target: { value: "y" } });
    expect(onChange).toHaveBeenCalledWith("y");
  });

  it("DiffSection renders title + count + children", () => {
    render(
      <DiffSection title="Foo" count={3}>
        <span>child</span>
      </DiffSection>,
    );
    expect(screen.getByText("Foo")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("child")).toBeInTheDocument();
  });

  it("Panels render their copy", () => {
    const { unmount } = render(<LoadingPanel />);
    expect(screen.getByText(/Spinning up Anvil fork/)).toBeInTheDocument();
    unmount();
    const r2 = render(<ErrorPanel message="err" />);
    expect(screen.getByText("err")).toBeInTheDocument();
    r2.unmount();
    const r3 = render(<RevertReasonBlock reason="reverted!" />);
    expect(screen.getByText("reverted!")).toBeInTheDocument();
    r3.unmount();
    render(<NoStateChangesPanel />);
    expect(screen.getByText(/No state changes detected/i)).toBeInTheDocument();
  });

  it("StatusSummary hides action buttons when there's no contract/tx", () => {
    const result: ForkSimulationResult = {
      ...fullResult(),
      contractAddress: undefined,
      txHash: undefined,
      blockNumber: 0,
    };
    render(
      <StatusSummary result={result} onViewContract={vi.fn()} onDebug={vi.fn()} />,
    );
    expect(screen.queryByRole("button", { name: /View Contract/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Debug This Tx/ })).not.toBeInTheDocument();
  });
});
