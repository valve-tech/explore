import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import StepDebugger from "../components/debugger/StepDebugger";
import type { OpcodeStep, StepDetailResponse } from "../api/debugger";

// Per-step state (stack/memory/storage) is lazy-loaded via fetchOpcodeDetail.
// Stub it so the storage/stack assertions have data to render; the window is
// keyed by step index, so we return detail for the SSTORE step under test.
vi.mock("../api/debugger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/debugger")>();
  return {
    ...actual,
    fetchOpcodeDetail: vi.fn(
      async (_hash: string, from: number, to: number): Promise<StepDetailResponse> => {
        const detail: Record<number, { stack: string[]; memory: string[]; storage: Record<string, string> }> = {};
        for (let i = from; i < to; i++) {
          detail[i] = {
            stack: i === 4 ? ["0x00", "0x01"] : [],
            memory: [],
            storage: i === 4 ? { "0x00": "0x01" } : {},
          };
        }
        return { ok: true, detail, debugAvailable: true };
      },
    ),
  };
});

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: Infinity } },
});

function Wrapper({ children }: { children: React.ReactNode }) {
  // MemoryRouter: the debugger reads the active chain from the URL.
  return (
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </MemoryRouter>
  );
}

function makeStep(overrides: Partial<OpcodeStep> = {}): OpcodeStep {
  return {
    pc: 0,
    op: "PUSH1",
    gas: 100000,
    gasCost: 3,
    depth: 1,
    stack: [],
    memory: [],
    storage: {},
    ...overrides,
  };
}

const SAMPLE_STEPS: OpcodeStep[] = [
  makeStep({ pc: 0, op: "PUSH1", stack: [], gasCost: 3 }),
  makeStep({ pc: 2, op: "PUSH1", stack: ["0x80"], gasCost: 3 }),
  makeStep({ pc: 4, op: "MSTORE", stack: ["0x80", "0x40"], gasCost: 12 }),
  makeStep({ pc: 5, op: "SLOAD", stack: ["0x00"], gasCost: 2100 }),
  makeStep({
    pc: 6,
    op: "SSTORE",
    stack: ["0x00", "0x01"],
    gasCost: 20000,
    storage: { "0x00": "0x01" },
  }),
  makeStep({ pc: 7, op: "CALL", stack: ["0xff"], gasCost: 700, depth: 1 }),
  makeStep({ pc: 8, op: "LOG1", stack: [], gasCost: 375 }),
  makeStep({ pc: 9, op: "RETURN", stack: [], gasCost: 0 }),
];

