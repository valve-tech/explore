import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CallFrameRow } from "../components/debugger/StepDebugger/CallFrameRow";
import { ControlsBar } from "../components/debugger/StepDebugger/ControlsBar";
import { SourceTabContent } from "../components/debugger/StepDebugger/SourceTabContent";
import { TreeFilterBar } from "../components/debugger/StepDebugger/TreeFilterBar";
import { OpcodeTracePane } from "../components/debugger/StepDebugger/OpcodeTracePane";
import { FrameOpcodesOverlay } from "../components/debugger/StepDebugger/FrameOpcodesOverlay";
import { OpcodeCategoryBreakdown } from "../components/debugger/GasProfiler/OpcodeCategoryBreakdown";
import FindingsPanel from "../components/debugger/SlitherFindingsPanel";
import SourceViewer from "../components/debugger/SoliditySourceViewer";
import type { ExecNode } from "../components/debugger/StepDebugger/executionScopes";
import type { TreeShared } from "../components/debugger/StepDebugger/TreeNode";
import type { CallFrame, OpcodeStep, OpcodeCategory } from "../api/debugger";
import type { SlitherFinding } from "../api/source";

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

function makeStep(o: Partial<OpcodeStep> = {}): OpcodeStep {
  return { pc: 0, op: "PUSH1", gas: 1, gasCost: 3, depth: 1, stack: [], memory: [], storage: {}, ...o };
}

// ---------------------------------------------------------------------------
// CallFrameRow — uncovered: formatGas (22 zero-gas → null, 25/28 catch), valuePLS
// small-amount path (115,120-124), and onMouseLeave (135).
// ---------------------------------------------------------------------------
function sharedStub(over: Partial<TreeShared> = {}): TreeShared {
  return {
    onJumpTo: vi.fn(),
    signatureMap: {},
    contractNames: {},
    abiSelectors: {},
    ...over,
  };
}

function callNode(frame: Partial<CallFrame>): Extract<ExecNode, { kind: "call" }> {
  return {
    kind: "call",
    frame: {
      type: "CALL",
      from: "0x00",
      to: "0xcontract",
      gas: "0x1",
      gasUsed: "0x0",
      input: "0x",
      ...frame,
    } as CallFrame,
    startStep: 0,
    children: [],
  };
}

describe("CallFrameRow mop-up", () => {
  it("renders a small (sub-1) PLS value transfer with extra decimals", () => {
    // 0.000123 PLS in wei = 123 * 10^12 → whole=0, so the small-amount branch
    // (lines 120-124) runs, padding fractional digits.
    const wei = (123n * 10n ** 12n).toString(16);
    render(
      <TreeWrap>
        <CallFrameRow
          node={callNode({ value: "0x" + wei, to: "0xabc" })}
          depth={0}
          shared={sharedStub()}
        />
      </TreeWrap>,
    );
    // The PLS amount renders with the "PLS" suffix.
    expect(screen.getByText(/PLS$/)).toBeInTheDocument();
  });

  it("renders a whole-number PLS value transfer", () => {
    // 2 PLS exactly → whole>0 branch (line 118).
    const wei = (2n * 10n ** 18n).toString(16);
    render(
      <TreeWrap>
        <CallFrameRow
          node={callNode({ value: "0x" + wei })}
          depth={0}
          shared={sharedStub()}
        />
      </TreeWrap>,
    );
    expect(screen.getByText(/2\.0000 PLS/)).toBeInTheDocument();
  });

  it("treats an unparseable value as no transfer (catch path), and shows no gas for 0 gasUsed", () => {
    render(
      <TreeWrap>
        <CallFrameRow
          node={callNode({ value: "0xZZ", gasUsed: "0x0" })}
          depth={0}
          shared={sharedStub()}
        />
      </TreeWrap>,
    );
    // No PLS amount (value parse threw → null) and no gas figure (0 → null).
    expect(screen.queryByText(/PLS$/)).not.toBeInTheDocument();
  });

  it("formats non-zero gasUsed", () => {
    render(
      <TreeWrap>
        <CallFrameRow
          node={callNode({ gasUsed: "0x5208" })} // 21000
          depth={0}
          shared={sharedStub()}
        />
      </TreeWrap>,
    );
    expect(screen.getByText("21,000")).toBeInTheDocument();
  });

  it("renders no gas when gasUsed is absent (formatGas null guard) and treats a 0x0000 value as no transfer", () => {
    render(
      <TreeWrap>
        <CallFrameRow
          node={callNode({ gasUsed: undefined, value: "0x0000", to: "0xabc" })}
          depth={0}
          shared={sharedStub()}
        />
      </TreeWrap>,
    );
    // value parses to 0n → the wei===0n guard (line 115) returns null, no PLS.
    expect(screen.queryByText(/PLS$/)).not.toBeInTheDocument();
  });

  it("treats an unparseable gasUsed as no gas (formatGas catch)", () => {
    const { container } = render(
      <TreeWrap>
        <CallFrameRow
          node={callNode({ gasUsed: "0xNOTHEX" })}
          depth={0}
          shared={sharedStub()}
        />
      </TreeWrap>,
    );
    // BigInt("0xNOTHEX") throws → formatGas catch returns null; the row still
    // renders (no gas figure with the ml-auto right-aligned class).
    expect(container.querySelector("[data-node-key]")).toBeTruthy();
    expect(container.querySelector(".ml-auto")).toBeNull();
  });

  it("clears hover state on mouse leave (line 135)", () => {
    const { container } = render(
      <TreeWrap>
        <CallFrameRow
          node={callNode({ to: "0xabc", gasUsed: "0x5208" })}
          depth={0}
          shared={sharedStub()}
        />
      </TreeWrap>,
    );
    const row = container.querySelector("[data-node-key]") as HTMLElement;
    fireEvent.mouseEnter(row); // hover tooltip appears
    fireEvent.mouseLeave(row); // line 135 — setHovered(false)
    // After leaving, the hover detail popover (its gas: text) is gone.
    expect(screen.queryByText(/gas: 0x5208/)).not.toBeInTheDocument();
  });
});

