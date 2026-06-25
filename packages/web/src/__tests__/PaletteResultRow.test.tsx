import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PaletteResultRow } from "../components/AppShell/PaletteResultRow";
import {
  PALETTE_ENTITY_MIME,
} from "../components/workspace/PaletteWorkspaceDropZone";
import type { Result } from "../components/AppShell/buildResults";

/**
 * One command-palette result row. Drives: the activate click, the hover →
 * select callback, the ↵ hint when selected, and the draggable path that
 * serializes the fileable entity onto the dataTransfer. Anchored on WPLS
 * (PulseChain 369) — https://scan.pulsechain.com.
 */
const WPLS = "0xa1077a294dde1b09bb078844df40758a5d0f9a27";

// AddToWorkspaceButton pulls in workspace hooks/queries; stub it so this row
// test stays focused on the row's own behavior.
vi.mock("../components/workspace/AddToWorkspaceButton", () => ({
  AddToWorkspaceButton: () => <button>add-to-ws</button>,
}));

function result(over: Partial<Result> = {}): Result {
  return {
    id: "r1",
    group: "Jump to",
    tag: "address",
    label: "Open in Explorer",
    detail: "Recent activity",
    icon: "heroicons:magnifying-glass",
    to: `/address/${WPLS}`,
    ...over,
  };
}

function noopProps() {
  return {
    onHover: vi.fn(),
    onActivate: vi.fn(),
    onDragStart: vi.fn(),
    onDragEnd: vi.fn(),
  };
}

describe("<PaletteResultRow />", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders label/detail/tag and fires onActivate on click", () => {
    const props = noopProps();
    render(
      <PaletteResultRow result={result()} selected={false} {...props} />,
    );
    expect(screen.getByText("Open in Explorer")).toBeInTheDocument();
    expect(screen.getByText("Recent activity")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Open in Explorer"));
    expect(props.onActivate).toHaveBeenCalled();
  });

  it("fires onHover on mouse enter", () => {
    const props = noopProps();
    const { container } = render(
      <PaletteResultRow result={result()} selected={false} {...props} />,
    );
    fireEvent.mouseEnter(container.firstChild as Element);
    expect(props.onHover).toHaveBeenCalled();
  });

  it("shows the ↵ hint only when selected", () => {
    const props = noopProps();
    const { rerender } = render(
      <PaletteResultRow result={result()} selected={false} {...props} />,
    );
    expect(screen.queryByText("↵")).not.toBeInTheDocument();
    rerender(<PaletteResultRow result={result()} selected {...props} />);
    expect(screen.getByText("↵")).toBeInTheDocument();
  });

  it("is draggable + serializes the entity when it carries one", () => {
    const props = noopProps();
    const r = result({ entity: { kind: "address", value: WPLS } });
    const { container } = render(
      <PaletteResultRow result={r} selected={false} {...props} />,
    );
    const row = container.firstChild as HTMLElement;
    expect(row.getAttribute("draggable")).toBe("true");
    // The fileable entity also shows the add-to-workspace button (mocked).
    expect(screen.getByText("add-to-ws")).toBeInTheDocument();

    const setData = vi.fn();
    fireEvent.dragStart(row, {
      dataTransfer: { setData, effectAllowed: "" },
    });
    expect(setData).toHaveBeenCalledWith(
      PALETTE_ENTITY_MIME,
      JSON.stringify({ kind: "address", value: WPLS }),
    );
    expect(props.onDragStart).toHaveBeenCalled();

    fireEvent.dragEnd(row);
    expect(props.onDragEnd).toHaveBeenCalled();

    // Clicking the workspace button's wrapper stops propagation so the row's
    // activate doesn't fire (line 69).
    fireEvent.click(screen.getByText("add-to-ws"));
    expect(props.onActivate).not.toHaveBeenCalled();
  });

  it("is NOT draggable and has no workspace button without an entity", () => {
    const props = noopProps();
    const { container } = render(
      <PaletteResultRow
        result={result({ tag: "page", entity: undefined })}
        selected={false}
        {...props}
      />,
    );
    const row = container.firstChild as HTMLElement;
    expect(row.getAttribute("draggable")).toBe("false");
    // dragStart early-returns when there's no entity — onDragStart not called.
    fireEvent.dragStart(row, { dataTransfer: { setData: vi.fn() } });
    expect(props.onDragStart).not.toHaveBeenCalled();
    expect(screen.queryByText("add-to-ws")).not.toBeInTheDocument();
  });
});
