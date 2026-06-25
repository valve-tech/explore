import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DecodedTrace } from "../components/debugger/StepDebugger/DecodedTrace";
import { FrameOpcodesOverlay } from "../components/debugger/StepDebugger/FrameOpcodesOverlay";
import { TreeFilterBar } from "../components/debugger/StepDebugger/TreeFilterBar";
import FindingsPanel from "../components/debugger/SlitherFindingsPanel";
import type { OpcodeStep, CallFrame } from "../api/debugger";
import type { SourceLocation, SlitherFinding } from "../api/source";

// scrollIntoView isn't implemented in jsdom; both DecodedTrace and the overlay
// call it for the active row.
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

function makeStep(o: Partial<OpcodeStep> = {}): OpcodeStep {
  return { pc: 0, op: "PUSH1", gas: 1, gasCost: 3, depth: 1, stack: [], memory: [], storage: {}, ...o };
}

const WPLS = "0xA1077a294dDE1B09bB078844df40758a5D0f9a27";

describe("DecodedTrace", () => {
  const steps: OpcodeStep[] = [
    makeStep({ op: "PUSH1" }),
    makeStep({ op: "CALL", depth: 1, pc: 10 }),
    makeStep({ op: "JUMP", depth: 1, pc: 20 }),
  ];

  const callTrace: CallFrame = {
    type: "CALL",
    from: "0x01",
    to: "0x02",
    gas: "0x1",
    gasUsed: "0x1",
    input: "0x",
    calls: [
      {
        type: "CALL",
        from: "0x02",
        to: WPLS,
        gas: "0x1",
        gasUsed: "0x1",
        // transfer selector + one arg
        input: "0xa9059cbb" + "0".repeat(128),
      },
    ],
  };

  const sourceMappings: Record<number, SourceLocation | null> = {
    20: {
      file: "Token.sol",
      line: 42,
      column: 0,
      endLine: 42,
      endColumn: 10,
      sourceSnippet: "_mint(to, amount)",
      jumpType: "i",
    },
  };

  it("renders external + internal decoded entries and jumps on click", () => {
    const onJumpTo = vi.fn();
    render(
      <DecodedTrace
        steps={steps}
        currentStep={1}
        signatureMap={{}}
        sourceMappings={sourceMappings}
        callTrace={callTrace}
        contractNames={{ [WPLS.toLowerCase()]: "WPLS" }}
        onJumpTo={onJumpTo}
      />,
    );
    // The external CALL resolves transfer via the well-known table.
    expect(screen.getByText("transfer")).toBeInTheDocument();
    // The internal JUMP (jumpType 'i') decodes from the snippet.
    expect(screen.getByText("_mint")).toBeInTheDocument();
    expect(screen.getByText("WPLS")).toBeInTheDocument();

    fireEvent.click(screen.getByText("transfer"));
    expect(onJumpTo).toHaveBeenCalled();
  });

  it("shows the empty state when no calls are detected", () => {
    render(
      <DecodedTrace
        steps={[makeStep()]}
        currentStep={0}
        signatureMap={{}}
        sourceMappings={{}}
        callTrace={null}
        contractNames={{}}
        onJumpTo={vi.fn()}
      />,
    );
    expect(
      screen.getByText("No function calls detected in this trace"),
    ).toBeInTheDocument();
  });
});

