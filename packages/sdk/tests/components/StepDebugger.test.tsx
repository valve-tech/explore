import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Hex } from "viem";
import { StepDebugger } from "../../src/components/StepDebugger.js";
import type { OpcodeStep } from "../../src/types.js";

afterEach(() => cleanup());

function step(op: string, overrides: Partial<OpcodeStep> = {}): OpcodeStep {
  return {
    pc: 0,
    op,
    gas: 100,
    gasCost: 3,
    depth: 1,
    stack: [],
    memory: [],
    storage: {},
    ...overrides,
  };
}

const RICH_STEPS: OpcodeStep[] = [
  step("PUSH1", { pc: 0, stack: ["0x1"] as Hex[] }),
  step("SSTORE", {
    pc: 2,
    gasCost: 22100,
    stack: ["0x42", "0x1"] as Hex[],
    storage: { ["0x1" as Hex]: "0x42" as Hex },
  }),
  step("PUSH1", { pc: 4 }),
  step("CALL", {
    pc: 6,
    stack: Array(10).fill("0xff") as Hex[],
    memory: Array(20).fill("0xaa") as Hex[],
  }),
  step("LOG2", { pc: 8 }),
];

describe("StepDebugger — empty state", () => {
  it("renders the empty placeholder when no steps", () => {
    render(<StepDebugger steps={[]} />);
    expect(screen.getByText(/No opcode steps to debug/)).toBeDefined();
    expect(screen.getByText("0 / 0")).toBeDefined();
  });

  it("disables all controls when empty", () => {
    render(<StepDebugger steps={[]} />);
    const buttons = screen.getAllByRole("button");
    for (const b of buttons) expect((b as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("StepDebugger — populated", () => {
  it("renders the header with current PC, OP, Gas, Depth", () => {
    render(<StepDebugger steps={RICH_STEPS} />);
    expect(screen.getByText("1 / 5")).toBeDefined();
    expect(screen.getByText("PC")).toBeDefined();
    expect(screen.getByText("OP")).toBeDefined();
    expect(screen.getByText("PUSH1")).toBeDefined();
  });

  it("starts at initialIndex when provided", () => {
    render(<StepDebugger steps={RICH_STEPS} initialIndex={3} />);
    expect(screen.getByText("4 / 5")).toBeDefined();
    expect(screen.getByText("CALL")).toBeDefined();
  });

  it("shows the empty-data hint when stack/memory/storage are all empty", () => {
    render(<StepDebugger steps={[step("PUSH1")]} />);
    expect(screen.getByText(/No stack, memory, or storage data/)).toBeDefined();
  });

  it("renders stack, memory, and storage panels when present", () => {
    render(<StepDebugger steps={RICH_STEPS} initialIndex={1} />);
    expect(screen.getByText(/Stack \(2 items\)/)).toBeDefined();
    expect(screen.getByText(/Storage/)).toBeDefined();
  });

  it("renders 'more words' indicator when memory exceeds 16 words", () => {
    const big: OpcodeStep[] = [
      step("PUSH1", { memory: Array(20).fill("0xaa") as Hex[] }),
    ];
    render(<StepDebugger steps={big} />);
    expect(screen.getByText(/4 more words/)).toBeDefined();
  });

  it("flags expensive opcodes with the highlight dot", () => {
    render(<StepDebugger steps={[step("SSTORE", { gasCost: 22100 })]} />);
    expect(screen.getAllByLabelText("Expensive operation").length).toBeGreaterThan(0);
  });
});

describe("StepDebugger — button navigation", () => {
  it("advances on Next and retreats on Prev", () => {
    render(<StepDebugger steps={RICH_STEPS} />);
    fireEvent.click(screen.getByTitle(/Next step/));
    expect(screen.getByText("2 / 5")).toBeDefined();
    fireEvent.click(screen.getByTitle(/Previous step/));
    expect(screen.getByText("1 / 5")).toBeDefined();
  });

  it("jumps to start and end", () => {
    render(<StepDebugger steps={RICH_STEPS} initialIndex={2} />);
    fireEvent.click(screen.getByTitle(/Jump to end/));
    expect(screen.getByText("5 / 5")).toBeDefined();
    fireEvent.click(screen.getByTitle(/Jump to start/));
    expect(screen.getByText("1 / 5")).toBeDefined();
  });

  it("seeks to next CALL / SSTORE / LOG via the buttons", () => {
    render(<StepDebugger steps={RICH_STEPS} />);
    fireEvent.click(screen.getByTitle(/Next CALL-family/));
    expect(screen.getByText("4 / 5")).toBeDefined(); // index 3 = CALL

    fireEvent.click(screen.getByTitle(/Jump to start/));
    fireEvent.click(screen.getByTitle(/Next storage-touching/));
    expect(screen.getByText("2 / 5")).toBeDefined(); // index 1 = SSTORE

    fireEvent.click(screen.getByTitle(/Next LOG/));
    expect(screen.getByText("5 / 5")).toBeDefined(); // index 4 = LOG2
  });

  it("disables Prev at start and Next at end", () => {
    render(<StepDebugger steps={RICH_STEPS} />);
    const prev = screen.getByTitle(/Previous step/) as HTMLButtonElement;
    expect(prev.disabled).toBe(true);
    fireEvent.click(screen.getByTitle(/Jump to end/));
    const next = screen.getByTitle(/Next step/) as HTMLButtonElement;
    expect(next.disabled).toBe(true);
  });
});

describe("StepDebugger — keyboard", () => {
  it("ArrowRight / ArrowLeft step forward/back", () => {
    const { container } = render(<StepDebugger steps={RICH_STEPS} />);
    const root = container.firstChild as HTMLElement;
    fireEvent.keyDown(root, { key: "ArrowRight" });
    expect(screen.getByText("2 / 5")).toBeDefined();
    fireEvent.keyDown(root, { key: "ArrowLeft" });
    expect(screen.getByText("1 / 5")).toBeDefined();
  });

  it("Home / End jump to ends", () => {
    const { container } = render(
      <StepDebugger steps={RICH_STEPS} initialIndex={2} />,
    );
    const root = container.firstChild as HTMLElement;
    fireEvent.keyDown(root, { key: "End" });
    expect(screen.getByText("5 / 5")).toBeDefined();
    fireEvent.keyDown(root, { key: "Home" });
    expect(screen.getByText("1 / 5")).toBeDefined();
  });

  it("C / S / L seek to call/storage/log", () => {
    const { container } = render(<StepDebugger steps={RICH_STEPS} />);
    const root = container.firstChild as HTMLElement;
    fireEvent.keyDown(root, { key: "C" });
    expect(screen.getByText("4 / 5")).toBeDefined();
    fireEvent.keyDown(root, { key: "Home" });
    fireEvent.keyDown(root, { key: "S" });
    expect(screen.getByText("2 / 5")).toBeDefined();
    fireEvent.keyDown(root, { key: "L" });
    expect(screen.getByText("5 / 5")).toBeDefined();
  });

  it("accepts both upper and lowercase shortcut keys", () => {
    const { container } = render(<StepDebugger steps={RICH_STEPS} />);
    const root = container.firstChild as HTMLElement;
    fireEvent.keyDown(root, { key: "c" });
    expect(screen.getByText("4 / 5")).toBeDefined();
    fireEvent.keyDown(root, { key: "Home" });
    fireEvent.keyDown(root, { key: "s" });
    expect(screen.getByText("2 / 5")).toBeDefined();
    fireEvent.keyDown(root, { key: "Home" });
    fireEvent.keyDown(root, { key: "l" });
    expect(screen.getByText("5 / 5")).toBeDefined();
  });

  it("ignores unrelated keys", () => {
    const { container } = render(<StepDebugger steps={RICH_STEPS} />);
    const root = container.firstChild as HTMLElement;
    fireEvent.keyDown(root, { key: "x" });
    expect(screen.getByText("1 / 5")).toBeDefined();
  });

  it("does not respond to keys when keyboard=false", () => {
    const { container } = render(
      <StepDebugger steps={RICH_STEPS} keyboard={false} />,
    );
    const root = container.firstChild as HTMLElement;
    expect(root.tabIndex).toBe(-1);
    fireEvent.keyDown(root, { key: "ArrowRight" });
    expect(screen.getByText("1 / 5")).toBeDefined();
  });
});

describe("StepDebugger — onStepChange", () => {
  it("fires onStepChange with the initial step on mount", () => {
    const onStepChange = vi.fn();
    render(
      <StepDebugger
        steps={RICH_STEPS}
        initialIndex={2}
        onStepChange={onStepChange}
      />,
    );
    expect(onStepChange).toHaveBeenCalledWith(2, RICH_STEPS[2]);
  });

  it("fires onStepChange after navigation", () => {
    const onStepChange = vi.fn();
    render(<StepDebugger steps={RICH_STEPS} onStepChange={onStepChange} />);
    onStepChange.mockClear();
    fireEvent.click(screen.getByTitle(/Next step/));
    expect(onStepChange).toHaveBeenCalledWith(1, RICH_STEPS[1]);
  });

  it("does not throw when onStepChange is undefined", () => {
    render(<StepDebugger steps={RICH_STEPS} />);
    fireEvent.click(screen.getByTitle(/Next step/));
    expect(screen.getByText("2 / 5")).toBeDefined();
  });
});

describe("StepDebugger — slot theming", () => {
  it("composes className + classNames.root on the outer container", () => {
    const { container } = render(
      <StepDebugger
        steps={RICH_STEPS}
        className="outer"
        classNames={{ root: "themed" }}
      />,
    );
    const root = container.firstChild as HTMLElement;
    expect(root.className).toContain("outer");
    expect(root.className).toContain("themed");
  });

  it("passes through classNames.button to all control buttons", () => {
    render(
      <StepDebugger
        steps={RICH_STEPS}
        classNames={{ button: "btn-themed" }}
      />,
    );
    for (const b of screen.getAllByRole("button")) {
      expect(b.className).toContain("btn-themed");
    }
  });
});

describe("StepDebugger — nav icons", () => {
  it("renders the built-in prev/next chevron icons by default", () => {
    const { container } = render(<StepDebugger steps={RICH_STEPS} />);
    // The Prev/Next buttons each carry an inline-SVG chevron by default.
    const prev = screen.getByTitle(/Previous step/);
    const next = screen.getByTitle(/Next step/);
    expect(prev.querySelector("svg")).not.toBeNull();
    expect(next.querySelector("svg")).not.toBeNull();
    // Sanity: at least these two svgs are present in the control row.
    expect(container.querySelectorAll("svg").length).toBeGreaterThanOrEqual(2);
  });

  it("renders custom prevIcon / nextIcon overrides", () => {
    render(
      <StepDebugger
        steps={RICH_STEPS}
        prevIcon={<span data-testid="ci-prev">P</span>}
        nextIcon={<span data-testid="ci-next">N</span>}
      />,
    );
    expect(screen.getByTestId("ci-prev")).toBeDefined();
    expect(screen.getByTestId("ci-next")).toBeDefined();
    // The override sits inside the corresponding control button.
    expect(
      screen.getByTitle(/Previous step/).querySelector("[data-testid='ci-prev']"),
    ).not.toBeNull();
    expect(
      screen.getByTitle(/Next step/).querySelector("[data-testid='ci-next']"),
    ).not.toBeNull();
  });
});
