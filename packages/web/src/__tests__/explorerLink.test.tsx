import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "./_test-utils";
import { ExplorerLink } from "../components/explorer/ExplorerLink";

/**
 * ExplorerLink renders a real <a href> so native open-in-new-tab works, but a
 * plain left-click is intercepted for in-app SPA navigation. Modifier/middle
 * clicks must fall through to the browser.
 *
 * It reads the page's active chain (`useActiveChainId`), so it needs a
 * Router in the test tree. At the default `/` entry that collapses to the
 * default chain (369) — the href carries that prefix.
 */
const target = { type: "address", value: "0x155172653e94a7e5f0e04126803dcb6896796fbb" };

describe("ExplorerLink", () => {
  it("renders an anchor with a hash href for the target, scoped to the active chain", () => {
    renderWithProviders(
      <ExplorerLink target={target} onNavigate={vi.fn()}>
        link
      </ExplorerLink>,
    );
    const a = screen.getByText("link").closest("a")!;
    expect(a.getAttribute("href")).toMatch(/^#\/eip155\/369\/address\//);
    expect(a.getAttribute("href")).toContain(target.value);
  });

  it("plain click navigates in-app (preventDefault + onNavigate)", () => {
    const onNavigate = vi.fn();
    renderWithProviders(
      <ExplorerLink target={target} onNavigate={onNavigate}>
        link
      </ExplorerLink>,
    );
    fireEvent.click(screen.getByText("link"));
    expect(onNavigate).toHaveBeenCalledWith(target);
  });

  it("modifier-click falls through to the browser (no in-app nav)", () => {
    const onNavigate = vi.fn();
    renderWithProviders(
      <ExplorerLink target={target} onNavigate={onNavigate}>
        link
      </ExplorerLink>,
    );
    fireEvent.click(screen.getByText("link"), { metaKey: true });
    fireEvent.click(screen.getByText("link"), { ctrlKey: true });
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("falls back to the address path for an unknown target type", () => {
    renderWithProviders(
      <ExplorerLink target={{ type: "weird", value: "0xabc" }} onNavigate={vi.fn()}>
        x
      </ExplorerLink>,
    );
    expect(screen.getByText("x").closest("a")!.getAttribute("href")).toMatch(
      /^#\/eip155\/369\/address\//,
    );
  });

  it("wraps in a tooltip when a title is given", () => {
    renderWithProviders(
      <ExplorerLink target={target} onNavigate={vi.fn()} title="full address">
        link
      </ExplorerLink>,
    );
    // Still renders the link; the tooltip wrapper doesn't change the href.
    expect(screen.getByText("link").closest("a")).toBeInTheDocument();
  });

  it("carries a scoped page's chain instead of the default", () => {
    renderWithProviders(
      <ExplorerLink target={target} onNavigate={vi.fn()}>
        link
      </ExplorerLink>,
      { initialEntries: ["/eip155/1/tx/0xabc"] },
    );
    const a = screen.getByText("link").closest("a")!;
    expect(a.getAttribute("href")).toMatch(/^#\/eip155\/1\/address\//);
  });
});
