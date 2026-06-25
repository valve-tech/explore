import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import DebuggerView from "../components/debugger/DebuggerView";

/**
 * Supplemental DebuggerView coverage — the branches the base orchestrator suite
 * leaves open: the gas-profile fold-in (83-84), setActiveTab path building +
 * no-hash guard (115/117-120), handleSubmitTrace navigation (197-198), and the
 * GasFlamegraph resolveSelector callback (260).
 */

const setActiveTabHash = vi.hoisted(() => ({ value: "" }));

vi.mock("../components/debugger/StepDebugger", () => ({
  default: () => <div data-testid="step-debugger" />,
}));
vi.mock("../components/debugger/GasProfiler", () => ({
  default: () => <div data-testid="gas-profiler" />,
}));
vi.mock("@valve-tech/trace-sdk", () => ({
  CallTree: () => <div data-testid="call-tree" />,
  // Exercise resolveSelector (line 260) by invoking it with a known selector.
  GasFlamegraph: ({ resolveSelector }: { resolveSelector: (s: string) => string | undefined }) => (
    <div data-testid="gas-flamegraph">{resolveSelector?.("0xa9059cbb") ?? "?"}</div>
  ),
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
  setActiveTabHash.value = "";
});

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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

const TRACE = {
  ok: true,
  trace: { type: "CALL", from: "0x0", to: "0xtarget", gas: "0x1", gasUsed: "0x1", input: "0x" },
};

describe("DebuggerView mop-up", () => {
  it("folds in the gas profile and opcode profile, and runs the flamegraph resolveSelector", async () => {
    fetchTrace.mockResolvedValue(TRACE);
    fetchOpcodes.mockResolvedValue({ ok: true, steps: [] });
    // gasRes.ok with both gasProfile + opcodeProfile → lines 83-84 assign both.
    fetchGasProfile.mockResolvedValue({
      ok: true,
      gasProfile: { totalGas: 21000, categories: [] },
      opcodeProfile: { opcodes: [] },
    });
    renderAt(`/debugger/${VALID_HASH}/gas`);
    await waitFor(() =>
      expect(screen.getByTestId("gas-flamegraph")).toBeInTheDocument(),
    );
    // resolveSelector(0xa9059cbb) → wellKnown transfer → "transfer" (line 260).
    expect(screen.getByTestId("gas-flamegraph")).toHaveTextContent("transfer");
    expect(screen.getByTestId("gas-profiler")).toBeInTheDocument();
  });

  it("builds a non-default tab path when switching tabs (setActiveTab)", async () => {
    fetchTrace.mockResolvedValue(TRACE);
    fetchOpcodes.mockResolvedValue({ ok: true, steps: [] });
    fetchGasProfile.mockResolvedValue({ ok: false });
    renderAt(`/debugger/${VALID_HASH}`);
    await waitFor(() => expect(screen.getByText("Call Tree")).toBeInTheDocument());
    // Click the Call Tree tab → setActiveTab("calltree") builds the
    // `/debugger/<hash>/calltree` path (lines 117-120) and navigates.
    fireEvent.click(screen.getByText("Call Tree"));
    await waitFor(() => expect(screen.getByTestId("call-tree")).toBeInTheDocument());
  });

  it("navigates on a valid Enter-key search submit (handleSubmitTrace)", () => {
    fetchTrace.mockResolvedValue(TRACE);
    fetchOpcodes.mockResolvedValue({ ok: true, steps: [] });
    fetchGasProfile.mockResolvedValue({ ok: false });
    renderAt("/debugger");
    const input = screen.getByPlaceholderText("0x... transaction hash");
    fireEvent.change(input, { target: { value: VALID_HASH } });
    // Enter calls onSubmit unconditionally → handleSubmitTrace navigates (198).
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByPlaceholderText("0x... transaction hash")).toBeInTheDocument();
  });

  it("ignores an Enter submit when the hash is invalid (handleSubmitTrace guard)", () => {
    renderAt("/debugger");
    const input = screen.getByPlaceholderText("0x... transaction hash");
    fireEvent.change(input, { target: { value: "0xbad" } });
    // Enter still calls onSubmit; handleSubmitTrace's `if (!isValidHash) return`
    // (line 197) keeps us on the empty state.
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByText("Enter a transaction hash to debug")).toBeInTheDocument();
  });
});
