import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { FrameDetailPanel } from "../../src/components/FrameDetailPanel.js";
import { addrs, makeFrame } from "../fixtures.js";
import type { TraceFrame } from "../../src/types.js";
import type { Hex } from "viem";

afterEach(() => cleanup());

describe("FrameDetailPanel", () => {
  it("renders the type badge and from→to addresses", () => {
    render(<FrameDetailPanel frame={makeFrame({ type: "CALL" })} />);
    expect(screen.getByText("CALL")).toBeDefined();
    // truncated addrs
    expect(screen.getAllByText(/0x.*\.\.\..*[a-f0-9]+/i).length).toBeGreaterThan(0);
  });

  it("renders '(create)' label when frame.to is null", () => {
    render(<FrameDetailPanel frame={makeFrame({ type: "CREATE", to: null })} />);
    expect(screen.getByText("(create)")).toBeDefined();
  });

  it("hides header when hideHeader=true", () => {
    const { container } = render(
      <FrameDetailPanel frame={makeFrame({ type: "CALL" })} hideHeader />,
    );
    expect(container.querySelector(".tx-header")).toBeNull();
    // Type badge is in the header so it shouldn't be there
    expect(screen.queryByText("CALL")).toBeNull();
  });

  it("renders error banner with revert reason when present", () => {
    render(
      <FrameDetailPanel
        frame={makeFrame({
          error: "execution reverted",
          revertReason: "insufficient balance",
        })}
      />,
    );
    expect(screen.getByText(/execution reverted/)).toBeDefined();
    expect(screen.getByText(/insufficient balance/)).toBeDefined();
  });

  it("renders error banner without reason when revertReason missing", () => {
    render(
      <FrameDetailPanel
        frame={makeFrame({ error: "out of gas" })}
      />,
    );
    expect(screen.getByText("out of gas")).toBeDefined();
  });

  it("does NOT render error banner when frame is successful", () => {
    const { container } = render(
      <FrameDetailPanel frame={makeFrame({})} classNames={{ errorBanner: "tx-err" }} />,
    );
    expect(container.querySelector(".tx-err")).toBeNull();
  });

  it("renders gas, depth, children count in the meta grid", () => {
    render(
      <FrameDetailPanel
        frame={makeFrame({
          gas: 100_000n,
          gasUsed: 50_000n,
          depth: 3,
          children: [makeFrame({}), makeFrame({})],
        })}
      />,
    );
    expect(screen.getByText("gas used")).toBeDefined();
    expect(screen.getByText("depth")).toBeDefined();
    expect(screen.getByText("3")).toBeDefined();
    expect(screen.getByText("children")).toBeDefined();
    expect(screen.getByText("2")).toBeDefined();
  });

  it("renders value field with default symbol PLS when value > 0", () => {
    render(
      <FrameDetailPanel
        frame={makeFrame({ value: 1_000_000_000_000_000_000n })}
      />,
    );
    expect(screen.getByText("value")).toBeDefined();
    expect(screen.getByText(/PLS/)).toBeDefined();
  });

  it("does NOT render value field when value === 0", () => {
    render(<FrameDetailPanel frame={makeFrame({ value: 0n })} />);
    expect(screen.queryByText("value")).toBeNull();
  });

  it("uses custom valueSymbol", () => {
    render(
      <FrameDetailPanel
        frame={makeFrame({ value: 1n })}
        valueSymbol="WEI"
      />,
    );
    expect(screen.getByText(/WEI/)).toBeDefined();
  });

  it("renders the function selector when input has >= 10 hex chars", () => {
    render(
      <FrameDetailPanel
        frame={makeFrame({ input: "0xdeadbeef00000000" as Hex })}
      />,
    );
    expect(screen.getByText("selector")).toBeDefined();
    expect(screen.getByText("0xdeadbeef")).toBeDefined();
  });

  it("does NOT render the selector when input is short", () => {
    render(<FrameDetailPanel frame={makeFrame({ input: "0x" as Hex })} />);
    expect(screen.queryByText("selector")).toBeNull();
  });

  it("renders the input section even for short input", () => {
    render(<FrameDetailPanel frame={makeFrame({ input: "0x42" as Hex })} />);
    expect(screen.getByText("Input")).toBeDefined();
    expect(screen.getByText("0x42")).toBeDefined();
  });

  it("renders truncated input when very long", () => {
    const long = ("0x" + "ab".repeat(100)) as Hex;
    render(<FrameDetailPanel frame={makeFrame({ input: long })} />);
    // Truncated form contains the ellipsis
    expect(screen.getByText(/…/)).toBeDefined();
  });

  it("does NOT render the output section when output is '0x'", () => {
    render(<FrameDetailPanel frame={makeFrame({ output: "0x" as Hex })} />);
    expect(screen.queryByText("Output")).toBeNull();
  });

  it("renders the output section when output is meaningful", () => {
    render(
      <FrameDetailPanel
        frame={makeFrame({ output: "0x000000000000000000000000000000000000000000000000000000000000002a" as Hex })}
      />,
    );
    expect(screen.getByText("Output")).toBeDefined();
  });

  it("renders the function name when set", () => {
    render(
      <FrameDetailPanel
        frame={makeFrame({ functionName: "transfer(address,uint256)" })}
      />,
    );
    expect(screen.getByText("Function")).toBeDefined();
    expect(screen.getByText("transfer(address,uint256)")).toBeDefined();
  });

  it("does NOT render the Function section when functionName absent", () => {
    render(<FrameDetailPanel frame={makeFrame({})} />);
    expect(screen.queryByText("Function")).toBeNull();
  });

  it("renders decoded input params with name + type + value", () => {
    const frame: TraceFrame = {
      ...makeFrame({}),
      decodedInput: [
        { name: "recipient", type: "address", value: addrs.BOB },
        { name: "amount", type: "uint256", value: 42n },
      ],
    };
    const { container } = render(<FrameDetailPanel frame={frame} />);
    const text = container.textContent ?? "";
    expect(text).toContain("recipient");
    expect(text).toContain("amount");
    expect(text).toContain("address");
    expect(text).toContain("uint256");
    expect(text).toContain("42");
  });

  it("formats decoded values: bigint, string, null, undefined, object, unserializable", () => {
    const circular: { self?: unknown } = {};
    circular.self = circular;
    const frame: TraceFrame = {
      ...makeFrame({}),
      decodedInput: [
        { name: "a", type: "uint256", value: 999n },
        { name: "b", type: "string", value: "hello" },
        { name: "c", type: "address", value: null },
        { name: "d", type: "bool", value: undefined },
        { name: "e", type: "tuple", value: { x: 1n, y: 2 } },
        { name: "f", type: "circular", value: circular },
      ],
    };
    const { container } = render(<FrameDetailPanel frame={frame} />);
    const text = container.textContent ?? "";
    expect(text).toContain("999");
    expect(text).toContain("hello");
    expect(text).toContain("null");
    expect(text).toContain("undefined");
    expect(text).toContain('"x":"1"');
    // Circular value should hit the catch branch and fall back to String()
    expect(text).toContain("[object Object]");
  });

  it("renders decoded output when present", () => {
    const frame: TraceFrame = {
      ...makeFrame({ output: "0x42" as Hex }),
      decodedOutput: [{ name: "result", type: "uint256", value: 7n }],
    };
    render(<FrameDetailPanel frame={frame} />);
    expect(screen.getByText(/result/)).toBeDefined();
    expect(screen.getByText("7")).toBeDefined();
  });

  it("does NOT render decoded params when array is empty", () => {
    const frame: TraceFrame = {
      ...makeFrame({}),
      decodedInput: [],
    };
    const { container } = render(
      <FrameDetailPanel frame={frame} classNames={{ decodedList: "tx-decoded" }} />,
    );
    expect(container.querySelector(".tx-decoded")).toBeNull();
  });

  it("applies all classNames slots", () => {
    const frame: TraceFrame = {
      ...makeFrame({
        value: 1n,
        input: "0xdeadbeef00000000" as Hex,
        output: "0x42" as Hex,
        error: "reverted",
      }),
      decodedInput: [{ name: "x", type: "uint256", value: 1n }],
      decodedOutput: [{ name: "y", type: "uint256", value: 1n }],
    };
    const { container } = render(
      <FrameDetailPanel
        frame={frame}
        classNames={{
          root: "tx-root",
          header: "tx-header",
          typeBadge: "tx-type",
          fromAddress: "tx-from",
          toAddress: "tx-to",
          errorBanner: "tx-err",
          metaGrid: "tx-meta",
          metaCell: "tx-cell",
          metaLabel: "tx-mlabel",
          metaValue: "tx-mvalue",
          sectionTitle: "tx-sec",
          rawHex: "tx-hex",
          decodedList: "tx-dec",
          decodedRow: "tx-decrow",
        }}
      />,
    );
    for (const c of [
      "tx-root",
      "tx-header",
      "tx-type",
      "tx-from",
      "tx-to",
      "tx-err",
      "tx-meta",
      "tx-cell",
      "tx-mlabel",
      "tx-mvalue",
      "tx-sec",
      "tx-hex",
      "tx-dec",
      "tx-decrow",
    ]) {
      expect(container.querySelector(`.${c}`)).not.toBeNull();
    }
  });

  it("applies className and style to root", () => {
    const { container } = render(
      <FrameDetailPanel
        frame={makeFrame({})}
        className="outer-class"
        style={{ marginTop: "42px" }}
      />,
    );
    const root = container.firstChild as HTMLElement;
    expect(root.className).toContain("outer-class");
    expect(root.style.marginTop).toBe("42px");
  });

  it("returns empty className when neither classNames.root nor className supplied", () => {
    const { container } = render(<FrameDetailPanel frame={makeFrame({})} />);
    const root = container.firstChild as HTMLElement;
    expect(root.className).toBe("");
  });

  it("renders the built-in arrow icon between addresses by default", () => {
    const { container } = render(
      <FrameDetailPanel frame={makeFrame({ type: "CALL" })} />,
    );
    // Default header arrow is an inline SVG.
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("renders a custom arrowIcon override in the header", () => {
    render(
      <FrameDetailPanel
        frame={makeFrame({ type: "CALL" })}
        arrowIcon={<span data-testid="custom-arrow">to</span>}
      />,
    );
    expect(screen.getByTestId("custom-arrow")).toBeDefined();
  });

  it("does not render the header arrow when hideHeader=true", () => {
    render(
      <FrameDetailPanel
        frame={makeFrame({ type: "CALL" })}
        hideHeader
        arrowIcon={<span data-testid="custom-arrow">to</span>}
      />,
    );
    expect(screen.queryByTestId("custom-arrow")).toBeNull();
  });
});
