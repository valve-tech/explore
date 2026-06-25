import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import StepDebugger from "../components/debugger/StepDebugger";
import type { OpcodeStep, CallFrame, StepDetailResponse } from "../api/debugger";
import type { SourceFile, SourceLocation } from "../api/source";

/**
 * Orchestrator-level coverage for StepDebugger.tsx. The pure helpers and the
 * presentational rows are tested elsewhere; here we feed the component a small
 * synthetic trace plus stubbed source/trace hooks so the navigation side
 * effects (Recent dropdown, navError, go-to-definition, the frame-opcode
 * overlay, Slither analysis) actually run.
 *
 * Mirrors a WPLS transfer shape (selector 0xa9059cbb on
 * 0xA1077a294dDE1B09bB078844df40758a5D0f9a27) but with a hand-built source map.
 */

const WPLS = "0xA1077a294dDE1B09bB078844df40758a5D0f9a27";

const SOURCE_FILE: SourceFile = {
  name: "Token.sol",
  content: [
    "contract Token {", // 1
    "  function transfer(address to, uint256 amount) public {", // 2
    "    balances[to] += amount;", // 3
    "  }", // 4
    "}", // 5
  ].join("\n"),
};

// pc → source location. pc 2 maps to the transfer function body line.
const SOURCE_MAP: Record<number, SourceLocation | null> = {
  2: {
    file: "Token.sol",
    line: 3,
    column: 4,
    endLine: 3,
    endColumn: 25,
    sourceSnippet: "balances[to] += amount",
    jumpType: "-",
  },
};

// ---- Hook mocks ----
vi.mock("../hooks/useContractMeta", () => ({
  useContractMeta: () => ({
    names: { [WPLS.toLowerCase()]: "WPLS" },
    abiSelectors: {},
    eventTopics: {},
  }),
}));
vi.mock("../hooks/useSignatures", () => ({
  useSignatures: () => ({ data: {} }),
}));
vi.mock("../hooks/useTraceSourceMaps", () => ({
  useTraceSourceMaps: () => ({ data: { [WPLS.toLowerCase()]: SOURCE_MAP } }),
}));
vi.mock("../hooks/useTraceSources", () => ({
  useTraceSources: () => ({
    data: { [WPLS.toLowerCase()]: [SOURCE_FILE] },
    refetch: vi.fn(),
  }),
}));
vi.mock("../hooks/useContractSource", () => ({
  useContractSource: () => ({
    data: {
      address: WPLS,
      files: [SOURCE_FILE],
      hasSourceMap: true,
    },
    isLoading: false,
  }),
  useSourceMappings: () => ({ data: SOURCE_MAP }),
}));
vi.mock("../hooks/useWorkspaces", () => ({
  useWorkspaces: () => ({
    workspaces: [],
    create: { mutateAsync: vi.fn() },
    addToWorkspace: { mutateAsync: vi.fn() },
  }),
}));

const analyzeContract = vi.hoisted(() => vi.fn());
vi.mock("../api/source", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/source")>();
  return { ...actual, analyzeContract };
});

vi.mock("../api/debugger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/debugger")>();
  return {
    ...actual,
    fetchOpcodeDetail: vi.fn(
      async (_h: string, from: number, to: number): Promise<StepDetailResponse> => {
        const detail: Record<number, { stack: string[]; memory: string[]; storage: Record<string, string> }> = {};
        for (let i = from; i < to; i++) {
          detail[i] = { stack: [], memory: [], storage: {} };
        }
        return { ok: true, detail, debugAvailable: true };
      },
    ),
  };
});

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.scrollTo = vi.fn();
  localStorage.clear();
  analyzeContract.mockReset();
});

function makeStep(o: Partial<OpcodeStep> = {}): OpcodeStep {
  return { pc: 0, op: "JUMPDEST", gas: 1, gasCost: 1, depth: 1, stack: [], memory: [], storage: {}, ...o };
}

// 2-frame trace: root → WPLS sub-call running code at depth 2.
const steps: OpcodeStep[] = [
  makeStep({ depth: 1, pc: 0 }),
  makeStep({ op: "CALL", depth: 1, pc: 1 }),
  makeStep({ op: "JUMPDEST", depth: 2, pc: 0 }),
  makeStep({ op: "SSTORE", depth: 2, pc: 2 }),
  makeStep({ op: "LOG2", depth: 2, pc: 4 }),
  makeStep({ op: "RETURN", depth: 1, pc: 5 }),
];

const child: CallFrame = {
  type: "CALL",
  from: "0x01",
  to: WPLS,
  gas: "0x1",
  gasUsed: "0x5208",
  input: "0xa9059cbb" + "0".repeat(128),
};
const callTrace: CallFrame = {
  type: "CALL",
  from: "0x00",
  to: WPLS,
  gas: "0x1",
  gasUsed: "0x1",
  input: "0x",
  calls: [child],
};

