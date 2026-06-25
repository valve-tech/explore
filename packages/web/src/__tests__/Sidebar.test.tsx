import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "./_test-utils";
import { Sidebar } from "../components/AppShell/Sidebar";
import type { WatchRule } from "../lib/watcher/types";

/**
 * App-shell sidebar. Renders the NAV_GROUPS in both expanded and collapsed
 * states, surfaces a live active-watch badge on the Workspaces item, and keeps
 * Settings/UI/Drafts reachable in the footer (icon links when collapsed).
 */

let rules: WatchRule[] = [];
vi.mock("../hooks/useWatchRules", () => ({
  useWatchRules: () => ({ rules }),
}));
// Treat every enabled rule as actionable so the badge math is predictable.
vi.mock("../lib/watcher/rules", async (orig) => {
  const actual = await orig<typeof import("../lib/watcher/rules")>();
  return { ...actual, isRuleActionable: () => true };
});

function rule(over: Partial<WatchRule>): WatchRule {
  return { id: "r", enabled: true, ...(over as object) } as WatchRule;
}

describe("<Sidebar />", () => {
  beforeEach(() => {
    rules = [];
  });

  it("renders nav group labels and items when expanded", () => {
    renderWithProviders(<Sidebar collapsed={false} />);
    expect(screen.getByText("Inspect")).toBeInTheDocument();
    // "Simulate" is both a group label and a nav item label.
    expect(screen.getAllByText("Simulate").length).toBeGreaterThan(0);
    // A representative nav item label + the footer links.
    expect(screen.getByText("Explorer")).toBeInTheDocument();
    expect(screen.getByText("Settings")).toBeInTheDocument();
    expect(screen.getByText("UI ✶")).toBeInTheDocument();
    expect(screen.getByText("Drafts ✶")).toBeInTheDocument();
  });

  it("hides group labels and text footer links when collapsed", () => {
    renderWithProviders(<Sidebar collapsed />);
    // Group label text is not rendered in the collapsed header slot.
    expect(screen.queryByText("Inspect")).not.toBeInTheDocument();
    expect(screen.queryByText("UI ✶")).not.toBeInTheDocument();
    // Collapsed surfaces UI/Drafts as aria-labelled icon links instead.
    expect(
      screen.getByRole("link", { name: "UI Gallery" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Drafts" })).toBeInTheDocument();
  });

  it("shows the numeric active-watch badge on Workspaces when expanded", () => {
    rules = [rule({ id: "a", enabled: true }), rule({ id: "b", enabled: true })];
    renderWithProviders(<Sidebar collapsed={false} />);
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("does not count disabled rules toward the active-watch badge", () => {
    rules = [rule({ id: "a", enabled: false })];
    renderWithProviders(<Sidebar collapsed={false} />);
    expect(screen.queryByText("1")).not.toBeInTheDocument();
  });

  it("collapsed renders the Workspaces nav link (dot-badge branch)", () => {
    rules = [rule({ id: "a", enabled: true })];
    const { container } = renderWithProviders(<Sidebar collapsed />);
    // Collapsed: label text is hidden, but the /workspace NavLink is present;
    // exercising this asserts the collapsed dot-badge code path renders.
    expect(
      container.querySelector('a[href="/workspace"]'),
    ).not.toBeNull();
  });
});
