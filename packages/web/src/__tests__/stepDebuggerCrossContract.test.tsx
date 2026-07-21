import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import StepDebugger from "../components/debugger/StepDebugger";
import type { OpcodeStep, CallFrame, StepDetailResponse } from "../api/debugger";
import type { SourceFile, SourceLocation } from "../api/source";

/**
 * Wiring-level regression guard for commit f110b81 (line-click nav is
 * frame-scoped). `StepDebugger/lineToStepIndex.ts` (activeFrame +
 * buildFrameLineIndex) is already unit-tested in isolation, but nothing
 * mounted the real `StepDebugger` with a genuine multi-contract trace to
 * prove the WIRING — the `activeFrameRange`-derived range actually reaching
 * `buildFrameLineIndex` inside StepDebugger.tsx — is intact. A regression
 * that silently dropped the range argument (reverting to the old
 * whole-trace scan) would pass every other test in the suite.
 *
 * Fixture: two contracts, A (root frame) and B (child frame), whose source
 * files share the SAME name ("Token.sol", so the `loc.file ===
 * currentSourceFile.name` filter matches in either frame) but map pc 2 to
 * DIFFERENT lines — line 4 in A's map, line 3 in B's map. The trace also
 * gives frame A an EARLIER step at the colliding pc (2) than frame B's. Old
 * (buggy) behavior: a whole-trace scan records the globally-first step for
 * line 3, which is frame A's step — landing in the wrong contract entirely.
 * Fixed behavior: the scan is scoped to the active frame's own [entry, end)
 * range, so a click while inspecting frame B lands on frame B's step.
 */

const A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

const FILE_A: SourceFile = {
  name: "Token.sol",
  content: [
    "contract Token {", // 1
    "  mapping(address => uint256) public balances;", // 2
    "  function mintInternal() internal {}", // 3
    "  function transfer(address to, uint256 amount) public { balances[to] += amount; }", // 4 — pc 2 lands here (A)
    "}", // 5
  ].join("\n"),
};

const FILE_B: SourceFile = {
  name: "Token.sol",
  content: [
    "contract Token {", // 1
    "  mapping(address => uint256) public balances;", // 2
    "  function transferFrom(address from, address to, uint256 amount) public { balances[to] += amount; }", // 3 — pc 2 lands here (B)
    "  function helperOnly() internal {}", // 4
    "}", // 5
  ].join("\n"),
};

// Same pc (2), different line PER CONTRACT — the exact shape that produces a
// coincidental (wrong) line if a step from one contract is looked up against
// the other contract's map, or against the globally-first occurrence.
const MAP_A: Record<number, SourceLocation | null> = {
  0: {
    file: "Token.sol", line: 2, column: 2, endLine: 2, endColumn: 40,
    sourceSnippet: "mapping(address => uint256) public balances", jumpType: "-",
  },
  2: {
    file: "Token.sol", line: 4, column: 4, endLine: 4, endColumn: 25,
    sourceSnippet: "balances[to] += amount", jumpType: "-",
  },
};
const MAP_B: Record<number, SourceLocation | null> = {
  0: {
    file: "Token.sol", line: 2, column: 2, endLine: 2, endColumn: 40,
    sourceSnippet: "mapping(address => uint256) public balances", jumpType: "-",
  },
  2: {
    file: "Token.sol", line: 3, column: 4, endLine: 3, endColumn: 25,
    sourceSnippet: "balances[to] += amount", jumpType: "-",
  },
};

