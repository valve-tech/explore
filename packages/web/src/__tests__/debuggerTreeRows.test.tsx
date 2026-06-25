import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CallFrameRow } from "../components/debugger/StepDebugger/CallFrameRow";
import { ScopeRow } from "../components/debugger/StepDebugger/ScopeRow";
import { LogRow } from "../components/debugger/StepDebugger/LogRow";
import { OpRow } from "../components/debugger/StepDebugger/OpRow";
import { TreeNode, type TreeShared } from "../components/debugger/StepDebugger/TreeNode";
import { FrameDetailPanel } from "../components/debugger/StepDebugger/FrameDetailPanel";
import type { ExecNode } from "../components/debugger/StepDebugger/executionScopes";
import type { CallFrame } from "../api/debugger";

// Real on-chain known setup these fixtures mirror:
//   WPLS 0xA1077a294dDE1B09bB078844df40758a5D0f9a27 — transfer(address,uint256)
//   selector 0xa9059cbb. See https://scan.pulsechain.com/address/0xA1077a294dDE1B09bB078844df40758a5D0f9a27
const WPLS = "0xA1077a294dDE1B09bB078844df40758a5D0f9a27";
const TRANSFER_SELECTOR = "0xa9059cbb";

function makeFrame(overrides: Partial<CallFrame> = {}): CallFrame {
  return {
    type: "CALL",
    from: "0x0000000000000000000000000000000000000001",
    to: WPLS,
    value: "0x0",
    gas: "0x100000",
    gasUsed: "0x5208",
    input: `${TRANSFER_SELECTOR}${"0".repeat(128)}`,
    ...overrides,
  };
}

function makeShared(overrides: Partial<TreeShared> = {}): TreeShared {
  return {
    onJumpTo: vi.fn(),
    signatureMap: {},
    contractNames: {},
    abiSelectors: {},
    ...overrides,
  };
}

describe("CallFrameRow", () => {
  it("renders a decoded function name from the contract ABI when present", () => {
    const frame = makeFrame();
    const node: ExecNode = { kind: "call", frame, startStep: 3, children: [] };
    const shared = makeShared({
      contractNames: { [WPLS.toLowerCase()]: "WPLS" },
      abiSelectors: { [WPLS.toLowerCase()]: { [TRANSFER_SELECTOR]: "transfer" } },
    });
    render(<CallFrameRow node={node} depth={0} shared={shared} />);
    expect(screen.getByText("WPLS")).toBeInTheDocument();
    expect(screen.getByText("transfer")).toBeInTheDocument();
    // Inline call-type tag.
    expect(screen.getByText("CALL")).toBeInTheDocument();
  });

  it("jumps via dispatchStep and selects on click", () => {
    const frame = makeFrame();
    const node: ExecNode = {
      kind: "call",
      frame,
      startStep: 3,
      children: [],
      dispatchStep: 9,
    };
    const onJumpTo = vi.fn();
    const onSelect = vi.fn();
    const onSelectKey = vi.fn();
    const shared = makeShared({ onJumpTo, onSelect, onSelectKey });
    render(<CallFrameRow node={node} depth={0} shared={shared} />);
    // 0xa9059cbb is a well-known selector → resolves to the "transfer" label.
    fireEvent.click(screen.getByText("transfer"));
    // dispatchStep present → jumps there with no hint.
    expect(onJumpTo).toHaveBeenCalledWith(9, undefined);
    expect(onSelect).toHaveBeenCalledWith(frame);
    expect(onSelectKey).toHaveBeenCalled();
  });

  it("falls back to receive() for empty calldata with value", () => {
    const frame = makeFrame({ input: "0x", value: "0xde0b6b3a7640000" }); // 1 PLS
    const node: ExecNode = { kind: "call", frame, startStep: 0, children: [] };
    render(<CallFrameRow node={node} depth={0} shared={makeShared()} />);
    expect(screen.getByText("receive")).toBeInTheDocument();
    // Value rendered in PLS.
    expect(screen.getByText(/1\.0000 PLS/)).toBeInTheDocument();
  });

  it("falls back to fallback() for empty calldata without value", () => {
    const frame = makeFrame({ input: "0x", value: "0x0" });
    const node: ExecNode = { kind: "call", frame, startStep: 0, children: [] };
    render(<CallFrameRow node={node} depth={0} shared={makeShared()} />);
    expect(screen.getByText("fallback")).toBeInTheDocument();
  });

  it("shows a REVERT badge and danger styling on error frames", () => {
    const frame = makeFrame({ error: "execution reverted" });
    const node: ExecNode = { kind: "call", frame, startStep: 0, children: [] };
    render(<CallFrameRow node={node} depth={0} shared={makeShared()} />);
    expect(screen.getByText("REVERT")).toBeInTheDocument();
  });

  it("toggles expansion and renders children via TreeNode", () => {
    const child: ExecNode = { kind: "op", step: 5, op: "SSTORE", pc: 42 };
    const node: ExecNode = {
      kind: "call",
      frame: makeFrame(),
      startStep: 0,
      children: [child],
    };
    const onToggleExpand = vi.fn();
    // depth 0 < DEFAULT_EXPAND_DEPTH (5) so it starts expanded — child visible.
    render(
      <CallFrameRow node={node} depth={0} shared={makeShared({ onToggleExpand })} />,
    );
    expect(screen.getByText("SSTORE")).toBeInTheDocument();
    // The chevron toggle button collapses it.
    const toggle = screen.getAllByRole("button")[0]!;
    fireEvent.click(toggle);
    expect(onToggleExpand).toHaveBeenCalled();
  });

  it("fires onExpand for the opcode-overlay button when hovered", () => {
    const frame = makeFrame();
    const node: ExecNode = { kind: "call", frame, startStep: 7, children: [] };
    const onExpand = vi.fn();
    render(<CallFrameRow node={node} depth={0} shared={makeShared({ onExpand })} />);
    // Hover reveals + enables the expand button.
    const row = screen.getByText("transfer").closest("div")!;
    fireEvent.mouseEnter(row);
    const expandBtn = screen
      .getAllByRole("button")
      .find((b) => b.getAttribute("tabindex") === "0")!;
    fireEvent.click(expandBtn);
    expect(onExpand).toHaveBeenCalledWith(frame, 7, expect.any(String));
  });
});

