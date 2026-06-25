import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "./_test-utils";

/**
 * Drafts cluster — DraftsIndex (router), JourneyDraft (outcome toggle +
 * adaptive next-step rail + lens expand), and WorkspaceDraft (address-centric
 * tabbed hub). These are static visual companions with mock data, so the tests
 * drive the interactive branches: outcome switching changes next-steps, lens
 * cards expand, and the workspace sub-tabs swap content.
 *
 * Mock contract: PulseX Router 0x165C3410fC91EF562C50559f7d2289fEbed552d9 with
 * a WPLS→HEX swap. Chain 369 explorer: https://scan.pulsechain.com
 */

// StorageLayoutViewer (rendered by the workspace 'storage' tab) hits the API;
// stub it so the draft tests stay offline and deterministic.
vi.mock("../components/StorageLayoutViewer", () => ({
  default: () => <div data-testid="storage-layout-stub" />,
}));

import DraftsIndex from "../components/drafts/DraftsIndex";
import JourneyDraft from "../components/drafts/JourneyDraft";
import WorkspaceDraft from "../components/drafts/WorkspaceDraft";

beforeEach(() => vi.clearAllMocks());

describe("DraftsIndex", () => {
  it("renders the index with both draft cards", () => {
    renderWithProviders(<DraftsIndex />, { initialEntries: ["/"] });
    expect(screen.getByText("Layout explorations")).toBeInTheDocument();
    expect(screen.getByText("Tx Journey canvas")).toBeInTheDocument();
    expect(screen.getByText("Address Workspace")).toBeInTheDocument();
  });

  it("routes to the journey draft", () => {
    renderWithProviders(<DraftsIndex />, { initialEntries: ["/journey"] });
    expect(screen.getByText("Reverted swap")).toBeInTheDocument();
  });

  it("routes to the workspace draft", () => {
    renderWithProviders(<DraftsIndex />, { initialEntries: ["/workspace"] });
    expect(screen.getByText("PulseX Router")).toBeInTheDocument();
  });
});

describe("JourneyDraft", () => {
  it("defaults to the reverted outcome with the TRANSFER_FROM_FAILED rail", () => {
    renderWithProviders(<JourneyDraft />);
    expect(screen.getByText(/Step through the revert in the opcode debugger/)).toBeInTheDocument();
    expect(screen.getByText(/Check token allowance on the source address/)).toBeInTheDocument();
  });

  it("switches to the successful outcome and shows the swap rail", () => {
    renderWithProviders(<JourneyDraft />);
    fireEvent.click(screen.getByText("Successful swap"));
    expect(screen.getByText(/See exactly what this swap moved/)).toBeInTheDocument();
    // "Token deltas" appears in both the stepper and the lens title
    expect(screen.getAllByText("Token deltas").length).toBeGreaterThan(0);
  });

  it("switches back to the reverted outcome", () => {
    renderWithProviders(<JourneyDraft />);
    fireEvent.click(screen.getByText("Successful swap"));
    fireEvent.click(screen.getByText("Reverted swap"));
    expect(screen.getByText(/Find the exact PC|Step through the revert/)).toBeInTheDocument();
  });

  it("expands and collapses a lens card", () => {
    renderWithProviders(<JourneyDraft />);
    // "Decoded call" appears in the stepper and the lens header; the lens
    // header is the last occurrence (it's the clickable card title).
    const occurrences = screen.getAllByText("Decoded call");
    const lensTitle = occurrences[occurrences.length - 1]!;
    fireEvent.click(lensTitle); // expand
    fireEvent.click(lensTitle); // collapse
    expect(screen.getAllByText("Decoded call").length).toBeGreaterThan(0);
  });
});

describe("WorkspaceDraft", () => {
  it("renders the activity tab by default", () => {
    renderWithProviders(<WorkspaceDraft />);
    expect(screen.getByText("Recent calls")).toBeInTheDocument();
    expect(screen.getByText("swapExactTokensForTokens")).toBeInTheDocument();
  });

  it("switches to the source tab", () => {
    renderWithProviders(<WorkspaceDraft />);
    fireEvent.click(screen.getByText("Source"));
    expect(screen.getByText(/Rendered via the existing/)).toBeInTheDocument();
  });

  it("switches to the storage tab (stubbed viewer)", () => {
    renderWithProviders(<WorkspaceDraft />);
    fireEvent.click(screen.getByText("Storage"));
    expect(screen.getByTestId("storage-layout-stub")).toBeInTheDocument();
  });

  it("renders the generic placeholder for a non-special tab", () => {
    renderWithProviders(<WorkspaceDraft />);
    fireEvent.click(screen.getByText("Risks"));
    expect(screen.getByText(/panel mounts here/)).toBeInTheDocument();
  });
});
