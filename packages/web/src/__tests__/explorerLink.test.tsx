import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ExplorerLink } from "../components/explorer/ExplorerLink";

/**
 * ExplorerLink renders a real <a href> so native open-in-new-tab works, but a
 * plain left-click is intercepted for in-app SPA navigation. Modifier/middle
 * clicks must fall through to the browser.
 */
const target = { type: "address", value: "0x155172653e94a7e5f0e04126803dcb6896796fbb" };

describe("ExplorerLink", () => {
  it("renders an anchor with a hash href for the target", () => {
    render(
      <ExplorerLink target={target} onNavigate={vi.fn()}>
        link
      </ExplorerLink>,
    );
    const a = screen.getByText("link").closest("a")!;
    expect(a.getAttribute("href")).toMatch(/^#\/address\//);
    expect(a.getAttribute("href")).toContain(target.value);
  });

  it("plain click navigates in-app (preventDefault + onNavigate)", () => {
    const onNavigate = vi.fn();
    render(
      <ExplorerLink target={target} onNavigate={onNavigate}>
        link
      </ExplorerLink>,
    );
    fireEvent.click(screen.getByText("link"));
    expect(onNavigate).toHaveBeenCalledWith(target);
  });

  it("modifier-click falls through to the browser (no in-app nav)", () => {
    const onNavigate = vi.fn();
    render(
      <ExplorerLink target={target} onNavigate={onNavigate}>
        link
      </ExplorerLink>,
    );
    fireEvent.click(screen.getByText("link"), { metaKey: true });
    fireEvent.click(screen.getByText("link"), { ctrlKey: true });
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("falls back to the address path for an unknown target type", () => {
    render(
      <ExplorerLink target={{ type: "weird", value: "0xabc" }} onNavigate={vi.fn()}>
        x
      </ExplorerLink>,
    );
    expect(screen.getByText("x").closest("a")!.getAttribute("href")).toMatch(
      /^#\/address\//,
    );
  });

  it("wraps in a tooltip when a title is given", () => {
    render(
      <ExplorerLink target={target} onNavigate={vi.fn()} title="full address">
        link
      </ExplorerLink>,
    );
    // Still renders the link; the tooltip wrapper doesn't change the href.
    expect(screen.getByText("link").closest("a")).toBeInTheDocument();
  });
});