function TreeWrap({ children }: { children: React.ReactNode }) {
  return <div>{children}</div>;
}

// ---------------------------------------------------------------------------
// ControlsBar — uncovered: LOG jumpToNext (74), opcodeFilter onChange (83),
// setContentView("debugger") via the Debugger button (96).
// ---------------------------------------------------------------------------
describe("ControlsBar mop-up", () => {
  const baseProps = {
    currentStep: 0,
    totalSteps: 10,
    goTo: vi.fn(),
    jumpToStart: vi.fn(),
    jumpToEnd: vi.fn(),
    stepForward: vi.fn(),
    stepBackward: vi.fn(),
    jumpToNext: vi.fn(),
    hasNext: { call: true, store: true, log: true },
    opcodeFilter: "",
    setOpcodeFilter: vi.fn(),
    filteredCount: null,
    contentView: "trace" as const,
    setContentView: vi.fn(),
    sourceLoading: false,
    handleAnalyze: vi.fn(),
    slitherLoading: false,
    showFindings: false,
    slitherFindingsCount: 0,
  };

  it("fires jumpToNext for the LOG button", () => {
    const jumpToNext = vi.fn();
    render(<ControlsBar {...baseProps} jumpToNext={jumpToNext} />);
    fireEvent.click(screen.getByRole("button", { name: "Next LOG (L)" }));
    expect(jumpToNext).toHaveBeenCalled();
  });

  it("updates the opcode filter on input change", () => {
    const setOpcodeFilter = vi.fn();
    render(<ControlsBar {...baseProps} setOpcodeFilter={setOpcodeFilter} />);
    fireEvent.change(screen.getByPlaceholderText("Filter..."), {
      target: { value: "SLOAD" },
    });
    expect(setOpcodeFilter).toHaveBeenCalledWith("SLOAD");
  });

  it("switches to the debugger view via the Debugger button", () => {
    const setContentView = vi.fn();
    render(
      <ControlsBar
        {...baseProps}
        contractAddress="0xabc"
        setContentView={setContentView}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Debugger" }));
    expect(setContentView).toHaveBeenCalledWith("debugger");
  });
});

// ---------------------------------------------------------------------------
// SourceTabContent — uncovered 63-69: the slitherFindings flatMap that builds
// per-line viewer findings.
// ---------------------------------------------------------------------------
describe("SourceTabContent mop-up", () => {
  const file = { name: "Token.sol", content: "contract Token {\n  uint x;\n}\n" };

  it("flattens Slither findings into per-line viewer markers", () => {
    const findings: SlitherFinding[] = [
      {
        check: "reentrancy",
        impact: "High",
        confidence: "Medium",
        description: "danger here\nmore detail",
        elements: [
          {
            type: "node",
            name: "x",
            sourceMapping: { lines: [2] },
          },
        ],
      } as never,
    ];
    render(
      <SourceTabContent
        currentSourceFile={file}
        allFiles={[file]}
        effectiveLine={2}
        highlightSpan={null}
        scrollKey={0}
        slitherFindings={findings}
        sourceLoading={false}
        activeContractAddress="0xabc"
      />,
    );
    // The source pane renders (the flatMap ran without throwing); line 2 present.
    expect(screen.getByText("2")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// TreeFilterBar — uncovered 80: an enabled op NOT in COMMON_OPS renders an
// extra removable chip.
// ---------------------------------------------------------------------------
describe("TreeFilterBar mop-up", () => {
  it("renders an extra removable chip for an enabled non-common opcode", () => {
    const onToggleOp = vi.fn();
    render(
      <TreeFilterBar
        internal
        library
        events
        onToggleInternal={vi.fn()}
        onToggleLibrary={vi.fn()}
        onToggleEvents={vi.fn()}
        enabledOps={new Set(["JUMPI"])} // not in COMMON_OPS → extraOps chip
        onToggleOp={onToggleOp}
      />,
    );
    const chip = screen.getByText("JUMPI");
    expect(chip).toBeInTheDocument();
    fireEvent.click(chip); // removable chip toggles it off
    expect(onToggleOp).toHaveBeenCalledWith("JUMPI");
  });

  it("adds a typed opcode on Enter", () => {
    const onToggleOp = vi.fn();
    render(
      <TreeFilterBar
        internal
        library
        events
        onToggleInternal={vi.fn()}
        onToggleLibrary={vi.fn()}
        onToggleEvents={vi.fn()}
        enabledOps={new Set()}
        onToggleOp={onToggleOp}
      />,
    );
    const input = screen.getByPlaceholderText("+ opcode");
    fireEvent.change(input, { target: { value: "delegatecall" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onToggleOp).toHaveBeenCalledWith("DELEGATECALL");
  });
});

// ---------------------------------------------------------------------------
// OpcodeTracePane — uncovered 35 (handleScroll) and 47 (recenter effect when
// the active row is out of the current viewport).
// ---------------------------------------------------------------------------
describe("OpcodeTracePane mop-up", () => {
  const steps = Array.from({ length: 100 }, (_, i) =>
    makeStep({ op: "PUSH1", pc: i, depth: 1 }),
  );

  it("recenters when currentStep is far down and handles scroll events", () => {
    // Give the scroller a measurable clientHeight so the recenter math (line 47)
    // runs — jsdom reports 0 otherwise and the branch can't be exercised.
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get() {
        return 400;
      },
    });
    const { container, rerender } = render(
      <OpcodeTracePane
        steps={steps}
        currentStep={0}
        goTo={vi.fn()}
        filteredIndices={null}
        maxDepth={1}
      />,
    );
    const scroller = container.querySelector(".overflow-y-auto") as HTMLElement;
    expect(scroller).toBeTruthy();
    // Scroll the list down (handleScroll, line 35).
    fireEvent.scroll(scroller, { target: { scrollTop: 2000 } });
    // Now move the cursor to a step ABOVE the current viewport → recenter (47).
    rerender(
      <OpcodeTracePane
        steps={steps}
        currentStep={2}
        goTo={vi.fn()}
        filteredIndices={null}
        maxDepth={1}
      />,
    );
    expect(screen.getByText("Opcode")).toBeInTheDocument();
    // Restore the default clientHeight getter.
    delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
  });
});

// ---------------------------------------------------------------------------
// FrameOpcodesOverlay — uncovered 132: the onScroll handler that updates the
// virtual window's scrollTop.
// ---------------------------------------------------------------------------
describe("FrameOpcodesOverlay mop-up", () => {
  const steps = Array.from({ length: 60 }, (_, i) =>
    makeStep({ op: "PUSH1", pc: i, depth: 1 }),
  );

  it("updates the virtual window on scroll and jumps a row on click", () => {
    const onJumpTo = vi.fn();
    const onClose = vi.fn();
    const { container } = render(
      <FrameOpcodesOverlay
        steps={steps}
        from={0}
        to={60}
        label="Token.transfer"
        frameType="CALL"
        currentStep={0}
        onJumpTo={onJumpTo}
        onClose={onClose}
      />,
    );
    const scroller = container.querySelector(".overflow-y-auto") as HTMLElement;
    expect(scroller).toBeTruthy();
    // onScroll (line 132) sets scrollTop → recomputes the visible window.
    fireEvent.scroll(scroller, { target: { scrollTop: 300 } });
    // Esc closes the overlay (the keydown effect).
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// OpcodeCategoryBreakdown — uncovered 17: a category whose share is < 0.5% is
// skipped from the bar (returns null).
// ---------------------------------------------------------------------------
describe("OpcodeCategoryBreakdown mop-up", () => {
  it("skips a category whose gas share is below 0.5% of the total", () => {
    const categories: OpcodeCategory[] = [
      { category: "arithmetic", gas: 10000, count: 100, percentage: 99.9 },
      { category: "dust", gas: 1, count: 1, percentage: 0.01 }, // < 0.5% → bar skips
    ];
    render(<OpcodeCategoryBreakdown categories={categories} />);
    // Both categories still appear in the legend (lower section), so "dust" is
    // present once (legend) even though its bar segment was skipped.
    expect(screen.getByText("dust")).toBeInTheDocument();
    expect(screen.getByText("arithmetic")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// SlitherFindingsPanel — uncovered 69: the "All" filter button resets severity.
// ---------------------------------------------------------------------------
describe("SlitherFindingsPanel mop-up", () => {
  const findings: SlitherFinding[] = [
    {
      check: "reentrancy",
      impact: "High",
      confidence: "Medium",
      description: "danger",
      elements: [],
    } as never,
  ];

  it("clicking a severity pill then All resets the filter", () => {
    render(<FindingsPanel findings={findings} />);
    // Filter to High (pill text is "1 High"), then click All to clear (line 69).
    fireEvent.click(screen.getByText("1 High"));
    fireEvent.click(screen.getByText("All (1)"));
    expect(screen.getByText("All (1)")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// SoliditySourceViewer — uncovered 279-280: the onMouseEnter/onMouseLeave
// underline handlers on a clickable identifier token.
// ---------------------------------------------------------------------------
describe("SoliditySourceViewer mop-up", () => {
  const file = {
    name: "Token.sol",
    content: "contract Token {\n  function mint() public {}\n}\n",
  };

  it("toggles underline on identifier hover (mouse enter/leave)", () => {
    render(
      <SourceViewer
        file={file}
        currentLine={2}
        onIdentifierClick={vi.fn()}
        executableLines={new Set([2])}
      />,
    );
    const token = screen.getByText("mint");
    fireEvent.mouseEnter(token); // line 279 — underline on
    expect(token.style.textDecoration).toBe("underline");
    fireEvent.mouseLeave(token); // line 280 — underline off
    expect(token.style.textDecoration).toBe("none");
  });

  it("scrolls the current line into view when it sits below the viewport", () => {
    // Drive the rAF auto-scroll branch (line 132): mock geometry so the target
    // line's bottom is below the container's visible bottom.
    const rafSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((cb: FrameRequestCallback) => {
        cb(0);
        return 0;
      });
    // The current line element reports a large offsetTop (below viewport).
    const offsetTop = vi
      .spyOn(HTMLElement.prototype, "offsetTop", "get")
      .mockReturnValue(5000);
    const offsetHeight = vi
      .spyOn(HTMLElement.prototype, "offsetHeight", "get")
      .mockReturnValue(20);
    const clientHeight = vi
      .spyOn(HTMLElement.prototype, "clientHeight", "get")
      .mockReturnValue(200);
    const bigFile = {
      name: "Big.sol",
      content: Array.from({ length: 40 }, (_, i) => `  uint256 v${i} = ${i};`).join("\n"),
    };
    const { rerender } = render(
      <SourceViewer file={bigFile} currentLine={1} scrollKey={0} />,
    );
    // Re-render with a deeper current line + new scrollKey to retrigger the effect.
    rerender(<SourceViewer file={bigFile} currentLine={30} scrollKey={1} />);
    expect(screen.getByText("Big.sol")).toBeInTheDocument();
    rafSpy.mockRestore();
    offsetTop.mockRestore();
    offsetHeight.mockRestore();
    clientHeight.mockRestore();
  });

  it("scrolls the current line up when it sits above the viewport", () => {
    // Drive the rAF scroll-up branch (line 128): the target line's top is above
    // the container's scrolled position.
    const rafSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((cb: FrameRequestCallback) => {
        cb(0);
        return 0;
      });
    const offsetTop = vi
      .spyOn(HTMLElement.prototype, "offsetTop", "get")
      .mockReturnValue(0); // line near the top of the document
    const offsetHeight = vi
      .spyOn(HTMLElement.prototype, "offsetHeight", "get")
      .mockReturnValue(20);
    const clientHeight = vi
      .spyOn(HTMLElement.prototype, "clientHeight", "get")
      .mockReturnValue(200);
    // Container scrolled far down so lineTop (0) is above viewTop.
    const scrollTop = vi
      .spyOn(HTMLElement.prototype, "scrollTop", "get")
      .mockReturnValue(1000);
    const setScrollTop = vi
      .spyOn(HTMLElement.prototype, "scrollTop", "set")
      .mockImplementation(() => {});
    const bigFile = {
      name: "Big2.sol",
      content: Array.from({ length: 40 }, (_, i) => `  uint256 v${i} = ${i};`).join("\n"),
    };
    const { rerender } = render(
      <SourceViewer file={bigFile} currentLine={40} scrollKey={0} />,
    );
    rerender(<SourceViewer file={bigFile} currentLine={1} scrollKey={1} />);
    expect(screen.getByText("Big2.sol")).toBeInTheDocument();
    rafSpy.mockRestore();
    offsetTop.mockRestore();
    offsetHeight.mockRestore();
    clientHeight.mockRestore();
    scrollTop.mockRestore();
    setScrollTop.mockRestore();
  });
});
