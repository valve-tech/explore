import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  getShowTestnets,
  setShowTestnets,
  visibleChainIds,
} from "../lib/settings/testnets";
import TestnetToggle from "../components/settings/TestnetToggle";

beforeEach(() => {
  localStorage.clear();
  // The store keeps module-level state (`current`), which `localStorage.clear()`
  // does not reset. Without this, a case that calls `setShowTestnets(false)`
  // leaves the store false for the next case, so test order would matter.
  setShowTestnets(true);
});

describe("testnet setting", () => {
  it("defaults to showing testnets", () => {
    expect(getShowTestnets()).toBe(true);
    expect(visibleChainIds()).toEqual([1, 369, 943, 11155111]);
  });

  it("narrows the visible chain set when testnets are hidden", () => {
    setShowTestnets(false);
    expect(visibleChainIds()).toEqual([1, 369]);
  });

  it("persists across reads", () => {
    setShowTestnets(false);
    expect(getShowTestnets()).toBe(false);
  });

  it("falls back to the default when storage throws", () => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = () => {
      throw new Error("blocked");
    };
    try {
      expect(getShowTestnets()).toBe(true);
    } finally {
      Storage.prototype.getItem = original;
    }
  });
});

describe("TestnetToggle", () => {
  it("is not a native checkbox", () => {
    const { container } = render(<TestnetToggle />);
    expect(container.querySelector("input[type='checkbox']")).toBeNull();
    expect(screen.getByRole("switch")).toBeInTheDocument();
  });

  it("flips the setting and reports the new chain count", () => {
    render(<TestnetToggle />);
    const toggle = screen.getByRole("switch");
    expect(toggle).toHaveAttribute("aria-checked", "true");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(getShowTestnets()).toBe(false);
    expect(screen.getByText(/2 of 4 chains/i)).toBeInTheDocument();
  });
});
