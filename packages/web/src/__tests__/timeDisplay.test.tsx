import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";
import { getTimeDisplay, setTimeDisplay } from "../lib/settings/timeDisplay";
import Timestamp from "../components/primitives/Timestamp";
import TimeDisplayPicker from "../components/settings/TimeDisplayPicker";

// Block 23076683: 2025-08-05T18:34:11Z.
const TS = 1754418851;
const NOW = Date.UTC(2026, 8, 10, 0, 0, 0);

beforeEach(() => {
  localStorage.clear();
  // The store keeps module-level state that `localStorage.clear()` does not
  // reset, so put it back to the default before each case.
  setTimeDisplay("relative");
});

describe("time display setting", () => {
  it("defaults to relative", () => {
    expect(getTimeDisplay()).toBe("relative");
  });

  it("persists a choice", () => {
    setTimeDisplay("absolute");
    expect(getTimeDisplay()).toBe("absolute");
    expect(localStorage.getItem("explore.timeDisplay")).toBe("absolute");
  });

  it("ignores a stored value it does not know", async () => {
    localStorage.setItem("explore.timeDisplay", "sundial");
    // `read()` runs once at import, so import a fresh module to exercise it.
    vi.resetModules();
    try {
      const mod = await import("../lib/settings/timeDisplay");
      expect(mod.getTimeDisplay()).toBe("relative");
    } finally {
      vi.resetModules();
    }
  });

  it("falls back to the default when storage throws", async () => {
    vi.resetModules();
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    try {
      const mod = await import("../lib/settings/timeDisplay");
      expect(mod.getTimeDisplay()).toBe("relative");
    } finally {
      getItem.mockRestore();
      vi.resetModules();
    }
  });
});

describe("<Timestamp />", () => {
  it("renders the age by default, with the UTC date on hover", () => {
    render(<Timestamp ts={TS} now={NOW} />);
    const el = screen.getByText("1y 1mo ago");
    expect(el.tagName).toBe("TIME");
    expect(el).toHaveAttribute("datetime", "2025-08-05T18:34:11.000Z");
    expect(el).toHaveAttribute("title", "2025-08-05 18:34:11 UTC");
  });

  it("follows the setting when it changes", () => {
    render(<Timestamp ts={TS} now={NOW} />);
    act(() => setTimeDisplay("absolute"));
    const el = screen.getByText("2025-08-05 18:34:11 UTC");
    expect(el).toHaveAttribute("title", "1y 1mo ago");
    act(() => setTimeDisplay("both"));
    expect(screen.getByText("2025-08-05 18:34:11 UTC (1y 1mo ago)")).toBeInTheDocument();
  });

  it("renders nothing for a missing timestamp", () => {
    const { container } = render(<Timestamp ts={null} now={NOW} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("<TimeDisplayPicker />", () => {
  it("offers the three modes as buttons, not a native select", () => {
    const { container } = render(<TimeDisplayPicker />);
    expect(container.querySelector("select")).toBeNull();
    expect(screen.getByRole("radio", { name: "Relative" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "UTC date" })).toHaveAttribute("aria-checked", "false");
  });

  it("writes the store when a mode is picked", () => {
    render(<TimeDisplayPicker />);
    fireEvent.click(screen.getByRole("radio", { name: "Both" }));
    expect(getTimeDisplay()).toBe("both");
    expect(screen.getByRole("radio", { name: "Both" })).toHaveAttribute("aria-checked", "true");
  });
});