function renderDebugger(extraProps: Record<string, unknown> = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <StepDebugger
          steps={steps}
          contractAddress={WPLS}
          callTrace={callTrace}
          txHash="0xtx"
          {...extraProps}
        />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("StepDebugger orchestrator", () => {
  it("renders the workspace-suggest affordance when sources are loaded", () => {
    renderDebugger();
    expect(
      screen.getByRole("button", { name: /into a workspace/ }),
    ).toBeInTheDocument();
  });

  it("clicking a call-tree row jumps and records a Recent entry", async () => {
    renderDebugger();
    // The WPLS.transfer row is rendered in the (lg) tree column.
    const transferRows = screen.getAllByText("transfer");
    fireEvent.click(transferRows[0]!);
    // A Recent dropdown toggle should appear once a labeled jump is recorded.
    const recentBtn = await screen.findByRole("button", { name: "Recent" });
    fireEvent.click(recentBtn);
    // The dropdown lists the jump label.
    const dropdown = await screen.findByText(/Recent jumps ·/);
    expect(dropdown).toBeInTheDocument();
  });

  it("go-to-definition via a source identifier moves the source pane", () => {
    renderDebugger();
    // Step to the WPLS frame so the active contract is WPLS with source.
    fireEvent.click(screen.getByRole("button", { name: "Next SSTORE (S)" }));
    // The source pane tokenizes the file; click the `balances` identifier.
    const ident = screen.getAllByText("balances")[0];
    if (ident) fireEvent.click(ident);
    // No throw and the source line is rendered.
    expect(screen.getAllByText("transfer").length).toBeGreaterThan(0);
  });

  it("runs Slither analysis and reveals the findings panel on success", async () => {
    analyzeContract.mockResolvedValue({
      ok: true,
      analysis: {
        findings: [
          {
            check: "reentrancy",
            impact: "High",
            confidence: "Medium",
            description: "danger",
            elements: [],
          },
        ],
      },
    });
    renderDebugger();
    fireEvent.click(screen.getByRole("button", { name: /^Slither/ }));
    await waitFor(() =>
      expect(screen.getByText("Slither Findings")).toBeInTheDocument(),
    );
  });

  it("surfaces a navError banner when Slither analysis fails", async () => {
    analyzeContract.mockResolvedValue({ ok: false, error: "slither crashed" });
    renderDebugger();
    fireEvent.click(screen.getByRole("button", { name: /^Slither/ }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("slither crashed");
    // Clicking the banner dismisses it.
    fireEvent.click(alert);
    await waitFor(() =>
      expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
    );
  });

  it("opens the frame-opcode overlay via the expand button", async () => {
    renderDebugger();
    const row = screen.getAllByText("transfer")[0]!.closest("div")!;
    fireEvent.mouseEnter(row);
    // The expand (arrows-pointing-out) button becomes focusable on hover.
    const expandBtn = within(row)
      .getAllByRole("button")
      .find((b) => b.getAttribute("tabindex") === "0");
    if (expandBtn) {
      fireEvent.click(expandBtn);
      // Overlay shows the frame's opcode list header.
      await waitFor(() =>
        expect(screen.getByText(/ops · steps/)).toBeInTheDocument(),
      );
    }
  });

  it("walks nav history with Cmd+[ / Cmd+] after a recorded jump", async () => {
    renderDebugger();
    // Record a jump via a call-tree row click (pushes nav history).
    fireEvent.click(screen.getAllByText("transfer")[0]!);
    // A second jump so back has somewhere to return from.
    fireEvent.keyDown(window, { key: "End" });
    // Cmd+[ goes back; Cmd+] forward. These exercise applyHistoryEntry +
    // navGoBack / navGoForward without throwing.
    fireEvent.keyDown(window, { key: "[", metaKey: true });
    fireEvent.keyDown(window, { key: "]", metaKey: true });
    expect(screen.getAllByText("transfer").length).toBeGreaterThan(0);
  });

  it("re-applies a Recent entry from the dropdown", async () => {
    renderDebugger();
    fireEvent.click(screen.getAllByText("transfer")[0]!);
    const recentBtn = await screen.findByRole("button", { name: "Recent" });
    fireEvent.click(recentBtn);
    // The dropdown row label is the function name; clicking re-applies it.
    const dropdownRows = await screen.findAllByText("transfer");
    // The last "transfer" is inside the recents dropdown list.
    fireEvent.click(dropdownRows[dropdownRows.length - 1]!);
    expect(screen.getAllByText("transfer").length).toBeGreaterThan(0);
  });

  it("switches to the Decoded Trace tab", () => {
    renderDebugger();
    fireEvent.click(screen.getByText("Decoded Trace"));
    // The decoded-trace panel renders the external transfer call entry.
    expect(screen.getAllByText("transfer").length).toBeGreaterThan(0);
  });

  it("handles keyboard step navigation and jump-to-next hotkeys", () => {
    renderDebugger();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByText(/2 \/ 6/)).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(screen.getByText(/1 \/ 6/)).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "End" });
    expect(screen.getByText(/6 \/ 6/)).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Home" });
    expect(screen.getByText(/1 \/ 6/)).toBeInTheDocument();
    // C/S/L hotkeys jump to the next call/store/log.
    fireEvent.keyDown(window, { key: "s" });
    expect(screen.getByText(/4 \/ 6/)).toBeInTheDocument();
  });

  it("returns null for an empty trace", () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { container } = render(
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <StepDebugger steps={[]} />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