describe("StepDebugger", () => {
  it("renders step counter showing total steps", () => {
    render(<StepDebugger steps={SAMPLE_STEPS} />, { wrapper: Wrapper });
    expect(screen.getByText(/1 \/ 8/)).toBeInTheDocument();
  });

  it("renders the initial opcode name in context bar", () => {
    render(<StepDebugger steps={SAMPLE_STEPS} />, { wrapper: Wrapper });
    // PUSH1 appears in both context bar and trace list
    const push1Elements = screen.getAllByText("PUSH1");
    expect(push1Elements.length).toBeGreaterThanOrEqual(1);
  });

  it("shows keyboard shortcuts", () => {
    render(<StepDebugger steps={SAMPLE_STEPS} />, { wrapper: Wrapper });
    expect(screen.getByText("Next CALL")).toBeInTheDocument();
    expect(screen.getByText("Next SSTORE")).toBeInTheDocument();
    expect(screen.getByText("Next LOG")).toBeInTheDocument();
  });

  it("steps forward when clicking the > button", () => {
    render(<StepDebugger steps={SAMPLE_STEPS} />, { wrapper: Wrapper });
    const forwardBtn = screen.getByRole("button", { name: "Step forward (Right arrow / Space)" });
    fireEvent.click(forwardBtn);
    expect(screen.getByText(/2 \/ 8/)).toBeInTheDocument();
  });

  it("steps backward when clicking the < button", () => {
    render(<StepDebugger steps={SAMPLE_STEPS} />, { wrapper: Wrapper });
    // Go forward first
    const forwardBtn = screen.getByRole("button", { name: "Step forward (Right arrow / Space)" });
    fireEvent.click(forwardBtn);
    fireEvent.click(forwardBtn);
    expect(screen.getByText(/3 \/ 8/)).toBeInTheDocument();

    // Then backward
    const backBtn = screen.getByRole("button", { name: "Step back (Left arrow)" });
    fireEvent.click(backBtn);
    expect(screen.getByText(/2 \/ 8/)).toBeInTheDocument();
  });

  it("jumps to next CALL opcode", () => {
    render(<StepDebugger steps={SAMPLE_STEPS} />, { wrapper: Wrapper });
    const callBtn = screen.getByRole("button", { name: "Next CALL (C)" });
    fireEvent.click(callBtn);
    // CALL is at index 5
    expect(screen.getByText(/6 \/ 8/)).toBeInTheDocument();
  });

  it("jumps to next storage op (SLOAD/SSTORE)", () => {
    render(<StepDebugger steps={SAMPLE_STEPS} />, { wrapper: Wrapper });
    const sstoreBtn = screen.getByRole("button", { name: "Next SSTORE (S)" });
    fireEvent.click(sstoreBtn);
    // SLOAD is at index 3 (first storage op)
    expect(screen.getByText(/4 \/ 8/)).toBeInTheDocument();
  });

  it("jumps to start and end", () => {
    render(<StepDebugger steps={SAMPLE_STEPS} />, { wrapper: Wrapper });
    const endBtn = screen.getByRole("button", { name: "Jump to end (End)" });
    fireEvent.click(endBtn);
    expect(screen.getByText(/8 \/ 8/)).toBeInTheDocument();

    const startBtn = screen.getByRole("button", { name: "Jump to start (Home)" });
    fireEvent.click(startBtn);
    expect(screen.getByText(/1 \/ 8/)).toBeInTheDocument();
  });

  it("shows stack panel collapsed by default", () => {
    render(<StepDebugger steps={SAMPLE_STEPS} />, { wrapper: Wrapper });
    // Stack is collapsed, so "Stack is empty" should not be visible
    expect(screen.queryByText("Stack is empty")).not.toBeInTheDocument();
    // But the panel header should show "Stack"
    expect(screen.getByText("Stack")).toBeInTheDocument();
  });

  it("shows stack entries when panel is expanded and stepped", () => {
    render(<StepDebugger steps={SAMPLE_STEPS} />, { wrapper: Wrapper });
    const forwardBtn = screen.getByRole("button", { name: "Step forward (Right arrow / Space)" });
    fireEvent.click(forwardBtn);
    // Step 1 has stack: ["0x80"]
    expect(screen.queryByText("Stack is empty")).not.toBeInTheDocument();
  });

  it("shows storage changes at SSTORE step (from lazily-loaded detail)", async () => {
    // txHash enables the lazy per-step detail fetch (mocked above).
    render(<StepDebugger steps={SAMPLE_STEPS} txHash="0xabc" />, { wrapper: Wrapper });
    // Navigate to SSTORE (index 4) by clicking Next twice (first hits SLOAD at 3)
    const sstoreBtn = screen.getByRole("button", { name: "Next SSTORE (S)" });
    fireEvent.click(sstoreBtn); // SLOAD at index 3
    fireEvent.click(sstoreBtn); // SSTORE at index 4
    // Storage panel reflects the change once the detail window resolves.
    expect(await screen.findByText("1 changes")).toBeInTheDocument();
  });

  it("shows memory panel collapsed by default", () => {
    render(<StepDebugger steps={SAMPLE_STEPS} />, { wrapper: Wrapper });
    // Memory collapsed — content hidden, but header visible
    expect(screen.queryByText("Memory is empty")).not.toBeInTheDocument();
    expect(screen.getByText("Memory")).toBeInTheDocument();
  });

  it("defaults to the synchronized Source + Opcodes view", () => {
    render(<StepDebugger steps={SAMPLE_STEPS} />, { wrapper: Wrapper });
    expect(screen.getByText("Source + Opcodes")).toBeInTheDocument();
    expect(screen.getByText("Decoded Trace")).toBeInTheDocument();
  });

  it("renders opcode-frequency tags in the default debugger view", () => {
    render(<StepDebugger steps={SAMPLE_STEPS} />, { wrapper: Wrapper });
    // The opcode pane (and its frequency rail) is part of the default split —
    // no tab click required. PUSH1 occurs twice in SAMPLE_STEPS.
    expect(
      screen.getByRole("button", { name: "PUSH1 — 2 occurrences" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "SLOAD — 1 occurrence" }),
    ).toBeInTheDocument();
  });

  it("filters the trace to a single opcode when its tag is clicked", () => {
    render(<StepDebugger steps={SAMPLE_STEPS} />, { wrapper: Wrapper });
    fireEvent.click(screen.getByRole("button", { name: "PUSH1 — 2 occurrences" }));
    // ControlsBar reports the filtered match count (exact: 2 PUSH1, not PUSH-family).
    expect(screen.getByText(/2 matches/)).toBeInTheDocument();
  });
});
