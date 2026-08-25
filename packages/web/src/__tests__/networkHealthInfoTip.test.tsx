import { describe, it, expect } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "./_test-utils";
import { InfoTip, Eq, tipGeometry } from "../components/networkHealth/InfoTip";

/**
 * InfoTip's popover used to be `position: absolute; left: 0; width: 18rem`
 * inside its ⓘ trigger. An absolutely-positioned box still grows its scroll
 * container, so a trigger near the right edge threw 288px of bubble past that
 * edge and gave /network-health 205px of horizontal scroll at 375px
 * (`packages/web/e2e/viewport.spec.ts`). The popover now renders through a
 * portal at `position: fixed`, clamped to stay on screen — these tests pin both
 * halves of that.
 */
describe("tipGeometry", () => {
  it("anchors to the trigger when the popover fits to its right", () => {
    expect(tipGeometry(400, 120, 1440)).toEqual({
      left: 400,
      top: 124,
      width: 288,
    });
  });

  it("pulls the popover back on screen when the trigger sits near the edge", () => {
    // 375px viewport, trigger at x=291: anchoring would put the right edge at
    // 579 — the exact overflow the e2e gate measured.
    const geometry = tipGeometry(291, 300, 375);
    expect(geometry.left + geometry.width).toBeLessThanOrEqual(375 - 8);
    expect(geometry.left).toBe(375 - 288 - 8);
  });

  it("keeps the gutter on the left edge too", () => {
    expect(tipGeometry(0, 10, 1440).left).toBe(8);
  });

  it("narrows the popover rather than overflow a viewport under 304px", () => {
    const geometry = tipGeometry(10, 10, 240);
    expect(geometry.width).toBe(224);
    expect(geometry.left).toBe(8);
  });
});

describe("InfoTip", () => {
  it("shows the explanation on hover and hides it again", () => {
    renderWithProviders(
      <InfoTip label="fees burned">
        <Eq>burned = baseFee × gasUsed</Eq>
      </InfoTip>,
    );
    const trigger = screen.getByRole("button", { name: "fees burned" });
    expect(screen.queryByRole("tooltip")).toBeNull();

    fireEvent.mouseEnter(trigger.parentElement as HTMLElement);
    const tip = screen.getByRole("tooltip");
    expect(tip.textContent).toContain("burned = baseFee × gasUsed");
    // Fixed positioning is what keeps the bubble out of the pane's scrollWidth.
    expect(tip.className).toContain("fixed");
    // The portal puts it on <body>, so no card or scroll area can clip it.
    expect(tip.closest("[data-testid]")).toBeNull();
    expect(trigger.getAttribute("aria-describedby")).toBe(tip.id);

    fireEvent.mouseLeave(trigger.parentElement as HTMLElement);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("also opens on keyboard focus", () => {
    renderWithProviders(<InfoTip label="window">one window of blocks</InfoTip>);
    const trigger = screen.getByRole("button", { name: "window" });
    fireEvent.focus(trigger);
    expect(screen.getByRole("tooltip").textContent).toBe(
      "one window of blocks",
    );
    fireEvent.blur(trigger);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});