describe("FrameOpcodesOverlay", () => {
  const steps: OpcodeStep[] = [
    makeStep({ op: "JUMPDEST", depth: 1, pc: 0 }),
    makeStep({ op: "SLOAD", depth: 1, pc: 1 }),
    makeStep({ op: "CALL", depth: 1, pc: 2 }),
    makeStep({ op: "PUSH1", depth: 2, pc: 0 }), // nested sub-call
    makeStep({ op: "RETURN", depth: 1, pc: 3 }),
  ];

  it("lists opcodes for the frame range and closes on Escape", () => {
    const onClose = vi.fn();
    render(
      <FrameOpcodesOverlay
        steps={steps}
        from={0}
        to={5}
        label="WPLS.transfer"
        frameType="CALL"
        currentStep={1}
        onJumpTo={vi.fn()}
        onClose={onClose}
      />,
    );
    expect(screen.getByText("WPLS.transfer")).toBeInTheDocument();
    expect(screen.getByText("SLOAD")).toBeInTheDocument();
    // depth-2 row gets a depth indicator.
    expect(screen.getByText(/depth 2/)).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("jumps and closes when a row is clicked", () => {
    const onJumpTo = vi.fn();
    const onClose = vi.fn();
    render(
      <FrameOpcodesOverlay
        steps={steps}
        from={0}
        to={5}
        label="frame"
        frameType="STATICCALL"
        currentStep={1}
        onJumpTo={onJumpTo}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByText("SLOAD"));
    expect(onJumpTo).toHaveBeenCalledWith(1);
    expect(onClose).toHaveBeenCalled();
  });

  it("shows a cursor-outside warning when the cursor is out of range", () => {
    render(
      <FrameOpcodesOverlay
        steps={steps}
        from={0}
        to={3}
        label="frame"
        frameType="CALL"
        currentStep={4}
        onJumpTo={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/cursor outside/)).toBeInTheDocument();
  });

  it("closes when the backdrop is clicked", () => {
    const onClose = vi.fn();
    const { container } = render(
      <FrameOpcodesOverlay
        steps={steps}
        from={0}
        to={5}
        label="frame"
        frameType="CALL"
        currentStep={0}
        onJumpTo={vi.fn()}
        onClose={onClose}
      />,
    );
    // The outermost fixed overlay div is the backdrop.
    fireEvent.click(container.firstChild as Element);
    expect(onClose).toHaveBeenCalled();
  });
});

describe("TreeFilterBar", () => {
  it("toggles node-kind chips", () => {
    const onToggleInternal = vi.fn();
    const onToggleLibrary = vi.fn();
    const onToggleEvents = vi.fn();
    render(
      <TreeFilterBar
        internal
        library
        events
        onToggleInternal={onToggleInternal}
        onToggleLibrary={onToggleLibrary}
        onToggleEvents={onToggleEvents}
        enabledOps={new Set()}
        onToggleOp={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("ƒ internal"));
    fireEvent.click(screen.getByText("📚 library"));
    fireEvent.click(screen.getByText("◈ events"));
    expect(onToggleInternal).toHaveBeenCalled();
    expect(onToggleLibrary).toHaveBeenCalled();
    expect(onToggleEvents).toHaveBeenCalled();
  });

  it("toggles a common opcode chip", () => {
    const onToggleOp = vi.fn();
    render(
      <TreeFilterBar
        internal
        library
        events
        onToggleInternal={vi.fn()}
        onToggleLibrary={vi.fn()}
        onToggleEvents={vi.fn()}
        enabledOps={new Set(["SSTORE"])}
        onToggleOp={onToggleOp}
      />,
    );
    fireEvent.click(screen.getByText("SLOAD"));
    expect(onToggleOp).toHaveBeenCalledWith("SLOAD");
  });

  it("adds a custom opcode via the input on Enter", () => {
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
    fireEvent.change(input, { target: { value: "callvalue" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onToggleOp).toHaveBeenCalledWith("CALLVALUE");
  });

  it("renders extra (non-common) enabled ops as removable chips", () => {
    render(
      <TreeFilterBar
        internal
        library
        events
        onToggleInternal={vi.fn()}
        onToggleLibrary={vi.fn()}
        onToggleEvents={vi.fn()}
        enabledOps={new Set(["GAS"])}
        onToggleOp={vi.fn()}
      />,
    );
    expect(screen.getByText("GAS")).toBeInTheDocument();
  });
});

describe("SlitherFindingsPanel", () => {
  const finding = (over: Partial<SlitherFinding> = {}): SlitherFinding => ({
    check: "reentrancy-eth",
    impact: "High",
    confidence: "Medium",
    description: "Reentrancy in withdraw()\nmore detail",
    elements: [
      {
        type: "function",
        name: "withdraw",
        sourceMapping: {
          start: 0,
          length: 10,
          filename_relative: "Vault.sol",
          lines: [10, 11],
        },
      },
    ],
    markdown: "## details",
    ...over,
  });

  it("renders the empty state when there are no findings", () => {
    render(<FindingsPanel findings={[]} />);
    expect(screen.getByText("No findings detected")).toBeInTheDocument();
  });

  it("sorts by severity, expands a finding, and jumps to a line", () => {
    const onJumpToLine = vi.fn();
    render(
      <FindingsPanel
        findings={[
          finding({ impact: "Low", check: "low-check" }),
          finding({ impact: "High", check: "high-check" }),
        ]}
        onJumpToLine={onJumpToLine}
      />,
    );
    // Severity pills present.
    expect(screen.getByText(/All \(2\)/)).toBeInTheDocument();

    // Expand the first (High, sorted to top).
    fireEvent.click(screen.getByText("high-check"));
    expect(screen.getByText("## details")).toBeInTheDocument();

    // Affected element click → jumps to its first line.
    fireEvent.click(screen.getByText(/function: withdraw/));
    expect(onJumpToLine).toHaveBeenCalledWith("Vault.sol", 10);

    // Line buttons jump too.
    fireEvent.click(screen.getByRole("button", { name: "11" }));
    expect(onJumpToLine).toHaveBeenCalledWith("Vault.sol", 11);
  });

  it("filters by clicking a severity pill", () => {
    render(
      <FindingsPanel
        findings={[
          finding({ impact: "High", check: "high-check" }),
          finding({ impact: "Low", check: "low-check" }),
        ]}
      />,
    );
    // Click the "1 Low" pill to filter to Low only.
    fireEvent.click(screen.getByText("1 Low"));
    expect(screen.getByText("low-check")).toBeInTheDocument();
    expect(screen.queryByText("high-check")).not.toBeInTheDocument();
    // Toggling it again restores all.
    fireEvent.click(screen.getByText("1 Low"));
    expect(screen.getByText("high-check")).toBeInTheDocument();
  });
});
