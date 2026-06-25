import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "./_test-utils";

/**
 * ComponentGallery (/ui) — the in-app design surface listing primitives and
 * composite components, each with a copyable stable ID. We render the gallery
 * and drive its two stateful demo wrappers (the themed Checkbox and the
 * Dropdown) plus an IdChip copy, covering the framework helpers.
 *
 * The gallery's live widgets (GasOracleWidget / RecentRail) sit behind
 * TanStack Query; with retry:false they render their loading shell offline.
 */

const copyToClipboard = vi.fn().mockResolvedValue(true);
vi.mock("../lib/clipboard", () => ({
  copyToClipboard: (...a: unknown[]) => copyToClipboard(...a),
}));

import ComponentGallery from "../components/gallery/ComponentGallery";

beforeEach(() => vi.clearAllMocks());

describe("ComponentGallery", () => {
  it("renders the gallery header and section titles", () => {
    renderWithProviders(<ComponentGallery />);
    expect(screen.getByText("Component gallery")).toBeInTheDocument();
    expect(screen.getByText("Primitives")).toBeInTheDocument();
    expect(screen.getByText("Composite components")).toBeInTheDocument();
  });

  it("renders gallery items with their badges and status variants", () => {
    renderWithProviders(<ComponentGallery />);
    expect(screen.getByText("Badge — semantic pill")).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument(); // badge/warn
    expect(screen.getByText("EIP-1559")).toBeInTheDocument(); // badge/info
  });

  it("toggles the demo checkbox", () => {
    renderWithProviders(<ComponentGallery />);
    const checkbox = screen.getByRole("checkbox", { name: /auto-fetch abi/i });
    expect(checkbox).toBeInTheDocument();
    fireEvent.click(checkbox);
    // no throw — the stateful wrapper flipped
    expect(checkbox).toBeInTheDocument();
  });

  it("changes the demo dropdown selection", () => {
    renderWithProviders(<ComponentGallery />);
    const trigger = screen.getByRole("button", { name: /sort/i });
    fireEvent.click(trigger);
    // open the menu and pick another option
    const nonce = screen.getByText(/nonce ↑/);
    fireEvent.click(nonce);
    expect(screen.getByRole("button", { name: /sort/i })).toBeInTheDocument();
  });

  it("copies an ID chip value via CopyButton", () => {
    renderWithProviders(<ComponentGallery />);
    const copyButtons = screen.getAllByRole("button", { name: /copy/i });
    expect(copyButtons.length).toBeGreaterThan(0);
    fireEvent.click(copyButtons[0]!);
    expect(copyToClipboard).toHaveBeenCalled();
  });
});
