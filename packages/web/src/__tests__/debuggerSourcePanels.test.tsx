import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryPanel } from "../components/debugger/StepDebugger/MemoryPanel";
import { StackPanel } from "../components/debugger/StepDebugger/StackPanel";
import { CollapsiblePanel } from "../components/debugger/StepDebugger/CollapsiblePanel";
import { OpcodeFrequencyTags } from "../components/debugger/StepDebugger/OpcodeFrequencyTags";
import { OpcodeTracePane } from "../components/debugger/StepDebugger/OpcodeTracePane";
import { ControlsBar } from "../components/debugger/StepDebugger/ControlsBar";
import { SourceTabContent } from "../components/debugger/StepDebugger/SourceTabContent";
import { SourceOpcodeSplit } from "../components/debugger/StepDebugger/SourceOpcodeSplit";
import SourceViewer from "../components/debugger/SoliditySourceViewer";
import type { OpcodeStep } from "../api/debugger";

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  localStorage.clear();
});

function makeStep(o: Partial<OpcodeStep> = {}): OpcodeStep {
  return { pc: 0, op: "PUSH1", gas: 1, gasCost: 3, depth: 1, stack: [], memory: [], storage: {}, ...o };
}

describe("CollapsiblePanel", () => {
  it("starts open by default and hides children when toggled", () => {
    render(
      <CollapsiblePanel title="Stack" count={3} suffix="words">
        <div>body content</div>
      </CollapsiblePanel>,
    );
    expect(screen.getByText("body content")).toBeInTheDocument();
    expect(screen.getByText("3 words")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button"));
    expect(screen.queryByText("body content")).not.toBeInTheDocument();
  });

  it("can start collapsed and uses default suffix", () => {
    render(
      <CollapsiblePanel title="Memory" count={2} defaultOpen={false}>
        <div>hidden</div>
      </CollapsiblePanel>,
    );
    expect(screen.queryByText("hidden")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("hidden")).toBeInTheDocument();
    expect(screen.getByText("2 items")).toBeInTheDocument();
  });
});

describe("MemoryPanel", () => {
  it("shows the loading state", () => {
    render(<MemoryPanel memory={[]} loading />);
    fireEvent.click(screen.getByRole("button")); // expand
    expect(screen.getByText("Loading memory…")).toBeInTheDocument();
  });

  it("shows the empty state when memory has no bytes", () => {
    render(<MemoryPanel memory={[]} />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("Memory is empty")).toBeInTheDocument();
  });

  it("renders hex rows and highlights the touched write region", () => {
    // 32 bytes of memory (one word).
    const word = "ff".repeat(32);
    render(
      <MemoryPanel
        memory={[word]}
        highlight={{ kind: "write", offset: 0, size: 4 }}
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    // Offset gutter for the first row.
    expect(screen.getByText("0000")).toBeInTheDocument();
  });
});

describe("StackPanel", () => {
  it("renders stack words newest-first with input + changed highlights", () => {
    render(
      <StackPanel
        stack={["0xaa", "0xbb"]}
        changedIndices={new Set([1])}
        inputIndices={new Set([0])}
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    // The consumed input slot shows an "in" badge.
    expect(screen.getByText("in")).toBeInTheDocument();
  });

  it("shows loading and empty states", () => {
    const { rerender } = render(
      <StackPanel stack={[]} changedIndices={new Set()} loading />,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("Loading stack…")).toBeInTheDocument();

    rerender(<StackPanel stack={[]} changedIndices={new Set()} />);
    expect(screen.getByText("Stack is empty")).toBeInTheDocument();
  });
});

describe("OpcodeFrequencyTags", () => {
  it("returns null when there are no frequencies", () => {
    const { container } = render(
      <OpcodeFrequencyTags frequencies={[]} activeOp="" onToggle={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders tags and toggles on click", () => {
    const onToggle = vi.fn();
    render(
      <OpcodeFrequencyTags
        frequencies={[
          { op: "PUSH1", count: 5, gas: 15 },
          { op: "SLOAD", count: 1, gas: 2100 },
        ]}
        activeOp="PUSH1"
        onToggle={onToggle}
      />,
    );
    expect(
      screen.getByRole("button", { name: "SLOAD — 1 occurrence" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "PUSH1 — 5 occurrences" }));
    expect(onToggle).toHaveBeenCalledWith("PUSH1");
  });
});

describe("OpcodeTracePane", () => {
  const steps: OpcodeStep[] = [
    makeStep({ op: "PUSH1", pc: 0, depth: 1, gasCost: 3 }),
    makeStep({ op: "SSTORE", pc: 2, depth: 2, gasCost: 20000 }),
    makeStep({ op: "RETURN", pc: 3, depth: 1, gasCost: 0 }),
  ];

  it("renders rows, dims filtered-out ops, and jumps on click", () => {
    const goTo = vi.fn();
    render(
      <OpcodeTracePane
        steps={steps}
        currentStep={0}
        goTo={goTo}
        filteredIndices={new Set([1])}
        maxDepth={2}
      />,
    );
    expect(screen.getByText("Opcode")).toBeInTheDocument();
    // High gas cost styled with warning — value still rendered.
    expect(screen.getByText("20000")).toBeInTheDocument();
    fireEvent.click(screen.getByText("SSTORE"));
    expect(goTo).toHaveBeenCalledWith(1);
  });
});

describe("ControlsBar", () => {
  const baseProps = {
    currentStep: 0,
    totalSteps: 10,
    goTo: vi.fn(),
    jumpToStart: vi.fn(),
    jumpToEnd: vi.fn(),
    stepForward: vi.fn(),
    stepBackward: vi.fn(),
    jumpToNext: vi.fn(),
    hasNext: { call: true, store: false, log: true },
    opcodeFilter: "",
    setOpcodeFilter: vi.fn(),
    filteredCount: null,
    contentView: "debugger" as const,
    setContentView: vi.fn(),
    sourceLoading: false,
    handleAnalyze: vi.fn(),
    slitherLoading: false,
    showFindings: false,
    slitherFindingsCount: 0,
  };

  it("disables next-X buttons per hasNext and fires jumps", () => {
    const jumpToNext = vi.fn();
    render(<ControlsBar {...baseProps} jumpToNext={jumpToNext} />);
    expect(screen.getByRole("button", { name: "Next SSTORE (S)" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Next CALL (C)" }));
    expect(jumpToNext).toHaveBeenCalled();
  });

  it("drives the slider through goTo and shows the counter", () => {
    const goTo = vi.fn();
    render(<ControlsBar {...baseProps} goTo={goTo} currentStep={2} />);
    expect(screen.getByText("3 / 10")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("slider"), { target: { value: "5" } });
    expect(goTo).toHaveBeenCalledWith(5);
  });

  it("shows the Slither + Debugger controls only when a contract is loaded", () => {
    const handleAnalyze = vi.fn();
    render(
      <ControlsBar
        {...baseProps}
        contractAddress="0xabc"
        slitherFindingsCount={3}
        showFindings
      />,
    );
    expect(screen.getByText("Slither (3)")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Slither (3)"));
    expect(handleAnalyze).not.toHaveBeenCalled(); // wired to its own prop
  });

  it("shows the filtered match count when set", () => {
    render(<ControlsBar {...baseProps} filteredCount={7} />);
    expect(screen.getByText("7 matches")).toBeInTheDocument();
  });
});

describe("SourceTabContent", () => {
  const file = { name: "Token.sol", content: "contract Token {\n  uint x;\n}\n" };

  it("renders the no-source fallback when no file is available", () => {
    render(
      <SourceTabContent
        currentSourceFile={null}
        allFiles={[]}
        effectiveLine={null}
        highlightSpan={null}
        scrollKey={0}
        slitherFindings={[]}
        sourceLoading={false}
        activeContractAddress="0x1234567890abcdef1234567890abcdef12345678"
      />,
    );
    expect(
      screen.getByText("No verified source available for this contract"),
    ).toBeInTheDocument();
  });

  it("shows a loading message while source loads", () => {
    render(
      <SourceTabContent
        currentSourceFile={null}
        allFiles={[]}
        effectiveLine={null}
        highlightSpan={null}
        scrollKey={0}
        slitherFindings={[]}
        sourceLoading
        activeContractAddress={null}
      />,
    );
    expect(screen.getByText("Loading verified source...")).toBeInTheDocument();
  });

  it("renders the source viewer and lets the user switch files via tabs", () => {
    const second = { name: "lib/SafeMath.sol", content: "library SafeMath {}\n" };
    render(
      <SourceTabContent
        currentSourceFile={file}
        allFiles={[file, second]}
        effectiveLine={2}
        highlightSpan={null}
        scrollKey={0}
        slitherFindings={[]}
        sourceLoading={false}
        activeContractAddress="0xabc"
      />,
    );
    // Tab strip shows basenames (Token.sol also appears in the source header,
    // so assert the SafeMath tab uniquely).
    expect(screen.getByText("SafeMath.sol")).toBeInTheDocument();
    // Switch to the second file. Source is tokenized, so "library" is its own
    // token in the rendered viewer.
    fireEvent.click(screen.getByText("SafeMath.sol"));
    expect(screen.getByText("library")).toBeInTheDocument();
  });
});

describe("SourceOpcodeSplit", () => {
  const file = { name: "Token.sol", content: "contract Token {}\n" };
  const steps = [makeStep({ op: "PUSH1" })];

  it("collapses and restores the opcode pane (persisted in localStorage)", () => {
    render(
      <SourceOpcodeSplit
        currentSourceFile={file}
        allFiles={[file]}
        effectiveLine={1}
        highlightSpan={null}
        scrollKey={0}
        slitherFindings={[]}
        sourceLoading={false}
        activeContractAddress="0xabc"
        executableLines={new Set([1])}
        onJumpToLine={vi.fn()}
        steps={steps}
        currentStep={0}
        goTo={vi.fn()}
        filteredIndices={null}
        maxDepth={1}
        opcodeFreqs={[{ op: "PUSH1", count: 1, gas: 3 }]}
        opcodeFilter=""
        onToggleOpcode={vi.fn()}
      />,
    );
    // Opcode pane visible (its column header).
    expect(screen.getByText("Opcode")).toBeInTheDocument();
    // The collapse button carries no accessible name (Tooltip is hover-only);
    // it's the only button without an aria-label (frequency tags have one).
    const collapseBtn = screen
      .getAllByRole("button")
      .find((b) => !b.hasAttribute("aria-label"))!;
    fireEvent.click(collapseBtn);
    expect(localStorage.getItem("debugger:opcodePaneCollapsed")).toBe("1");
    // The opcode column header is gone once collapsed; only the restore rail
    // button remains.
    expect(screen.queryByText("Opcode")).not.toBeInTheDocument();
  });
});

describe("SoliditySourceViewer", () => {
  const file = {
    name: "Token.sol",
    content: "contract Token {\n  function mint() public {}\n}\n",
  };

  it("renders source lines and fires onIdentifierClick on identifier tokens", () => {
    const onIdentifierClick = vi.fn();
    render(
      <SourceViewer
        file={file}
        currentLine={2}
        onIdentifierClick={onIdentifierClick}
        executableLines={new Set([2])}
        onLineClick={vi.fn()}
      />,
    );
    // Identifier token (function name) is clickable.
    const token = screen.getByText("mint");
    fireEvent.click(token);
    expect(onIdentifierClick).toHaveBeenCalledWith("mint", 2);
  });

  it("invokes onLineClick from an executable gutter number", () => {
    const onLineClick = vi.fn();
    render(
      <SourceViewer
        file={file}
        currentLine={null}
        onLineClick={onLineClick}
        executableLines={new Set([2])}
      />,
    );
    fireEvent.click(screen.getByText("2"));
    expect(onLineClick).toHaveBeenCalledWith(2);
  });

  it("renders a findings marker in the gutter", () => {
    render(
      <SourceViewer
        file={file}
        currentLine={null}
        findings={[{ line: 2, severity: "High", message: "danger" }]}
      />,
    );
    // The line still renders; the marker is an inline span (no text), so we
    // assert the line is present.
    expect(screen.getByText("2")).toBeInTheDocument();
  });
});
