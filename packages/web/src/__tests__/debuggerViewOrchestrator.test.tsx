import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import DebuggerView from "../components/debugger/DebuggerView";

/**
 * DebuggerView orchestrator coverage. The heavy StepDebugger subtree and the
 * SDK trace components are stubbed; we drive the fetch layer to exercise the
 * empty / loading / error / result branches and the tab routing.
 */

// Stub the StepDebugger so we don't re-render the whole debugger machinery —
// this test is about DebuggerView's data plumbing + branch selection.
vi.mock("../components/debugger/StepDebugger", () => ({
  default: ({ txHash }: { txHash: string | null }) => (
    <div data-testid="step-debugger">step-debugger:{txHash}</div>
  ),
}));
vi.mock("../components/debugger/GasProfiler", () => ({
  default: () => <div data-testid="gas-profiler" />,
}));
vi.mock("@valve-tech/trace-sdk", () => ({
  CallTree: () => <div data-testid="call-tree" />,
  GasFlamegraph: () => <div data-testid="gas-flamegraph" />,
  OpcodeViewer: () => <div data-testid="opcode-viewer" />,
  normalizeCallFrame: (f: unknown) => f,
  normalizeStructLogs: (s: unknown) => s,
}));

const fetchTrace = vi.hoisted(() => vi.fn());
const fetchGasProfile = vi.hoisted(() => vi.fn());
const fetchOpcodes = vi.hoisted(() => vi.fn());
vi.mock("../api/debugger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/debugger")>();
  return { ...actual, fetchTrace, fetchGasProfile, fetchOpcodes };
});

const fetchTransaction = vi.hoisted(() => vi.fn());
vi.mock("../api/explorer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/explorer")>();
  return { ...actual, fetchTransaction };
});

vi.mock("../lib/recentDebuggerTxs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/recentDebuggerTxs")>();
  return { ...actual, recordDebuggerTx: vi.fn() };
});
vi.mock("../lib/recentEntities", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/recentEntities")>();
  return { ...actual, recordVisit: vi.fn() };
});

const VALID_HASH = "0x" + "a".repeat(64);

beforeEach(() => {
  fetchTrace.mockReset();
  fetchGasProfile.mockReset();
  fetchOpcodes.mockReset();
  fetchTransaction.mockReset();
  fetchTransaction.mockResolvedValue({ blockHash: "0x" + "b".repeat(64) });
  fetchGasProfile.mockResolvedValue({ ok: false });
});

function renderAt(path: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={client}>
        <Routes>
          <Route path="/debugger" element={<DebuggerView />} />
          <Route path="/debugger/:txHash" element={<DebuggerView />} />
          <Route path="/debugger/:txHash/:tab" element={<DebuggerView />} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("DebuggerView", () => {
  it("shows the empty state with no tx hash in the URL", () => {
    renderAt("/debugger");
    expect(
      screen.getByText("Enter a transaction hash to debug"),
    ).toBeInTheDocument();
  });

  it("validates the search input and disables Debug for a bad hash", () => {
    renderAt("/debugger");
    const input = screen.getByPlaceholderText("0x... transaction hash");
    fireEvent.change(input, { target: { value: "0xnotvalid" } });
    expect(screen.getByText(/Invalid transaction hash/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Debug" })).toBeDisabled();
  });

  it("renders the step debugger when opcode steps are returned", async () => {
    fetchTrace.mockResolvedValue({
      ok: true,
      trace: { type: "CALL", from: "0x0", to: "0xtarget", gas: "0x1", gasUsed: "0x1", input: "0x" },
    });
    fetchOpcodes.mockResolvedValue({
      ok: true,
      steps: [{ pc: 0, op: "PUSH1", gas: 1, gasCost: 3, depth: 1, stack: [], memory: [], storage: {} }],
    });
    renderAt(`/debugger/${VALID_HASH}`);
    await waitFor(() =>
      expect(screen.getByTestId("step-debugger")).toBeInTheDocument(),
    );
    // Tabs render with the step debugger active by default.
    expect(screen.getByText("Step Debugger")).toBeInTheDocument();
  });

  it("shows an error panel when the trace fails and there's no result", async () => {
    fetchTrace.mockResolvedValue({
      ok: false,
      error: "no debug node",
      debugAvailable: false,
    });
    fetchOpcodes.mockResolvedValue({ ok: false });
    renderAt(`/debugger/${VALID_HASH}`);
    await waitFor(() =>
      expect(screen.getByText("Debug API Not Available")).toBeInTheDocument(),
    );
    expect(screen.getByText("no debug node")).toBeInTheDocument();
  });

  it("renders the call tree tab from the URL", async () => {
    fetchTrace.mockResolvedValue({
      ok: true,
      trace: { type: "CALL", from: "0x0", to: "0xtarget", gas: "0x1", gasUsed: "0x1", input: "0x" },
    });
    fetchOpcodes.mockResolvedValue({ ok: true, steps: [] });
    renderAt(`/debugger/${VALID_HASH}/calltree`);
    await waitFor(() =>
      expect(screen.getByTestId("call-tree")).toBeInTheDocument(),
    );
  });

  it("renders the opcodes tab no-data panel when steps are empty", async () => {
    fetchTrace.mockResolvedValue({
      ok: true,
      trace: { type: "CALL", from: "0x0", to: "0xtarget", gas: "0x1", gasUsed: "0x1", input: "0x" },
    });
    fetchOpcodes.mockResolvedValue({ ok: true, steps: [] });
    renderAt(`/debugger/${VALID_HASH}/opcodes`);
    await waitFor(() =>
      expect(
        screen.getByText(/Opcode trace data is not available/),
      ).toBeInTheDocument(),
    );
  });
});
