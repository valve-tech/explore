import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "./_test-utils";

/**
 * AlertBuilder — the create/edit form. It delegates persistence to
 * createAlert/updateAlert (api/alerts); here we mock just those and the active
 * chain, and assert the save flow + edit-vs-create branch. Rendering the builder
 * also mounts BasicInfoCard / ConditionsCard / NotificationChannelsCard.
 */

const createAlert = vi.fn();
const updateAlert = vi.fn();
vi.mock("../api/alerts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/alerts")>()),
  createAlert: (...a: unknown[]) => createAlert(...a),
  updateAlert: (...a: unknown[]) => updateAlert(...a),
}));
vi.mock("../lib/activeChain", () => ({ useActiveChainId: () => 369 }));

import AlertBuilder from "../components/monitoring/AlertBuilder";
import type { Alert } from "../api/alerts";

beforeEach(() => vi.clearAllMocks());

describe("AlertBuilder", () => {
  it("create: posts the payload pinned to the active chain, then onSaved", async () => {
    createAlert.mockResolvedValue({ id: 1 });
    const onSaved = vi.fn();
    renderWithProviders(<AlertBuilder onSaved={onSaved} onCancel={vi.fn()} />);

    // Save is disabled until a name is present.
    const save = screen.getByRole("button", { name: "Create Alert" });
    expect(save).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText("e.g., Large Transfer Monitor"), {
      target: { value: "Whale watch" },
    });
    fireEvent.click(save);

    await waitFor(() => expect(createAlert).toHaveBeenCalledTimes(1));
    const [payload, chainId] = createAlert.mock.calls[0]!;
    expect(payload).toMatchObject({
      name: "Whale watch",
      type: "address_activity",
      enabled: true,
      cooldown_seconds: 60,
    });
    expect(chainId).toBe(369);
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(updateAlert).not.toHaveBeenCalled();
  });

  it("edit: updates the existing alert (no chain re-pin) and labels the button", async () => {
    updateAlert.mockResolvedValue({ id: 7 });
    const alert = {
      id: 7,
      name: "Existing",
      type: "failed_tx",
      conditions: {},
      notifications: [],
      cooldown_seconds: 120,
      enabled: true,
    } as unknown as Alert;
    const onSaved = vi.fn();

    renderWithProviders(<AlertBuilder alert={alert} onSaved={onSaved} onCancel={vi.fn()} />);

    fireEvent.click(screen.getByText("Update Alert"));
    await waitFor(() => expect(updateAlert).toHaveBeenCalledTimes(1));
    expect(updateAlert.mock.calls[0]![0]).toBe(7);
    expect(createAlert).not.toHaveBeenCalled();
  });

  it("surfaces a save error and does not call onSaved", async () => {
    createAlert.mockRejectedValue(new Error("duplicate name"));
    const onSaved = vi.fn();
    renderWithProviders(<AlertBuilder onSaved={onSaved} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText("e.g., Large Transfer Monitor"), {
      target: { value: "dupe" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create Alert" }));
    expect(await screen.findByText("duplicate name")).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("Cancel calls onCancel", () => {
    const onCancel = vi.fn();
    renderWithProviders(<AlertBuilder onSaved={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalled();
  });
});
