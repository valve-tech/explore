import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { MiddleTruncate } from "../MiddleTruncate";

const ADDR = "0xA1077a294dDE1B09bB078844df40758a5D0f9a27";

describe("MiddleTruncate", () => {
  it("keeps the FULL value in the DOM (searchable + copyable)", () => {
    const { container } = render(<MiddleTruncate value={ADDR} />);
    // textContent is what Ctrl+F searches and what copy yields — must be intact,
    // no ellipsis char injected into the text.
    expect(container.textContent).toBe(ADDR);
    expect(container.textContent).not.toContain("…");
  });

  it("pins the last N chars in the tail span", () => {
    const { container } = render(<MiddleTruncate value={ADDR} tailChars={4} />);
    const tail = container.querySelector(".mt-tail");
    const lead = container.querySelector(".mt-lead");
    expect(tail?.textContent).toBe("9a27");
    expect(lead?.textContent).toBe(ADDR.slice(0, -4));
  });

  it("exposes the full value as the title", () => {
    const { container } = render(<MiddleTruncate value={ADDR} />);
    expect(container.querySelector(".mt")?.getAttribute("title")).toBe(ADDR);
  });

  it("renders a short value whole with no lead span", () => {
    const { container } = render(<MiddleTruncate value="0x12" tailChars={4} />);
    expect(container.textContent).toBe("0x12");
    expect(container.querySelector(".mt-lead")).toBeNull();
  });
});