describe("ScopeRow", () => {
  it("renders the function name + line and jumps to entryStep on click", () => {
    const node: ExecNode = {
      kind: "fn",
      name: "_transferFrom",
      line: 120,
      startStep: 10,
      entryStep: 12,
      endStep: 30,
      children: [],
    };
    const onJumpTo = vi.fn();
    const onSelectKey = vi.fn();
    render(
      <ScopeRow
        node={node}
        depth={1}
        shared={makeShared({ onJumpTo, onSelectKey })}
      />,
    );
    expect(screen.getByText("_transferFrom")).toBeInTheDocument();
    expect(screen.getByText("L120")).toBeInTheDocument();
    fireEvent.click(screen.getByText("_transferFrom"));
    expect(onJumpTo).toHaveBeenCalledWith(12);
    expect(onSelectKey).toHaveBeenCalled();
  });

  it("renders expanded children and toggles via the chevron", () => {
    const node: ExecNode = {
      kind: "fn",
      name: "swapBack",
      line: 50,
      startStep: 5,
      entryStep: 6,
      endStep: 40,
      children: [{ kind: "op", step: 8, op: "SLOAD", pc: 12 }],
    };
    const onToggleExpand = vi.fn();
    // depth 0 < DEFAULT_EXPAND_DEPTH → starts expanded, child visible.
    render(
      <ScopeRow node={node} depth={0} shared={makeShared({ onToggleExpand })} />,
    );
    expect(screen.getByText("SLOAD")).toBeInTheDocument();
    // The chevron toggle is the first button.
    fireEvent.click(screen.getAllByRole("button")[0]!);
    expect(onToggleExpand).toHaveBeenCalledWith(expect.any(String), false);
  });

  it("omits the line label when line is 0", () => {
    const node: ExecNode = {
      kind: "fn",
      name: "internal",
      line: 0,
      startStep: 1,
      entryStep: 1,
      endStep: 2,
      children: [],
    };
    render(<ScopeRow node={node} depth={0} shared={makeShared()} />);
    expect(screen.queryByText(/^L\d/)).not.toBeInTheDocument();
  });
});

