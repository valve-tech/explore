import { describe, it, expect } from "vitest";
import { tooltipPosition } from "../components/networkHealth/FeeLadder";

/**
 * The fee-ladder tooltip must track the cursor MONOTONICALLY: moving right moves
 * the card right, moving down moves it down. The prior bug read the hovered
 * bar's local offsetX (reset per bar), so the card jumped backwards mid-sweep.
 * Positions are fractions of the plot [0,1]; the card corner-anchors to the
 * cursor's own side so it grows inward near an edge.
 */

describe("tooltipPosition", () => {
  it("anchors left on the left half, right on the right half", () => {
    const l = tooltipPosition({ x: 0.25, y: 0.25 });
    expect(l.left).toBe("25%");
    expect(l.right).toBeUndefined();
    expect(l.top).toBe("25%");
    expect(l.bottom).toBeUndefined();

    const r = tooltipPosition({ x: 0.75, y: 0.75 });
    expect(r.right).toBe("25%"); // 1 - 0.75
    expect(r.left).toBeUndefined();
    expect(r.bottom).toBe("25%");
    expect(r.top).toBeUndefined();
  });

  it("moves the card right as the cursor moves right (no direction flip)", () => {
    const xs = [0.05, 0.2, 0.35, 0.49];
    const lefts = xs.map((x) => parseFloat(tooltipPosition({ x, y: 0.1 }).left!));
    for (let i = 1; i < lefts.length; i += 1) {
      expect(lefts[i]!).toBeGreaterThan(lefts[i - 1]!);
    }
    // Past the midpoint it anchors from the right; that offset SHRINKS as the
    // cursor keeps moving right (card edge keeps moving right, still monotonic).
    const rights = [0.55, 0.7, 0.85, 0.95].map(
      (x) => parseFloat(tooltipPosition({ x, y: 0.9 }).right!),
    );
    for (let i = 1; i < rights.length; i += 1) {
      expect(rights[i]!).toBeLessThan(rights[i - 1]!);
    }
  });
});
