import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SearchBar } from "../components/debugger/DebuggerView/SearchBar";
import { Tabs } from "../components/debugger/DebuggerView/Tabs";
import { ErrorPanel } from "../components/debugger/DebuggerView/ErrorPanel";
import { LoadingPanel } from "../components/debugger/DebuggerView/LoadingPanel";
import { NoDataPanel } from "../components/debugger/DebuggerView/NoDataPanel";
import { EmptyState } from "../components/debugger/DebuggerView/EmptyState";

// EmptyState reads the recently-debugged list. Drive it through the hook so we
// can exercise both the empty and populated branches without touching IDB.
const recentTxs = vi.hoisted(() => ({
  value: [] as Array<{ hash: string; lastSeen: number }>,
}));
vi.mock("../hooks/useRecentDebuggerTxs", () => ({
  useRecentDebuggerTxs: () => recentTxs.value,
}));
const removeDebuggerTx = vi.hoisted(() => vi.fn());
const clearDebuggerTxs = vi.hoisted(() => vi.fn());
vi.mock("../lib/recentDebuggerTxs", () => ({
  removeDebuggerTx,
  clearDebuggerTxs,
}));

function withRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe("DebuggerView/SearchBar", () => {
  it("calls onSubmit when Debug is clicked with a valid hash", () => {
    const onSubmit = vi.fn();
    render(
      <SearchBar
        txHash="0xabc"
        setTxHash={() => {}}
        isValidHash
        loading={false}
        onSubmit={onSubmit}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Debug" }));
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("submits on Enter key in the input", () => {
    const onSubmit = vi.fn();
    render(
      <SearchBar
        txHash="0xabc"
        setTxHash={() => {}}
        isValidHash
        loading={false}
        onSubmit={onSubmit}
      />,
    );
    fireEvent.keyDown(screen.getByPlaceholderText("0x... transaction hash"), {
      key: "Enter",
    });
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("trims input as the user types", () => {
    const setTxHash = vi.fn();
    render(
      <SearchBar
        txHash=""
        setTxHash={setTxHash}
        isValidHash={false}
        loading={false}
        onSubmit={() => {}}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText("0x... transaction hash"), {
      target: { value: "  0xdeadbeef  " },
    });
    expect(setTxHash).toHaveBeenCalledWith("0xdeadbeef");
  });

  it("shows the Tracing label and disables the button while loading", () => {
    render(
      <SearchBar
        txHash="0xabc"
        setTxHash={() => {}}
        isValidHash
        loading
        onSubmit={() => {}}
      />,
    );
    const btn = screen.getByRole("button", { name: "Tracing..." });
    expect(btn).toBeDisabled();
  });

  it("warns when the hash is invalid and longer than 2 chars", () => {
    render(
      <SearchBar
        txHash="0xzz"
        setTxHash={() => {}}
        isValidHash={false}
        loading={false}
        onSubmit={() => {}}
      />,
    );
    expect(
      screen.getByText(/Invalid transaction hash/),
    ).toBeInTheDocument();
  });
});

describe("DebuggerView/Tabs", () => {
  it("renders all four tabs and a step-count badge", () => {
    const setActiveTab = vi.fn();
    render(
      <Tabs
        activeTab="debugger"
        setActiveTab={setActiveTab}
        opcodeStepCount={1234}
        hasCallTrace
        hasGasProfile
      />,
    );
    expect(screen.getByText("Step Debugger")).toBeInTheDocument();
    expect(screen.getByText("Call Tree")).toBeInTheDocument();
    expect(screen.getByText("Gas Profile")).toBeInTheDocument();
    expect(screen.getByText("Opcodes")).toBeInTheDocument();
    // 1234 toLocaleString → "1,234"; appears on both Debugger and Opcodes tabs.
    expect(screen.getAllByText("1,234").length).toBe(2);
  });

  it("switches tab on click", () => {
    const setActiveTab = vi.fn();
    render(
      <Tabs
        activeTab="debugger"
        setActiveTab={setActiveTab}
        opcodeStepCount={0}
        hasCallTrace={false}
        hasGasProfile={false}
      />,
    );
    fireEvent.click(screen.getByText("Gas Profile"));
    expect(setActiveTab).toHaveBeenCalledWith("gas");
  });

  it("omits the count badge when step count is zero", () => {
    render(
      <Tabs
        activeTab="opcodes"
        setActiveTab={() => {}}
        opcodeStepCount={0}
        hasCallTrace
        hasGasProfile
      />,
    );
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });
});

describe("DebuggerView/ErrorPanel", () => {
  it("shows the generic trace error heading when debug IS available", () => {
    render(<ErrorPanel error="boom" debugAvailable />);
    expect(screen.getByText("Trace Error")).toBeInTheDocument();
    expect(screen.getByText("boom")).toBeInTheDocument();
    expect(
      screen.queryByText("How to enable debug tracing:"),
    ).not.toBeInTheDocument();
  });

  it("embeds setup instructions when the debug API is unavailable", () => {
    render(<ErrorPanel error="no debug node" debugAvailable={false} />);
    expect(screen.getByText("Debug API Not Available")).toBeInTheDocument();
    expect(
      screen.getByText("How to enable debug tracing:"),
    ).toBeInTheDocument();
    expect(screen.getByText(/DEBUG_RPC_URL/)).toBeInTheDocument();
  });
});

describe("DebuggerView/LoadingPanel + NoDataPanel", () => {
  it("renders the loading copy", () => {
    render(<LoadingPanel />);
    expect(
      screen.getByText("Tracing transaction execution..."),
    ).toBeInTheDocument();
  });

  it("renders a custom no-data message", () => {
    render(<NoDataPanel message="nothing here" />);
    expect(screen.getByText("nothing here")).toBeInTheDocument();
  });
});

describe("DebuggerView/EmptyState", () => {
  beforeEach(() => {
    recentTxs.value = [];
    removeDebuggerTx.mockClear();
    clearDebuggerTxs.mockClear();
  });

  it("shows the placeholder and no recents list when history is empty", () => {
    withRouter(<EmptyState />);
    expect(
      screen.getByText("Enter a transaction hash to debug"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Recently debugged")).not.toBeInTheDocument();
  });

  it("lists recently-debugged txs and supports remove + clear", () => {
    const hash = "0x" + "a".repeat(64);
    recentTxs.value = [{ hash, lastSeen: Date.now() }];
    withRouter(<EmptyState />);

    expect(screen.getByText("Recently debugged")).toBeInTheDocument();
    // Short form: first 10 + … + last 8.
    expect(screen.getByText(/0xaaaaaaaa…aaaaaaaa/)).toBeInTheDocument();
    expect(screen.getByText("just now")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(removeDebuggerTx).toHaveBeenCalledWith(hash);

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(clearDebuggerTxs).toHaveBeenCalledOnce();
  });

  it("formats older timestamps in minutes/hours/days", () => {
    const now = Date.now();
    recentTxs.value = [
      { hash: "0x" + "b".repeat(64), lastSeen: now - 5 * 60_000 },
      { hash: "0x" + "c".repeat(64), lastSeen: now - 3 * 3_600_000 },
      { hash: "0x" + "d".repeat(64), lastSeen: now - 2 * 86_400_000 },
    ];
    withRouter(<EmptyState />);
    expect(screen.getByText("5m ago")).toBeInTheDocument();
    expect(screen.getByText("3h ago")).toBeInTheDocument();
    expect(screen.getByText("2d ago")).toBeInTheDocument();
  });
});
