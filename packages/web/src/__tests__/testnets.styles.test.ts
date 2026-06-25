import { describe, it, expect } from "vitest";
import { msgColor, sectionStyle, inputStyle } from "../components/testnets/ForkControls/styles";

/**
 * Pure presentational helpers shared by the ForkControls panels. msgColor
 * picks danger vs success based on the "Error" prefix the panels emit.
 */
describe("ForkControls/styles", () => {
  it("sectionStyle / inputStyle expose the CSS-var backed tokens", () => {
    expect(sectionStyle.backgroundColor).toContain("var(");
    expect(inputStyle.color).toContain("var(");
  });

  it("msgColor returns transparent for null", () => {
    expect(msgColor(null)).toBe("transparent");
  });

  it("msgColor returns danger for an Error-prefixed message", () => {
    expect(msgColor("Error: boom")).toBe("var(--color-danger)");
  });

  it("msgColor returns success for a non-error message", () => {
    expect(msgColor("Mined 1 block")).toBe("var(--color-success)");
  });
});
