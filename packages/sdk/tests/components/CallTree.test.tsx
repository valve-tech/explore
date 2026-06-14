import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen, fireEvent, within } from "@testing-library/react";
import { CallTree } from "../../src/components/CallTree.js";
import { addrs, makeFrame } from "../fixtures.js";
import type { TraceFrame } from "../../src/types.js";

afterEach(() => cleanup());

function buildTree(): TraceFrame {
  return makeFrame({
    from: addrs.ALICE,
    to: addrs.CONTRACT,
    gasUsed: 100_000n,
    input: "0xdeadbeef",
    children: [
      makeFrame({
        type: "STATICCALL",
        from: addrs.CONTRACT,
        to: addrs.VAULT,
        gasUsed: 30_000n,
        input: "0x70a08231",
        depth: 1,
        children: [
          makeFrame({
            type: "CALL",
            from: addrs.VAULT,
            to: addrs.BOB,
            gasUsed: 10_000n,
            input: "0xa9059cbb",
            error: "execution reverted",
            revertReason: "ERC20: insufficient balance",
            depth: 2,
          }),
        ],
      }),
    ],
  });
}

describe("CallTree", () => {
  it("renders the header with call count and total gas", () => {
    render(<CallTree frame={buildTree()} />);
    expect(screen.getByText("Execution Call Tree")).toBeDefined();
    expect(screen.getByText(/3 calls/)).toBeDefined();
    expect(screen.getByText(/total gas/)).toBeDefined();
  });

  it("hides the header when hideHeader=true", () => {
    render(<CallTree frame={buildTree()} hideHeader />);
    expect(screen.queryByText("Execution Call Tree")).toBeNull();
  });

  it("hides the legend when hideLegend=true", () => {
    const { container } = render(<CallTree frame={buildTree()} hideLegend />);
    // The legend renders all 7 call-type chips; if hidden, "SELFDESTRUCT"
    // shouldn't appear (it's never in the test tree).
    expect(within(container).queryByText("SELFDESTRUCT")).toBeNull();
  });

  it("shows REVERT badge on reverted frames", () => {
    render(<CallTree frame={buildTree()} hideLegend />);
    expect(screen.getByText("REVERT")).toBeDefined();
  });

  it("shows (contract creation) for CREATE frames", () => {
    const tree = makeFrame({
      type: "CREATE",
      from: addrs.ALICE,
      to: null,
      gasUsed: 500_000n,
      input: "0x60806040",
    });
    render(<CallTree frame={tree} hideLegend />);
    expect(screen.getByText("(contract creation)")).toBeDefined();
  });

  it("calls onSelect with the clicked frame", () => {
    const onSelect = vi.fn();
    const tree = buildTree();
    render(<CallTree frame={tree} onSelect={onSelect} hideLegend />);
    // "0xdeadbeef" is the root's selector and appears nowhere else
    fireEvent.click(screen.getByText("0xdeadbeef"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]![0]).toBe(tree);
  });

  it("collapses children when the expand arrow is clicked", () => {
    const { container } = render(<CallTree frame={buildTree()} hideLegend />);
    expect(screen.queryByText("0x70a08231")).toBeDefined();
    // Expand toggles are the buttons without the "Show details" title. The
    // first one in document order is the root's expand caret.
    const expandButtons = Array.from(
      container.querySelectorAll("button"),
    ).filter((b) => b.getAttribute("title") !== "Show details");
    fireEvent.click(expandButtons[0]!);
    expect(screen.queryByText("0x70a08231")).toBeNull();
  });

  it("respects defaultExpandedDepth=0 (collapsed root)", () => {
    render(
      <CallTree frame={buildTree()} defaultExpandedDepth={0} hideLegend />,
    );
    // STATICCALL child should not be in the DOM since root is collapsed
    expect(screen.queryByText("STATICCALL")).toBeNull();
  });

  it("respects defaultExpandedDepth=1 (only root expanded)", () => {
    render(
      <CallTree frame={buildTree()} defaultExpandedDepth={1} hideLegend />,
    );
    // STATICCALL should be visible but its child (CALL at depth 2) should not
    expect(screen.getByText("STATICCALL")).toBeDefined();
    // Only the root-level CALL appears; the grandchild CALL is collapsed
    expect(screen.getAllByText("CALL")).toHaveLength(1);
  });

  it("toggles detail panel when ⋯ is clicked", () => {
    render(<CallTree frame={buildTree()} />);
    expect(screen.queryByText("Gas Used:")).toBeNull();
    const detailButtons = screen.getAllByTitle("Show details");
    fireEvent.click(detailButtons[0]!);
    // Detail panel renders a "From:" label that doesn't appear elsewhere
    expect(screen.getAllByText("From:").length).toBeGreaterThan(0);
  });

  it("applies className and classNames.root to the root element", () => {
    const { container } = render(
      <CallTree
        frame={buildTree()}
        className="my-tree"
        classNames={{ root: "extra-class" }}
      />,
    );
    const root = container.firstChild as HTMLElement;
    expect(root.className).toContain("my-tree");
    expect(root.className).toContain("extra-class");
  });

  it("applies inline style prop to the root", () => {
    const { container } = render(
      <CallTree frame={buildTree()} style={{ marginTop: 99 }} />,
    );
    const root = container.firstChild as HTMLElement;
    expect(root.style.marginTop).toBe("99px");
  });

  it("uses functionName from enriched TraceFrame when available", () => {
    const tree = makeFrame({
      from: addrs.ALICE,
      to: addrs.CONTRACT,
      functionName: "transfer(address,uint256)",
      input: "0xa9059cbb",
    });
    render(<CallTree frame={tree} hideLegend />);
    expect(screen.getByText("transfer(address,uint256)")).toBeDefined();
  });

  it("renders value chip when frame.value > 0", () => {
    const tree = makeFrame({
      from: addrs.ALICE,
      to: addrs.CONTRACT,
      value: 5n * 10n ** 18n, // 5 PLS
    });
    render(<CallTree frame={tree} hideLegend />);
    expect(screen.getByText("5 PLS")).toBeDefined();
  });

  it("uses custom valueSymbol", () => {
    const tree = makeFrame({
      from: addrs.ALICE,
      to: addrs.CONTRACT,
      value: 2n * 10n ** 18n,
    });
    render(<CallTree frame={tree} valueSymbol="ETH" hideLegend />);
    expect(screen.getByText("2 ETH")).toBeDefined();
  });

  it("renders leaf-node dot indicator (no children)", () => {
    const leaf = makeFrame({
      from: addrs.ALICE,
      to: addrs.CONTRACT,
      gasUsed: 21_000n,
    });
    const { container } = render(<CallTree frame={leaf} hideLegend />);
    // No expand toggle present — the only button is the "Show details" toggle.
    const buttons = Array.from(container.querySelectorAll("button"));
    expect(buttons).toHaveLength(1);
    expect(buttons[0]!.getAttribute("title")).toBe("Show details");
  });

  it("shows revert reason in detail panel for reverted frames", () => {
    render(<CallTree frame={buildTree()} hideLegend />);
    const detailButtons = screen.getAllByTitle("Show details");
    // Last detail button is the reverted grandchild
    fireEvent.click(detailButtons[detailButtons.length - 1]!);
    expect(
      screen.getByText("ERC20: insufficient balance"),
    ).toBeDefined();
  });

  it("renders the legend when not hidden (sanity check for hideLegend tests)", () => {
    render(<CallTree frame={buildTree()} />);
    // SELFDESTRUCT never appears as a frame in our tree — only via the legend
    expect(screen.getByText("SELFDESTRUCT")).toBeDefined();
  });

  it("shows REVERT badge when only `error` is set (no revertReason)", () => {
    const tree = makeFrame({
      from: addrs.ALICE,
      to: addrs.CONTRACT,
      error: "out of gas",
      // no revertReason
    });
    render(<CallTree frame={tree} hideLegend />);
    expect(screen.getByText("REVERT")).toBeDefined();
  });

  it("shows Error row (not Revert row) in detail panel when only error is set", () => {
    const tree = makeFrame({
      from: addrs.ALICE,
      to: addrs.CONTRACT,
      error: "out of gas",
    });
    render(<CallTree frame={tree} hideLegend />);
    fireEvent.click(screen.getByTitle("Show details"));
    expect(screen.getByText("Error:")).toBeDefined();
    expect(screen.getByText("out of gas")).toBeDefined();
    expect(screen.queryByText("Revert:")).toBeNull();
  });

  it("shows '(contract creation)' in detail panel when to is null", () => {
    const tree = makeFrame({
      type: "CREATE",
      from: addrs.ALICE,
      to: null,
      input: "0x60806040",
    });
    render(<CallTree frame={tree} hideLegend />);
    fireEvent.click(screen.getByTitle("Show details"));
    // Detail panel renders "To:" label with the placeholder text as value
    const matches = screen.getAllByText("(contract creation)");
    // Two instances: the inline cell + the detail panel row
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it("shows Value row in detail panel when value > 0n", () => {
    const tree = makeFrame({
      from: addrs.ALICE,
      to: addrs.CONTRACT,
      value: 7n * 10n ** 18n,
    });
    render(<CallTree frame={tree} hideLegend />);
    fireEvent.click(screen.getByTitle("Show details"));
    expect(screen.getByText("Value:")).toBeDefined();
  });

  it("shows Output DataBlock in detail panel when output is non-empty", () => {
    const tree = makeFrame({
      from: addrs.ALICE,
      to: addrs.CONTRACT,
      output: "0xdeadbeef",
    });
    render(<CallTree frame={tree} hideLegend />);
    fireEvent.click(screen.getByTitle("Show details"));
    expect(screen.getByText("Output:")).toBeDefined();
  });

  it("renders a CREATE child without throwing (covers child key fallback)", () => {
    const tree = makeFrame({
      from: addrs.ALICE,
      to: addrs.CONTRACT,
      children: [
        makeFrame({
          type: "CREATE",
          from: addrs.CONTRACT,
          to: null,
          depth: 1,
          input: "0x60806040",
        }),
      ],
    });
    expect(() =>
      render(<CallTree frame={tree} hideLegend />),
    ).not.toThrow();
  });

  it("falls back to neutral colors when type is outside the known set", () => {
    // Bypass the type system to simulate a frame from an unknown source
    // (e.g. a future EVM opcode not yet in our CallType union). The fallback
    // ensures the renderer doesn't crash on novel inputs.
    const tree = makeFrame({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      type: "FUTURE_OPCODE" as any,
      from: addrs.ALICE,
      to: addrs.CONTRACT,
    });
    expect(() =>
      render(<CallTree frame={tree} hideLegend />),
    ).not.toThrow();
    expect(screen.getByText("FUTURE_OPCODE")).toBeDefined();
  });

  it("renders the built-in expand and arrow icons by default", () => {
    const { container } = render(<CallTree frame={buildTree()} hideLegend />);
    // Default icons are inline SVGs (no glyph text). At least the root row's
    // expand caret + from→to arrow render as <svg>.
    expect(container.querySelectorAll("svg").length).toBeGreaterThan(0);
  });

  it("renders a custom expandIcon override", () => {
    render(
      <CallTree
        frame={buildTree()}
        hideLegend
        expandIcon={<span data-testid="custom-expand">EXP</span>}
      />,
    );
    // Two expandable rows (root + STATICCALL) → two carets.
    expect(screen.getAllByTestId("custom-expand").length).toBe(2);
  });

  it("renders a custom arrowIcon override", () => {
    render(
      <CallTree
        frame={buildTree()}
        hideLegend
        arrowIcon={<span data-testid="custom-arrow">ARR</span>}
      />,
    );
    // One arrow per rendered frame (3 frames in the tree).
    expect(screen.getAllByTestId("custom-arrow").length).toBe(3);
  });
});
