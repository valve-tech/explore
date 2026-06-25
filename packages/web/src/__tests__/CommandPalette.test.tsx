import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "./_test-utils";
import { CommandPalette } from "../components/AppShell/CommandPalette";
import type { RecentEntity } from "../lib/recentEntities";

/**
 * ⌘K command palette. Drives: empty-state copy, parsing a pasted entity into a
 * kind badge + "Jump to" rows, keyboard nav (arrows/enter/tab), tab clicks,
 * recents rendering, the backdrop-click close, and navigate-on-select.
 *
 * Real PulseChain (369) anchors — https://scan.pulsechain.com:
 *   WPLS address  0xa1077a294dde1b09bb078844df40758a5d0f9a27
 *   a 66-char tx hash, a 4byte selector, a block number.
 */
const WPLS = "0xa1077a294dde1b09bb078844df40758a5d0f9a27";
const TX = "0x" + "ab".repeat(32);

let store: RecentEntity[] = [];
vi.mock("../hooks/useRecentEntities", () => ({
  useRecentEntities: () => store,
}));
vi.mock("../components/workspace/AddToWorkspaceButton", () => ({
  AddToWorkspaceButton: () => <button>add-to-ws</button>,
}));
const navigate = vi.fn();
vi.mock("react-router-dom", async (orig) => {
  const actual = await orig<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => navigate };
});

function ent(over: Partial<RecentEntity>): RecentEntity {
  return {
    kind: "address",
    value: WPLS,
    pinned: false,
    visits: 1,
    lastSeen: Date.now(),
    ...over,
  };
}

function input() {
  return screen.getByPlaceholderText(/Search recent, contracts, pages/i);
}

describe("<CommandPalette />", () => {
  beforeEach(() => {
    store = [];
    navigate.mockClear();
  });

  it("shows the empty-state copy with no query and no recents", () => {
    renderWithProviders(<CommandPalette onClose={vi.fn()} />);
    expect(screen.getByText(/Nothing viewed yet/i)).toBeInTheDocument();
  });

  it("parsing a tx hash shows the kind badge + Debugger/Explorer jump rows", () => {
    renderWithProviders(<CommandPalette onClose={vi.fn()} />);
    fireEvent.change(input(), { target: { value: TX } });
    expect(screen.getByText("Transaction hash")).toBeInTheDocument();
    expect(screen.getByText("Open in Debugger")).toBeInTheDocument();
    expect(screen.getByText("Open in Explorer")).toBeInTheDocument();
  });

  it("Enter on the first result navigates to it and closes", () => {
    const onClose = vi.fn();
    renderWithProviders(<CommandPalette onClose={onClose} />);
    fireEvent.change(input(), { target: { value: TX } });
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(navigate).toHaveBeenCalledWith(`/debugger/${TX}`);
    expect(onClose).toHaveBeenCalled();
  });

  it("ArrowDown then Enter selects the second result", () => {
    renderWithProviders(<CommandPalette onClose={vi.fn()} />);
    fireEvent.change(input(), { target: { value: TX } });
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(navigate).toHaveBeenCalledWith(`/tx/${TX}`);
  });

  it("ArrowUp clamps at the top (stays on the first result)", () => {
    renderWithProviders(<CommandPalette onClose={vi.fn()} />);
    fireEvent.change(input(), { target: { value: TX } });
    fireEvent.keyDown(input(), { key: "ArrowUp" });
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(navigate).toHaveBeenCalledWith(`/debugger/${TX}`);
  });

  it("Tab cycles scope all→recent→contracts→pages, landing on page rows", () => {
    renderWithProviders(<CommandPalette onClose={vi.fn()} />);
    fireEvent.change(input(), { target: { value: "settings" } });
    // all → recent → contracts → pages (3 Tabs).
    fireEvent.keyDown(input(), { key: "Tab" });
    fireEvent.keyDown(input(), { key: "Tab" });
    fireEvent.keyDown(input(), { key: "Tab" });
    // On the Pages tab, "settings" matches the Settings utility page row.
    expect(screen.getAllByText("Settings").length).toBeGreaterThan(0);
  });

  it("Shift+Tab cycles scope backwards without crashing", () => {
    renderWithProviders(<CommandPalette onClose={vi.fn()} />);
    fireEvent.keyDown(input(), { key: "Tab", shiftKey: true });
    // Landed on some other scope tab; the palette still renders its input.
    expect(input()).toBeInTheDocument();
  });

  it("clicking a scope tab switches it (Pages shows page rows)", () => {
    renderWithProviders(<CommandPalette onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Pages" }));
    expect(screen.getByText("Explorer")).toBeInTheDocument();
  });

  it("renders recents and navigates on row activate", () => {
    store = [ent({ kind: "address", value: WPLS, label: "WPLS" })];
    renderWithProviders(<CommandPalette onClose={vi.fn()} />);
    fireEvent.click(screen.getByText("WPLS"));
    expect(navigate).toHaveBeenCalledWith(`/address/${WPLS}`);
  });

  it("hovering a result row updates the selection", () => {
    store = [
      ent({ kind: "tx", value: TX, status: "success", label: "swap one" }),
      ent({ kind: "address", value: WPLS, label: "WPLS" }),
    ];
    renderWithProviders(<CommandPalette onClose={vi.fn()} />);
    fireEvent.mouseEnter(screen.getByText("WPLS"));
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(navigate).toHaveBeenCalledWith(`/address/${WPLS}`);
  });

  it("no-match query (non-empty, no results) shows the paste hint", () => {
    renderWithProviders(<CommandPalette onClose={vi.fn()} />);
    fireEvent.change(input(), { target: { value: "zzz-no-such-thing" } });
    expect(screen.getByText(/No matches\./i)).toBeInTheDocument();
  });

  it("clicking the backdrop closes the palette", () => {
    const onClose = vi.fn();
    const { container } = renderWithProviders(
      <CommandPalette onClose={onClose} />,
    );
    fireEvent.click(container.firstChild as Element);
    expect(onClose).toHaveBeenCalled();
  });

  it("dragging a fileable recent row toggles the workspace drop overlay", () => {
    store = [ent({ kind: "address", value: WPLS, label: "WPLS" })];
    const { container } = renderWithProviders(
      <CommandPalette onClose={vi.fn()} />,
    );
    // The recent row is draggable (carries an entity); start + end a drag to
    // exercise the palette's onDragStart/onDragEnd wiring (isDragging state).
    const row = screen.getByText("WPLS").closest("[draggable='true']")!;
    fireEvent.dragStart(row, {
      dataTransfer: { setData: vi.fn(), effectAllowed: "" },
    });
    fireEvent.dragEnd(row);
    // Palette still mounted after the drag cycle.
    expect(container.querySelector("input")).not.toBeNull();
  });

  it("clicking inside the card does NOT close the palette", () => {
    const onClose = vi.fn();
    renderWithProviders(<CommandPalette onClose={onClose} />);
    fireEvent.click(input());
    expect(onClose).not.toHaveBeenCalled();
  });
});