describe("LogRow", () => {
  it("splits a decoded event signature into name + params", () => {
    const node: ExecNode = {
      kind: "log",
      step: 8,
      name: "Transfer(address,address,uint256)",
      topicCount: 3,
    };
    const onJumpTo = vi.fn();
    render(<LogRow node={node} depth={0} shared={makeShared({ onJumpTo })} />);
    expect(screen.getByText("Transfer")).toBeInTheDocument();
    expect(screen.getByText("(address,address,uint256)")).toBeInTheDocument();
    expect(screen.getByText("LOG3")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Transfer"));
    expect(onJumpTo).toHaveBeenCalledWith(8);
  });

  it("shows the raw opcode name when no decode and singular topic copy", () => {
    const node: ExecNode = { kind: "log", step: 4, name: "LOG1", topicCount: 1 };
    render(<LogRow node={node} depth={2} shared={makeShared()} />);
    // Name "LOG1" plus the LOG{topicCount} badge "LOG1" — two matches expected.
    expect(screen.getAllByText("LOG1").length).toBe(2);
  });
});

describe("OpRow", () => {
  it("renders the opcode + pc and jumps on click", () => {
    const node: ExecNode = { kind: "op", step: 15, op: "SSTORE", pc: 256 };
    const onJumpTo = vi.fn();
    render(<OpRow node={node} depth={3} shared={makeShared({ onJumpTo })} />);
    expect(screen.getByText("SSTORE")).toBeInTheDocument();
    expect(screen.getByText("@ pc 256")).toBeInTheDocument();
    fireEvent.click(screen.getByText("SSTORE"));
    expect(onJumpTo).toHaveBeenCalledWith(15);
  });
});

describe("TreeNode dispatch", () => {
  it("renders the right row component per node kind", () => {
    const shared = makeShared();
    const { rerender } = render(
      <TreeNode
        node={{ kind: "op", step: 1, op: "MLOAD", pc: 0 }}
        depth={0}
        shared={shared}
      />,
    );
    expect(screen.getByText("MLOAD")).toBeInTheDocument();

    rerender(
      <TreeNode
        node={{ kind: "log", step: 2, name: "LOG0", topicCount: 0 }}
        depth={0}
        shared={shared}
      />,
    );
    // Name + badge both read "LOG0".
    expect(screen.getAllByText("LOG0").length).toBeGreaterThanOrEqual(1);

    rerender(
      <TreeNode
        node={{
          kind: "fn",
          name: "mul",
          line: 5,
          startStep: 0,
          entryStep: 0,
          endStep: 1,
          children: [],
        }}
        depth={0}
        shared={shared}
      />,
    );
    expect(screen.getByText("mul")).toBeInTheDocument();

    rerender(
      <TreeNode
        node={{ kind: "call", frame: makeFrame(), startStep: 0, children: [] }}
        depth={0}
        shared={shared}
      />,
    );
    expect(screen.getByText("CALL")).toBeInTheDocument();
  });
});

describe("FrameDetailPanel", () => {
  it("renders frame metadata including resolved signature and input/output", () => {
    const frame = makeFrame({
      output: "0x" + "1".repeat(64),
      value: "0xde0b6b3a7640000",
    });
    render(
      <FrameDetailPanel
        frame={frame}
        contractNames={{ [WPLS.toLowerCase()]: "WPLS" }}
        signatureMap={{
          [TRANSFER_SELECTOR]: [
            { textSignature: "transfer(address,uint256)", hexSignature: TRANSFER_SELECTOR },
          ] as never,
        }}
      />,
    );
    expect(screen.getByText("CALL")).toBeInTheDocument();
    expect(screen.getByText("transfer(address,uint256)")).toBeInTheDocument();
    expect(screen.getByText(WPLS, { exact: false })).toBeInTheDocument();
    // value shown because it's non-zero.
    expect(screen.getByText("value")).toBeInTheDocument();
  });

  it("shows an error row for reverted frames", () => {
    const frame = makeFrame({ error: "out of gas", value: "0x0" });
    render(
      <FrameDetailPanel frame={frame} contractNames={{}} signatureMap={{}} />,
    );
    expect(screen.getByText("out of gas")).toBeInTheDocument();
  });
});
