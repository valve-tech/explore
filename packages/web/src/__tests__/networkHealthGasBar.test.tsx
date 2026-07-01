import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { SplitBar } from "../components/networkHealth/SplitBar";
import { blockFullness } from "../components/networkHealth/BlockTable";

/**
 * The block gas bar encodes magnitude in its LENGTH: fillFraction scales the
 * filled (type-split) portion so a fuller block draws a wider bar. Without
 * fillFraction the bar is a pure share bar (fills 100%). blockFullness turns a
 * block's raw gasUsed/gasLimit into that fraction.
 */

/** The filled flex sub-bar is the first child of the track. */
function filledWidth(container: HTMLElement): string {
  const track = container.firstElementChild as HTMLElement;
  const filled = track.firstElementChild as HTMLElement;
  return filled.style.width;
}

describe("SplitBar fillFraction", () => {
  it("fills the whole track when fillFraction is omitted (pure share bar)", () => {
    const { container } = render(<SplitBar legacyFraction={0.5} />);
    expect(filledWidth(container)).toBe("100%");
  });

  it("scales the filled portion to fillFraction (magnitude as length)", () => {
    const { container } = render(
      <SplitBar legacyFraction={0.5} fillFraction={0.25} />,
    );
    expect(filledWidth(container)).toBe("25%");
  });

  it("clamps fillFraction into [0,1]", () => {
    const over = render(<SplitBar legacyFraction={0.5} fillFraction={2} />);
    expect(filledWidth(over.container)).toBe("100%");
    const under = render(<SplitBar legacyFraction={0.5} fillFraction={-1} />);
    expect(filledWidth(under.container)).toBe("0%");
  });
});

describe("blockFullness", () => {
  it("is gasUsed / gasLimit", () => {
    expect(blockFullness("100", "200")).toBeCloseTo(0.5, 4);
    expect(blockFullness("44880000", "44880000")).toBeCloseTo(1, 4);
    expect(blockFullness("0", "44880000")).toBe(0);
  });

  it("is 0 for a zero or unparseable limit", () => {
    expect(blockFullness("100", "0")).toBe(0);
    expect(blockFullness("nope", "200")).toBe(0);
  });
});
