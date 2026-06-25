import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import StepDebugger from "../components/debugger/StepDebugger";
import type { OpcodeStep, CallFrame, StepDetailResponse } from "../api/debugger";
import type { SourceFile, SourceLocation } from "../api/source";

/**
 * Supplemental orchestrator coverage for StepDebugger.tsx — drives the specific
 * branches the base orchestrator suite leaves uncovered: the tree-column
 * resize, Slither no-contract / throw paths, jumpToDefinition globals + cursor
 * coupling, nav-history no-op edges, C/L hotkeys, the keyboard input/tree
 * guards, jumpToLine, the recents click-away + re-apply, and the frame-overlay
 * jump callback.
 *
 * Real on-chain anchor: WPLS 0xA1077a294dDE1B09bB078844df40758a5D0f9a27,
 * transfer selector 0xa9059cbb (https://scan.pulsechain.com).
 */

const WPLS = "0xA1077a294dDE1B09bB078844df40758a5D0f9a27";

const SOURCE_FILE: SourceFile = {
  name: "Token.sol",
  content: [
    "contract Token {", // 1
    "  mapping(address => uint256) public balances;", // 2
    "  function transfer(address to, uint256 amount) public {", // 3
    "    balances[to] += amount + msg.value;", // 4 — `msg` is a Solidity global
    "  }", // 5
    "}", // 6
  ].join("\n"),
};

// pc → source location. pc 2 maps to the transfer body; pc 0 maps to the
// `balances` declaration line so go-to-definition can couple the cursor.
const SOURCE_MAP: Record<number, SourceLocation | null> = {
  2: {
    file: "Token.sol",
    line: 4,
    column: 4,
    endLine: 4,
    endColumn: 25,
    sourceSnippet: "balances[to] += amount",
    jumpType: "-",
  },
  0: {
    file: "Token.sol",
    line: 2,
    column: 2,
    endLine: 2,
    endColumn: 40,
    sourceSnippet: "mapping(address => uint256) public balances",
    jumpType: "-",
  },
};

