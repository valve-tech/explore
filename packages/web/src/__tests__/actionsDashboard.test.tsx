import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "./_test-utils";
import type { Action } from "../api/actions";

/**
 * ActionsDashboard — lists Web3 Actions for the active chain, with create /
 * edit / toggle / delete / view-logs sub-views. We mock the actions API so the
 * dashboard renders deterministic rows and assert the loading, empty, list, and
 * each handler path.
 *
 * Fixture chain data: an Action pinned to PulseChain mainnet (chainid 369) with
 * a `block` trigger. Trigger types are block/event/periodic/webhook. Chain 369
 * block explorer: https://scan.pulsechain.com
 */

const listActions = vi.fn();
const updateAction = vi.fn();
const deleteAction = vi.fn();
const getAction = vi.fn();
const createAction = vi.fn();

vi.mock("../api/actions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/actions")>()),
  listActions: (...a: unknown[]) => listActions(...a),
  updateAction: (...a: unknown[]) => updateAction(...a),
  deleteAction: (...a: unknown[]) => deleteAction(...a),
  getAction: (...a: unknown[]) => getAction(...a),
  createAction: (...a: unknown[]) => createAction(...a),
}));

import ActionsDashboard from "../components/actions/ActionsDashboard";

const action: Action = {
  id: 7,
  name: "Block watcher",
  code: "async function handler() {}",
  chainid: 369,
  triggerType: "block",
  triggerConfig: { everyNthBlock: 1 },
  secretKeys: [],
  enabled: true,
  createdAt: "2026-06-23T12:00:00",
  updatedAt: "2026-06-23T12:00:00",
};

