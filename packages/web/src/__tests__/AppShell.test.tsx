import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "./_test-utils";
import AppShell from "../components/AppShell";

/**
 * AppShell orchestrator: wires useSidebarState + useCommandPaletteShortcut and
 * owns the palette-open state. We stub the three presentational children and
 * assert the wiring — TopBar's collapse toggle and palette-opener, the ⌘K
 * shortcut, and palette open/close — rather than re-test their internals.
 */

vi.mock("../components/AppShell/TopBar", () => ({
  TopBar: ({
    collapsed,
    onToggleCollapse,
    onOpenPalette,
    apiStatus,
  }: {
    collapsed: boolean;
    onToggleCollapse: () => void;
    onOpenPalette: () => void;
    apiStatus: string;
  }) => (
    <div>
      <span>status:{apiStatus}</span>
      <span>collapsed:{String(collapsed)}</span>
      <button onClick={onToggleCollapse}>toggle</button>
      <button onClick={onOpenPalette}>open-palette</button>
    </div>
  ),
}));
vi.mock("../components/AppShell/Sidebar", () => ({
  Sidebar: ({ collapsed }: { collapsed: boolean }) => (
    <div>sidebar-collapsed:{String(collapsed)}</div>
  ),
}));
vi.mock("../components/AppShell/CommandPalette", () => ({
  CommandPalette: ({ onClose }: { onClose: () => void }) => (
    <div>
      <span>palette-open</span>
      <button onClick={onClose}>close-palette</button>
    </div>
  ),
}));

describe("<AppShell />", () => {
  beforeEach(() => localStorage.clear());

  it("forwards apiStatus and renders children + sidebar (palette closed by default)", () => {
    renderWithProviders(
      <AppShell apiStatus="connected">
        <div>routed-page</div>
      </AppShell>,
    );
    expect(screen.getByText("status:connected")).toBeInTheDocument();
    expect(screen.getByText("routed-page")).toBeInTheDocument();
    expect(screen.getByText("sidebar-collapsed:false")).toBeInTheDocument();
    expect(screen.queryByText("palette-open")).not.toBeInTheDocument();
  });

  it("the collapse toggle flips the sidebar collapsed prop", () => {
    renderWithProviders(
      <AppShell apiStatus="checking">
        <div>page</div>
      </AppShell>,
    );
    fireEvent.click(screen.getByText("toggle"));
    expect(screen.getByText("sidebar-collapsed:true")).toBeInTheDocument();
  });

  it("opens the palette via the TopBar opener and closes it via onClose", () => {
    renderWithProviders(
      <AppShell apiStatus="connected">
        <div>page</div>
      </AppShell>,
    );
    fireEvent.click(screen.getByText("open-palette"));
    expect(screen.getByText("palette-open")).toBeInTheDocument();
    fireEvent.click(screen.getByText("close-palette"));
    expect(screen.queryByText("palette-open")).not.toBeInTheDocument();
  });

  it("⌘K toggles the palette open and Escape closes it", () => {
    renderWithProviders(
      <AppShell apiStatus="connected">
        <div>page</div>
      </AppShell>,
    );
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(screen.getByText("palette-open")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByText("palette-open")).not.toBeInTheDocument();
  });
});