vi.mock("../hooks/useContractMeta", () => ({
  useContractMeta: () => ({
    names: { [A.toLowerCase()]: "TokenA", [B.toLowerCase()]: "TokenB" },
    abiSelectors: {},
    eventTopics: {},
  }),
}));
vi.mock("../hooks/useSignatures", () => ({
  useSignatures: () => ({ data: {} }),
}));
vi.mock("../hooks/useTraceSourceMaps", () => ({
  useTraceSourceMaps: () => ({
    data: { [A.toLowerCase()]: MAP_A, [B.toLowerCase()]: MAP_B },
  }),
}));
vi.mock("../hooks/useTraceSources", () => ({
  useTraceSources: () => ({
    data: { [A.toLowerCase()]: [FILE_A], [B.toLowerCase()]: [FILE_B] },
    refetch: vi.fn(),
  }),
}));
// Address-aware: the component re-renders and re-calls these as the active
// contract (activeFrameRange.addr) changes with the cursor.
vi.mock("../hooks/useContractSource", () => ({
  useContractSource: (addr?: string | null) => ({
    data:
      addr?.toLowerCase() === B.toLowerCase()
        ? { address: B, files: [FILE_B], hasSourceMap: true }
        : { address: A, files: [FILE_A], hasSourceMap: true },
    isLoading: false,
  }),
  useSourceMappings: (addr?: string | null) => ({
    data: addr?.toLowerCase() === B.toLowerCase() ? MAP_B : MAP_A,
  }),
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
});

function makeStep(o: Partial<OpcodeStep> = {}): OpcodeStep {
  return { pc: 0, op: "JUMPDEST", gas: 1, gasCost: 1, depth: 1, stack: [], memory: [], storage: {}, ...o };
}

// Root frame A calls child frame B. pc 2 collides between frames: frame A's
// SSTORE (idx1) comes BEFORE frame B's SSTORE (idx4) in step order — the old
// whole-trace-first-occurrence scan would resolve line 3 to idx1 (frame A).
const steps: OpcodeStep[] = [
  makeStep({ op: "JUMPDEST", depth: 1, pc: 0 }), // idx0 — frame A
  makeStep({ op: "SSTORE", depth: 1, pc: 2 }), // idx1 — frame A, collides on pc 2 (EARLIER)
  makeStep({ op: "CALL", depth: 1, pc: 1 }), // idx2 — frame A, the CALL into B
  makeStep({ op: "JUMPDEST", depth: 2, pc: 0 }), // idx3 — frame B entry
  makeStep({ op: "SSTORE", depth: 2, pc: 2 }), // idx4 — frame B, correct target for a line-3 click
  makeStep({ op: "RETURN", depth: 1, pc: 8 }), // idx5 — back in frame A
];

const childB: CallFrame = {
  type: "CALL",
  from: A,
  to: B,
  gas: "0x1",
  gasUsed: "0x1",
  input: "0x23b872dd" + "0".repeat(56),
};
const callTrace: CallFrame = {
  type: "CALL",
  from: "0x00",
  to: A,
  gas: "0x1",
  gasUsed: "0x1",
  input: "0x",
  calls: [childB],
};

function renderDebugger() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <StepDebugger steps={steps} contractAddress={A} callTrace={callTrace} txHash="0xtx" />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("StepDebugger cross-contract line-click (f110b81 wiring guard)", () => {
  it("scopes a source-gutter line click to the ACTIVE FRAME's contract, not the globally-first occurrence", () => {
    const { container } = renderDebugger();

    // Move the cursor to idx3 — frame B's entry step (depth 2, inside
    // childB's [3, 5) range) — so activeFrame resolves to B. Arrow-stepping
    // (not a recorded jump) mirrors how a user would step into the sub-call.
    fireEvent.keyDown(window, { key: "ArrowRight" }); // idx1
    fireEvent.keyDown(window, { key: "ArrowRight" }); // idx2
    fireEvent.keyDown(window, { key: "ArrowRight" }); // idx3
    expect(screen.getByText(/4 \/ 6/)).toBeInTheDocument();

    // Before the click: cursor at idx3 (pc 0), active contract B, mapped
    // line 2 — distinct from both candidate outcomes (3 and 4) below, so the
    // click is guaranteed to move something observable either way.
    const rowBefore3 = container.querySelector('[data-line="3"]') as HTMLElement;
    const rowBefore4 = container.querySelector('[data-line="4"]') as HTMLElement;
    expect(rowBefore3.style.borderLeft).not.toContain("var(--color-accent)");
    expect(rowBefore4.style.borderLeft).not.toContain("var(--color-accent)");

    // Click the gutter number "3" — the clickable jump target for line 3.
    const row3 = container.querySelector('[data-line="3"]') as HTMLElement;
    expect(row3).toBeTruthy();
    const gutter3 = within(row3).getByText("3");
    fireEvent.click(gutter3);

    // FIXED behavior: the line index was built from frame B's OWN [entry,
    // end) range (mirrors buildFrameLineIndex(steps, {entry:3,end:5}, MAP_B,
    // "Token.sol")) → line 3 resolves to idx4 (frame B's SSTORE), not idx1
    // (frame A's SSTORE, which the old whole-trace scan would have hit
    // first). Step counter must read 5 / 6 (idx4), never 2 / 6 (idx1).
    expect(screen.getByText(/5 \/ 6/)).toBeInTheDocument();
    expect(screen.queryByText(/2 \/ 6/)).not.toBeInTheDocument();

    // The source pane now highlights line 3 (frame B's own mapping for pc 2)
    // — not line 4, which is what frame A's map would have produced for the
    // same pc had the click (wrongly) landed on idx1.
    const rowAfter3 = container.querySelector('[data-line="3"]') as HTMLElement;
    const rowAfter4 = container.querySelector('[data-line="4"]') as HTMLElement;
    expect(rowAfter3.style.borderLeft).toContain("var(--color-accent)");
    expect(rowAfter4.style.borderLeft).not.toContain("var(--color-accent)");
  });
});