const stats = { total: 1, active: 1, todayExecutions: 4 };

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("ActionsDashboard", () => {
  it("renders stats and an action card from the list", async () => {
    listActions.mockResolvedValue({ actions: [action], stats });
    renderWithProviders(<ActionsDashboard />);

    expect(await screen.findByText("Block watcher")).toBeInTheDocument();
    // stats values + trigger badge
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("block")).toBeInTheDocument();
    // chain 369 default (no ?chainid in test URL)
    expect(listActions).toHaveBeenCalled();
  });

  it("shows the empty state and navigates to create", async () => {
    listActions.mockResolvedValue({ actions: [], stats: { total: 0, active: 0, todayExecutions: 0 } });
    renderWithProviders(<ActionsDashboard />);

    expect(await screen.findByText("No actions yet")).toBeInTheDocument();
    fireEvent.click(screen.getByText("+ Create Your First Action"));
    expect(await screen.findByRole("heading", { name: "Create Action" })).toBeInTheDocument();
  });

  it("logs an error when listActions rejects", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    listActions.mockRejectedValue(new Error("boom"));
    renderWithProviders(<ActionsDashboard />);
    await waitFor(() => expect(spy).toHaveBeenCalledWith("Failed to fetch actions:", expect.any(Error)));
  });

  it("header Create Action opens the editor", async () => {
    listActions.mockResolvedValue({ actions: [action], stats });
    renderWithProviders(<ActionsDashboard />);
    await screen.findByText("Block watcher");
    fireEvent.click(screen.getByText("+ Create Action"));
    expect(await screen.findByRole("heading", { name: "Create Action" })).toBeInTheDocument();
  });

  it("toggles enabled via updateAction and refetches", async () => {
    listActions.mockResolvedValue({ actions: [action], stats });
    updateAction.mockResolvedValue(action);
    renderWithProviders(<ActionsDashboard />);
    await screen.findByText("Block watcher");

    // The enabled toggle is the first (unnamed switch) button in the card;
    // Logs/Edit/Delete follow it.
    const toggle = screen.getAllByRole("button").find((b) => b.textContent === "")!;
    fireEvent.click(toggle);
    await waitFor(() => expect(updateAction).toHaveBeenCalledWith(7, { enabled: false }));
    await waitFor(() => expect(listActions).toHaveBeenCalledTimes(2));
  });

  it("logs an error when toggle fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    listActions.mockResolvedValue({ actions: [action], stats });
    updateAction.mockRejectedValue(new Error("nope"));
    renderWithProviders(<ActionsDashboard />);
    await screen.findByText("Block watcher");
    const toggle = screen.getAllByRole("button").find((b) => b.textContent === "")!;
    fireEvent.click(toggle);
    await waitFor(() => expect(spy).toHaveBeenCalledWith("Failed to toggle action:", expect.any(Error)));
  });

  it("deletes when confirmed", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    listActions.mockResolvedValue({ actions: [action], stats });
    deleteAction.mockResolvedValue(undefined);
    renderWithProviders(<ActionsDashboard />);
    await screen.findByText("Block watcher");
    fireEvent.click(screen.getByText("Delete"));
    await waitFor(() => expect(deleteAction).toHaveBeenCalledWith(7));
  });

  it("does not delete when confirm is cancelled", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    listActions.mockResolvedValue({ actions: [action], stats });
    renderWithProviders(<ActionsDashboard />);
    await screen.findByText("Block watcher");
    fireEvent.click(screen.getByText("Delete"));
    expect(deleteAction).not.toHaveBeenCalled();
  });

  it("logs an error when delete fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(window, "confirm").mockReturnValue(true);
    listActions.mockResolvedValue({ actions: [action], stats });
    deleteAction.mockRejectedValue(new Error("del-fail"));
    renderWithProviders(<ActionsDashboard />);
    await screen.findByText("Block watcher");
    fireEvent.click(screen.getByText("Delete"));
    await waitFor(() => expect(spy).toHaveBeenCalledWith("Failed to delete action:", expect.any(Error)));
  });

  it("edit fetches the latest action and opens the editor", async () => {
    listActions.mockResolvedValue({ actions: [action], stats });
    getAction.mockResolvedValue({ ...action, name: "Block watcher" });
    renderWithProviders(<ActionsDashboard />);
    await screen.findByText("Block watcher");
    fireEvent.click(screen.getByText("Edit"));
    await waitFor(() => expect(getAction).toHaveBeenCalledWith(7));
    expect(await screen.findByText("Edit Action")).toBeInTheDocument();
  });

  it("cancel from the edit editor returns to the list", async () => {
    listActions.mockResolvedValue({ actions: [action], stats });
    getAction.mockResolvedValue(action);
    renderWithProviders(<ActionsDashboard />);
    await screen.findByText("Block watcher");
    fireEvent.click(screen.getByText("Edit"));
    await screen.findByRole("heading", { name: "Edit Action" });
    fireEvent.click(screen.getByText("Cancel"));
    expect(await screen.findByText("Block watcher")).toBeInTheDocument();
  });

  it("logs an error when edit fetch fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    listActions.mockResolvedValue({ actions: [action], stats });
    getAction.mockRejectedValue(new Error("get-fail"));
    renderWithProviders(<ActionsDashboard />);
    await screen.findByText("Block watcher");
    fireEvent.click(screen.getByText("Edit"));
    await waitFor(() => expect(spy).toHaveBeenCalledWith("Failed to fetch action:", expect.any(Error)));
  });

  it("opens logs view and back returns to the list", async () => {
    listActions.mockResolvedValue({ actions: [action], stats });
    renderWithProviders(<ActionsDashboard />);
    await screen.findByText("Block watcher");
    fireEvent.click(screen.getByText("Logs"));
    expect(await screen.findByText("Logs: Block watcher")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Back"));
    expect(await screen.findByText("Block watcher")).toBeInTheDocument();
  });

  it("renders a disabled action with the Disabled badge", async () => {
    listActions.mockResolvedValue({
      actions: [{ ...action, enabled: false, triggerType: "webhook" as const }],
      stats,
    });
    renderWithProviders(<ActionsDashboard />);
    expect(await screen.findByText("Disabled")).toBeInTheDocument();
    expect(screen.getByText("webhook")).toBeInTheDocument();
  });

  it("exercises hover handlers on card and header buttons", async () => {
    listActions.mockResolvedValue({ actions: [action], stats });
    renderWithProviders(<ActionsDashboard />);
    await screen.findByText("Block watcher");
    for (const label of ["+ Create Action", "Logs", "Edit", "Delete"]) {
      const btn = screen.getByText(label);
      fireEvent.mouseOver(btn);
      fireEvent.mouseOut(btn);
    }
    expect(screen.getByText("Block watcher")).toBeInTheDocument();
  });

  it("exercises the empty-state create button hover handlers", async () => {
    listActions.mockResolvedValue({ actions: [], stats: { total: 0, active: 0, todayExecutions: 0 } });
    renderWithProviders(<ActionsDashboard />);
    const btn = await screen.findByText("+ Create Your First Action");
    fireEvent.mouseOver(btn);
    fireEvent.mouseOut(btn);
    expect(btn).toBeInTheDocument();
  });

  it("saving a new action returns to the list and refetches (handleSaved)", async () => {
    listActions.mockResolvedValue({ actions: [], stats: { total: 0, active: 0, todayExecutions: 0 } });
    createAction.mockResolvedValue({ ...action, id: 50, name: "Saved one" });
    renderWithProviders(<ActionsDashboard />);
    await screen.findByText("No actions yet");
    fireEvent.click(screen.getByText("+ Create Your First Action"));
    await screen.findByRole("heading", { name: "Create Action" });

    fireEvent.change(screen.getByPlaceholderText("My Action"), { target: { value: "Saved one" } });
    // after save, the list reloads — return the new action this time
    listActions.mockResolvedValue({ actions: [{ ...action, id: 50, name: "Saved one" }], stats });
    fireEvent.click(screen.getByRole("button", { name: "Create Action" }));

    await waitFor(() => expect(createAction).toHaveBeenCalled());
    expect(await screen.findByText("Saved one")).toBeInTheDocument();
  });

  it("cancel from the create editor returns to the list", async () => {
    listActions.mockResolvedValue({ actions: [], stats: { total: 0, active: 0, todayExecutions: 0 } });
    renderWithProviders(<ActionsDashboard />);
    await screen.findByText("No actions yet");
    fireEvent.click(screen.getByText("+ Create Your First Action"));
    await screen.findByRole("heading", { name: "Create Action" });
    fireEvent.click(screen.getByText("Cancel"));
    expect(await screen.findByText("No actions yet")).toBeInTheDocument();
  });
});
