import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { RevertExplainer } from "../../src/templates/RevertExplainer.js";
import { addrs, makeFrame } from "../fixtures.js";
import type { Hex } from "viem";

afterEach(() => cleanup());

describe("RevertExplainer", () => {
  it("renders success state when no frame reverted", () => {
    render(<RevertExplainer frame={makeFrame({ type: "CALL" })} />);
    expect(screen.getByText(/Transaction completed without revert/)).toBeDefined();
  });

  it("uses a custom successMessage when provided", () => {
    render(
      <RevertExplainer
        frame={makeFrame({ type: "CALL" })}
        successMessage="All good — no revert."
      />,
    );
    expect(screen.getByText(/All good — no revert/)).toBeDefined();
  });

  it("surfaces the revertReason from the innermost reverter", () => {
    const tree = makeFrame({
      type: "CALL",
      children: [
        makeFrame({
          type: "CALL",
          depth: 1,
          error: "execution reverted",
          revertReason: "outer reason",
          children: [
            makeFrame({
              type: "STATICCALL",
              from: addrs.CONTRACT,
              to: addrs.VAULT,
              depth: 2,
              error: "execution reverted",
              revertReason: "ERC20: insufficient balance",
            }),
          ],
        }),
      ],
    });
    render(<RevertExplainer frame={tree} />);
    expect(screen.getByText("Reverted")).toBeDefined();
    expect(screen.getByText("ERC20: insufficient balance")).toBeDefined();
    // Outer reason should NOT appear in the banner; the innermost wins.
    expect(screen.queryByText("outer reason")).toBeNull();
  });

  it("falls back to error string when revertReason is missing", () => {
    const tree = makeFrame({
      type: "CALL",
      error: "out of gas",
    });
    render(<RevertExplainer frame={tree} />);
    expect(screen.getByText("out of gas")).toBeDefined();
  });


  it("renders the breadcrumb chain from root to the reverter", () => {
    const tree = makeFrame({
      type: "CALL",
      to: addrs.CONTRACT,
      input: "0xa9059cbb00000000" as Hex,
      children: [
        makeFrame({
          type: "DELEGATECALL",
          from: addrs.CONTRACT,
          to: addrs.VAULT,
          depth: 1,
          error: "execution reverted",
          revertReason: "fail",
        }),
      ],
    });
    const { container } = render(
      <RevertExplainer frame={tree} classNames={{ chainArrow: "tx-arrow" }} />,
    );
    // Both CALL and DELEGATECALL chips appear
    expect(screen.getByText("CALL")).toBeDefined();
    expect(screen.getByText("DELEGATECALL")).toBeDefined();
    // An arrow icon appears between the two steps
    expect(container.querySelectorAll(".tx-arrow")).toHaveLength(1);
  });

  it("renders chain with no arrows for a single-frame revert", () => {
    const { container } = render(
      <RevertExplainer
        frame={makeFrame({ type: "CALL", error: "reverted" })}
        classNames={{ chainArrow: "tx-arrow" }}
      />,
    );
    // Only one chain step, so no arrow between steps
    expect(container.querySelectorAll(".tx-arrow")).toHaveLength(0);
  });

  it("shows function selector on a chain step when present", () => {
    const tree = makeFrame({
      type: "CALL",
      input: "0xdeadbeef00000000" as Hex,
      error: "reverted",
    });
    render(<RevertExplainer frame={tree} />);
    expect(screen.getByText("0xdeadbeef")).toBeDefined();
  });

  it("renders '(create)' for create frames in the chain", () => {
    const tree = makeFrame({
      type: "CREATE",
      to: null,
      error: "init code reverted",
    });
    render(<RevertExplainer frame={tree} />);
    expect(screen.getByText("(create)")).toBeDefined();
  });

  it("applies the revertingStep class to the final chain step", () => {
    const tree = makeFrame({
      type: "CALL",
      children: [
        makeFrame({
          type: "STATICCALL",
          depth: 1,
          error: "reverted",
        }),
      ],
    });
    const { container } = render(
      <RevertExplainer
        frame={tree}
        classNames={{ chainStep: "tx-step", revertingStep: "tx-final" }}
      />,
    );
    expect(container.querySelectorAll(".tx-step").length).toBe(2);
    expect(container.querySelectorAll(".tx-final").length).toBe(1);
  });

  it("applies all classNames slots", () => {
    const tree = makeFrame({
      type: "CALL",
      error: "reverted",
      revertReason: "boom",
    });
    const { container } = render(
      <RevertExplainer
        frame={tree}
        classNames={{
          root: "tx-root",
          reasonBanner: "tx-banner",
          chain: "tx-chain",
          chainStep: "tx-step",
          revertingStep: "tx-final",
        }}
      />,
    );
    for (const c of ["tx-root", "tx-banner", "tx-chain", "tx-step", "tx-final"]) {
      expect(container.querySelector(`.${c}`)).not.toBeNull();
    }
  });

  it("applies successBody class in non-reverted case", () => {
    const { container } = render(
      <RevertExplainer
        frame={makeFrame({ type: "CALL" })}
        classNames={{ successBody: "tx-success" }}
      />,
    );
    expect(container.querySelector(".tx-success")).not.toBeNull();
  });

  it("applies className and style to root", () => {
    const { container } = render(
      <RevertExplainer
        frame={makeFrame({ type: "CALL" })}
        className="outer-class"
        style={{ marginTop: "42px" }}
      />,
    );
    const root = container.firstChild as HTMLElement;
    expect(root.className).toContain("outer-class");
    expect(root.style.marginTop).toBe("42px");
  });

  it("returns empty className when no slot or override supplied", () => {
    const { container } = render(<RevertExplainer frame={makeFrame({})} />);
    expect((container.firstChild as HTMLElement).className).toBe("");
  });

  it("renders the built-in check icon by default in the success state", () => {
    const { container } = render(
      <RevertExplainer frame={makeFrame({ type: "CALL" })} />,
    );
    // Default success icon is an inline SVG.
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("renders a custom successIcon override", () => {
    render(
      <RevertExplainer
        frame={makeFrame({ type: "CALL" })}
        successIcon={<span data-testid="custom-check">ok</span>}
      />,
    );
    expect(screen.getByTestId("custom-check")).toBeDefined();
  });

  it("renders the built-in arrow icon by default in the chain", () => {
    const tree = makeFrame({
      type: "CALL",
      children: [
        makeFrame({ type: "STATICCALL", depth: 1, error: "reverted" }),
      ],
    });
    const { container } = render(<RevertExplainer frame={tree} />);
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("renders a custom arrowIcon override in the chain", () => {
    const tree = makeFrame({
      type: "CALL",
      children: [
        makeFrame({ type: "STATICCALL", depth: 1, error: "reverted" }),
      ],
    });
    render(
      <RevertExplainer
        frame={tree}
        arrowIcon={<span data-testid="custom-arrow">to</span>}
      />,
    );
    // Two chain steps → one arrow between them.
    expect(screen.getAllByTestId("custom-arrow").length).toBe(1);
  });
});
