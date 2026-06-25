import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CallTreeFromOpcodes } from "../components/debugger/StepDebugger/CallTreeFromOpcodes";
import type { OpcodeStep, CallFrame } from "../api/debugger";

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  localStorage.clear();
});

function makeStep(o: Partial<OpcodeStep> = {}): OpcodeStep {
  return { pc: 0, op: "JUMPDEST", gas: 1, gasCost: 1, depth: 1, stack: [], memory: [], storage: {}, ...o };
}

// A 2-frame trace: root → WPLS sub-call. The sub-call runs at depth 2 so it's
// treated as code-running (a real frame, not a value transfer).
const WPLS = "0xA1077a294dDE1B09bB078844df40758a5D0f9a27";

const steps: OpcodeStep[] = [
  makeStep({ depth: 1, pc: 0 }),
  makeStep({ op: "CALL", depth: 1, pc: 1 }),
  makeStep({ op: "JUMPDEST", depth: 2, pc: 0 }),
  makeStep({ op: "SSTORE", depth: 2, pc: 2 }),
  makeStep({ op: "RETURN", depth: 1, pc: 3 }),
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
  to: "0xroot",
  gas: "0x1",
  gasUsed: "0x1",
  input: "0x",
  calls: [child],
};

const frameStepMap = new Map<CallFrame, number>([
  [callTrace, 0],
  [child, 2],
]);

describe("CallTreeFromOpcodes", () => {
  it("renders the no-call-tree fallback when callTrace is null", () => {
    render(
      <CallTreeFromOpcodes
        steps={steps}
        onJumpTo={vi.fn()}
        signatureMap={{}}
        frameStepMap={new Map()}
        traceSourceMaps={{}}
        callTrace={null}
        contractNames={{}}
        abiSelectors={{}}
      />,
    );
    expect(screen.getByText("No call tree available")).toBeInTheDocument();
  });

  it("renders the inline fallback when callTrace is null and inline", () => {
    render(
      <CallTreeFromOpcodes
        steps={steps}
        onJumpTo={vi.fn()}
        signatureMap={{}}
        frameStepMap={new Map()}
        traceSourceMaps={{}}
        callTrace={null}
        contractNames={{}}
        abiSelectors={{}}
        inline
      />,
    );
    expect(screen.getByText("No call tree")).toBeInTheDocument();
  });

  it("renders the built tree with the filter bar and a child call row", () => {
    render(
      <CallTreeFromOpcodes
        steps={steps}
        onJumpTo={vi.fn()}
        signatureMap={{}}
        frameStepMap={frameStepMap}
        traceSourceMaps={{}}
        callTrace={callTrace}
        contractNames={{ [WPLS.toLowerCase()]: "WPLS" }}
        abiSelectors={{}}
        treeStateKey="0xtx"
      />,
    );
    // Filter bar present (non-inline mode).
    expect(screen.getByText("ƒ internal")).toBeInTheDocument();
    // The sub-call resolves to WPLS.transfer (well-known selector).
    expect(screen.getByText("WPLS")).toBeInTheDocument();
    expect(screen.getByText("transfer")).toBeInTheDocument();
  });

  it("toggles an opcode filter chip to surface op leaves", () => {
    render(
      <CallTreeFromOpcodes
        steps={steps}
        onJumpTo={vi.fn()}
        signatureMap={{}}
        frameStepMap={frameStepMap}
        traceSourceMaps={{}}
        callTrace={callTrace}
        contractNames={{}}
        abiSelectors={{}}
        treeStateKey="0xtx"
      />,
    );
    // SSTORE runs in the child frame at depth 2; toggling it on adds an op leaf.
    fireEvent.click(screen.getByText("SSTORE"));
    expect(screen.getByText("@ pc 2")).toBeInTheDocument();
  });

  it("supports keyboard navigation on the focusable tree pane", () => {
    const { container } = render(
      <CallTreeFromOpcodes
        steps={steps}
        onJumpTo={vi.fn()}
        signatureMap={{}}
        frameStepMap={frameStepMap}
        traceSourceMaps={{}}
        callTrace={callTrace}
        contractNames={{}}
        abiSelectors={{}}
        treeStateKey="0xtx"
      />,
    );
    const pane = container.querySelector("[data-debugger-tree]") as HTMLElement;
    expect(pane).toBeTruthy();
    pane.focus();
    // ArrowDown selects the first visible row (no throw, action resolved).
    fireEvent.keyDown(pane, { key: "ArrowDown" });
    fireEvent.keyDown(pane, { key: "ArrowDown" });
  });

  it("renders inline content without the card chrome", () => {
    render(
      <CallTreeFromOpcodes
        steps={steps}
        onJumpTo={vi.fn()}
        signatureMap={{}}
        frameStepMap={frameStepMap}
        traceSourceMaps={{}}
        callTrace={callTrace}
        contractNames={{}}
        abiSelectors={{}}
        inline
      />,
    );
    // No filter bar in inline mode.
    expect(screen.queryByText("ƒ internal")).not.toBeInTheDocument();
    expect(screen.getByText("transfer")).toBeInTheDocument();
  });
});