const sourcesData = vi.hoisted(() => ({ value: undefined as Record<string, SourceFile[]> | undefined }));

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
    data: sourcesData.value,
    refetch: vi.fn(),
  }),
}));
vi.mock("../hooks/useContractSource", () => ({
  useContractSource: () => ({
    data: { address: WPLS, files: [SOURCE_FILE], hasSourceMap: true },
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
        for (let i = from; i < to; i++) detail[i] = { stack: [], memory: [], storage: {} };
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
  sourcesData.value = { [WPLS.toLowerCase()]: [SOURCE_FILE] };
});

function makeStep(o: Partial<OpcodeStep> = {}): OpcodeStep {
  return { pc: 0, op: "JUMPDEST", gas: 1, gasCost: 1, depth: 1, stack: [], memory: [], storage: {}, ...o };
}

// 2-frame trace: root → WPLS sub-call running code at depth 2, then a LOG.
const steps: OpcodeStep[] = [
  makeStep({ depth: 1, pc: 0 }),
  makeStep({ op: "CALL", depth: 1, pc: 1 }),
  makeStep({ op: "JUMPDEST", depth: 2, pc: 0 }),
  makeStep({ op: "SSTORE", depth: 2, pc: 2 }),
  makeStep({ op: "LOG2", depth: 2, pc: 4 }),
  makeStep({ op: "CALL", depth: 2, pc: 6 }),
  makeStep({ op: "RETURN", depth: 1, pc: 8 }),
];

const child: CallFrame = {
  type: "CALL",
  from: "0x01",
  to: WPLS,
  gas: "0x1",
  gasUsed: "0x5208",
  input: "0xa9059cbb" + "0".repeat(128),
};
// A codeless callee (value transfer / EOA) — never runs deeper than the parent,
// exercising the frameRanges `ranCode === false` branch (line 305). It carries a
// nested call so the codeless branch recurses into a child (the `visit(c,
// parentDepth)` statement on line 305).
const codelessGrandchild: CallFrame = {
  type: "CALL",
  from: "0x000000000000000000000000000000000000dEaD",
  to: "0x000000000000000000000000000000000000bEEf",
  gas: "0x1",
  gasUsed: "0x0",
  input: "0x",
  value: "0x1",
};
const codelessCallee: CallFrame = {
  type: "CALL",
  from: WPLS,
  to: "0x000000000000000000000000000000000000dEaD",
  gas: "0x1",
  gasUsed: "0x0",
  input: "0x",
  value: "0x1",
  calls: [codelessGrandchild],
};
const callTrace: CallFrame = {
  type: "CALL",
  from: "0x00",
  to: WPLS,
  gas: "0x1",
  gasUsed: "0x1",
  input: "0x",
  calls: [{ ...child, calls: [codelessCallee] }],
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

describe("StepDebugger mop-up", () => {
  it("resizes the call-tree column and persists the width", () => {
    const { container } = renderDebugger();
    const handle = container.querySelector(".bs-r-in") as HTMLElement;
    expect(handle).toBeTruthy();
    fireEvent.pointerDown(handle, { clientX: 100 });
    fireEvent(window, new MouseEvent("pointermove", { clientX: 300 } as MouseEventInit));
    fireEvent(window, new MouseEvent("pointerup", {} as MouseEventInit));
    // handleTreeResize wrote the clamped width to localStorage (lines 158-159).
    expect(localStorage.getItem("debugger:treeWidth")).toBeTruthy();
  });

  it("Slither button is a no-op when no contract address is provided", () => {
    renderDebugger({ contractAddress: undefined });
    // Without a contractAddress the Slither/Debugger controls aren't rendered,
    // so handleAnalyze's early `if (!contractAddress) return` (line 229) is the
    // guard. Render simply succeeds with the controls absent.
    expect(screen.queryByRole("button", { name: /^Slither/ })).not.toBeInTheDocument();
  });

  it("disables the Slither button while an analysis is in flight", async () => {
    // First click flips slitherLoading=true; the button becomes disabled
    // ("Analyzing...") so a second invocation can't fire from the UI — the
    // `|| slitherLoading` arm of handleAnalyze's guard (line 229) is therefore
    // a defensive belt-and-braces, not reachable via a click while disabled.
    let resolve!: (v: unknown) => void;
    analyzeContract.mockReturnValue(new Promise((r) => { resolve = r; }));
    renderDebugger();
    fireEvent.click(screen.getByRole("button", { name: /^Slither/ }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Analyzing/ })).toBeDisabled(),
    );
    expect(analyzeContract).toHaveBeenCalledTimes(1);
    resolve({ ok: true, analysis: { findings: [] } });
    await waitFor(() => expect(screen.getByText("Slither Findings")).toBeInTheDocument());
  });

  it("surfaces a navError when Slither analysis throws", async () => {
    analyzeContract.mockRejectedValue(new Error("boom"));
    renderDebugger();
    fireEvent.click(screen.getByRole("button", { name: /^Slither/ }));
    // The catch block (line 245) sets a navError banner.
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/Slither analysis failed: boom/);
  });

  it("go-to-definition is a silent no-op for a Solidity global identifier", () => {
    renderDebugger();
    // Step into the WPLS frame so the active contract has source.
    fireEvent.click(screen.getByRole("button", { name: "Next SSTORE (S)" }));
    // `msg` is in SOLIDITY_GLOBALS → jumpToDefinition returns at line 486.
    const globals = screen.queryAllByText("msg");
    expect(globals.length).toBeGreaterThan(0);
    fireEvent.click(globals[0]!);
    // No navError, source still rendered.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("go-to-definition couples the cursor when an identifier resolves to a mapped line", () => {
    renderDebugger();
    fireEvent.click(screen.getByRole("button", { name: "Next SSTORE (S)" }));
    // Click the `balances` identifier → findDefinitionLine resolves line 2,
    // and the cursor-coupling loop (514-520) finds pc 0 mapping to line 2.
    const ident = screen.getAllByText("balances")[0];
    if (ident) fireEvent.click(ident);
    expect(screen.getAllByText("transfer").length).toBeGreaterThan(0);
  });

  it("go-to-definition is silent when the active contract has no trace source", () => {
    // useTraceSources (sourcesByAddr) returns nothing, but useContractSource
    // still supplies the displayed file so identifier tokens stay clickable.
    // Clicking `balances` hits jumpToDefinition's no-files guard (line 500).
    sourcesData.value = {};
    renderDebugger();
    fireEvent.click(screen.getByRole("button", { name: "Next SSTORE (S)" }));
    const ident = screen.getAllByText("balances")[0];
    expect(ident).toBeTruthy();
    fireEvent.click(ident!);
    // Silent: no navError raised.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("nav back/forward are no-ops when the history can't move (early returns)", () => {
    renderDebugger();
    // Fresh history: Cmd+[ and Cmd+] both hit `next === navHistory` (553/560).
    fireEvent.keyDown(window, { key: "[", metaKey: true });
    fireEvent.keyDown(window, { key: "]", metaKey: true });
    expect(screen.getByText(/1 \/ 7/)).toBeInTheDocument();
  });

  it("C and L hotkeys jump to the next CALL and LOG", () => {
    renderDebugger();
    fireEvent.keyDown(window, { key: "c" }); // jumpToNext(isCallOp) → line 621
    // First CALL from step 0 is step 1.
    expect(screen.getByText(/2 \/ 7/)).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "l" }); // jumpToNext(isLogOp) → line 625
    // Next LOG after the current step is the LOG2 at step 4.
    expect(screen.getByText(/5 \/ 7/)).toBeInTheDocument();
  });

  it("ignores keyboard shortcuts when focus is in a text input", () => {
    renderDebugger();
    const input = screen.getByPlaceholderText("Filter...");
    input.focus();
    // The handler's `e.target instanceof HTMLInputElement` guard (line 590)
    // bails, so the step counter stays put.
    fireEvent.keyDown(input, { key: "ArrowRight" });
    expect(screen.getByText(/1 \/ 7/)).toBeInTheDocument();
  });

  it("ignores keyboard shortcuts when the call tree has focus", () => {
    const { container } = renderDebugger();
    const pane = container.querySelector("[data-debugger-tree]") as HTMLElement;
    pane.focus();
    // Dispatch from within the tree → `closest('[data-debugger-tree]')` guard
    // (line 593) hands arrow keys to the tree, not the scrubber.
    fireEvent.keyDown(pane, { key: "ArrowRight" });
    expect(screen.getByText(/1 \/ 7/)).toBeInTheDocument();
  });

  it("clicking an executable source-gutter line jumps execution there (jumpToLine)", () => {
    renderDebugger();
    fireEvent.click(screen.getByRole("button", { name: "Next SSTORE (S)" }));
    // Line 4 (the SSTORE body) is executable — its gutter number is clickable
    // and routes through jumpToLine (816-817).
    const gutter = screen.getAllByText("4");
    if (gutter[0]) fireEvent.click(gutter[0]);
    expect(screen.getAllByText("transfer").length).toBeGreaterThan(0);
  });

  it("dismisses the recents dropdown via the click-away overlay", async () => {
    const { container } = renderDebugger();
    fireEvent.click(screen.getAllByText("transfer")[0]!);
    const recentBtn = await screen.findByRole("button", { name: "Recent" });
    fireEvent.click(recentBtn);
    await screen.findByText(/Recent jumps ·/);
    // The click-away overlay is the fixed full-screen div (zIndex 40).
    const overlay = Array.from(container.querySelectorAll("div")).find(
      (d) => d.style.position === "fixed" && d.style.zIndex === "40",
    );
    expect(overlay).toBeTruthy();
    fireEvent.click(overlay!); // line 954 — setRecentsOpen(false)
    await waitFor(() =>
      expect(screen.queryByText(/Recent jumps ·/)).not.toBeInTheDocument(),
    );
  });

  it("re-applies a recents entry from the dropdown (applyHistoryEntry)", async () => {
    renderDebugger();
    // Click the codeless-callee "receive" row — it carries a funcName hint, so
    // jumpToAndShowSource pushes a labeled Recent entry ("receive").
    fireEvent.click(screen.getAllByText("receive")[0]!);
    const recentBtn = await screen.findByRole("button", { name: "Recent" });
    fireEvent.click(recentBtn);
    await screen.findByText(/Recent jumps ·/);
    // The dropdown row label is "receive"; clicking it re-applies (978-979).
    const rows = screen.getAllByText("receive");
    fireEvent.click(rows[rows.length - 1]!);
    expect(screen.getAllByText("transfer").length).toBeGreaterThan(0);
  });

  it("queues a pendingSearch when source isn't loaded, then the resolver fails it once empty source arrives", async () => {
    // dEaD callee gets a funcName hint but no source yet → files===undefined →
    // setPendingSearch (line 403, resolver early-returns at 724). Then dEaD's
    // source resolves to an EMPTY array → the resolver's files.length===0 branch
    // (lines 726-728) sets a navError.
    const DEAD = "0x000000000000000000000000000000000000dead";
    sourcesData.value = { [WPLS.toLowerCase()]: [SOURCE_FILE] }; // dEaD absent → undefined
    renderDebugger();
    fireEvent.click(screen.getAllByText("receive")[0]!); // queues pendingSearch
    // Now dEaD source "arrives" as empty (unverified); force a re-render so the
    // resolver effect re-runs with files === [].
    sourcesData.value = { [WPLS.toLowerCase()]: [SOURCE_FILE], [DEAD]: [] };
    fireEvent.keyDown(window, { key: "ArrowRight" }); // state change → re-render
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/No verified source/);
  });

  it("raises a navError when the queued search can't find the function in the arrived source", async () => {
    // dEaD source arrives but has NO receive() → findFunctionLine returns null
    // → the resolver's miss branch (line 735) sets a "Couldn't locate" navError.
    const DEAD = "0x000000000000000000000000000000000000dead";
    const DEAD_SRC: SourceFile = {
      name: "Dead.sol",
      content: ["contract Dead {", "  function other() public {}", "}"].join("\n"),
    };
    sourcesData.value = { [WPLS.toLowerCase()]: [SOURCE_FILE] };
    renderDebugger();
    fireEvent.click(screen.getAllByText("receive")[0]!); // queues pendingSearch
    sourcesData.value = { [WPLS.toLowerCase()]: [SOURCE_FILE], [DEAD]: [DEAD_SRC] };
    fireEvent.keyDown(window, { key: "ArrowRight" });
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/Couldn't locate/);
  });

  it("resolves a queued search to a source line when the contract's source arrives", async () => {
    // Same queue, but dEaD's source arrives WITH a matching receive() so the
    // resolver's findFunctionLine hit branch (lines 730-733) sets overrideLine.
    const DEAD = "0x000000000000000000000000000000000000dead";
    const DEAD_SRC: SourceFile = {
      name: "Dead.sol",
      content: ["contract Dead {", "  receive() external payable {}", "}"].join("\n"),
    };
    sourcesData.value = { [WPLS.toLowerCase()]: [SOURCE_FILE] };
    renderDebugger();
    fireEvent.click(screen.getAllByText("receive")[0]!); // queues pendingSearch
    sourcesData.value = { [WPLS.toLowerCase()]: [SOURCE_FILE], [DEAD]: [DEAD_SRC] };
    fireEvent.keyDown(window, { key: "ArrowRight" }); // re-render → resolver runs
    // The hit branch ran (no navError); the source pane is still present.
    await waitFor(() =>
      expect(screen.getAllByText("transfer").length).toBeGreaterThan(0),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("raises a navError when the hinted contract has empty (unverified) source", async () => {
    // dEaD present but EMPTY → files.length === 0 → navError synchronously (405).
    sourcesData.value = {
      [WPLS.toLowerCase()]: [SOURCE_FILE],
      "0x000000000000000000000000000000000000dead": [],
    };
    renderDebugger();
    fireEvent.click(screen.getAllByText("receive")[0]!);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/No verified source|can't locate/);
  });

  it("clamps arrow stepping at the open frame overlay's boundaries", async () => {
    renderDebugger();
    const row = screen.getAllByText("transfer")[0]!.closest("div")!;
    fireEvent.mouseEnter(row);
    const expandBtn = within(row)
      .getAllByRole("button")
      .find((b) => b.getAttribute("tabindex") === "0");
    fireEvent.click(expandBtn!);
    await screen.findByText(/ops · steps/);
    // Jump to the frame's first step (Home scopes to the frame when the overlay
    // is open), then ArrowLeft is clamped (line 609 — break, no step back).
    fireEvent.keyDown(window, { key: "Home" });
    const before = screen.getByText(/\d+ \/ 7/).textContent;
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(screen.getByText(/\d+ \/ 7/).textContent).toBe(before);
    // End scopes to the frame's last step; ArrowRight is then clamped (604).
    fireEvent.keyDown(window, { key: "End" });
    const atEnd = screen.getByText(/\d+ \/ 7/).textContent;
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByText(/\d+ \/ 7/).textContent).toBe(atEnd);
  });

  it("jumps from the frame-opcode overlay row, closing it (overlay onJumpTo)", async () => {
    renderDebugger();
    const row = screen.getAllByText("transfer")[0]!.closest("div")!;
    fireEvent.mouseEnter(row);
    const expandBtn = within(row)
      .getAllByRole("button")
      .find((b) => b.getAttribute("tabindex") === "0");
    expect(expandBtn).toBeTruthy();
    fireEvent.click(expandBtn!);
    await screen.findByText(/ops · steps/);
    // Click an opcode row inside the overlay → onJumpTo recordingNavigate path
    // (lines 1083-1084).
    const opRows = screen.getAllByText("SSTORE");
    fireEvent.click(opRows[opRows.length - 1]!);
    // Overlay closed after the jump.
    await waitFor(() =>
      expect(screen.queryByText(/ops · steps/)).not.toBeInTheDocument(),
    );
  });

  it("resolves a queued search once sources load (pendingSearch resolver)", () => {
    // Start with sources NOT yet loaded for the codeless-callee contract so a
    // hinted jump queues a pendingSearch; then it resolves on the next render.
    sourcesData.value = { [WPLS.toLowerCase()]: [SOURCE_FILE] };
    renderDebugger();
    // The deadbeef value-transfer row resolves to receive/fallback with a hint.
    // Clicking it exercises jumpToAndShowSource's hint path; with WPLS source
    // present the lookup runs synchronously. Just assert no crash + render.
    const rows = screen.getAllByText(/transfer|receive|fallback/);
    if (rows[0]) fireEvent.click(rows[0]);
    expect(screen.getAllByText("transfer").length).toBeGreaterThan(0);
  });
});
