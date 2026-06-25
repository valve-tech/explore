import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "./_test-utils";
import type { Alert, AlertStats } from "../api/alerts";

/**
 * Supplemental monitoring + misc coverage:
 *  - AlertHistory: pagination (Prev/Next, bounds), no-tx_hash "--", summary,
 *    matched_data summary, onBack.
 *  - AlertDashboard: delete (confirm yes/no), test (success/fail), edit/create/
 *    history sub-views, list error banner.
 *
 * Real WPLS transfer hash on PulseChain (chain 369), block 26804492.
 * https://scan.pulsechain.com/block/26804492
 */

const HASH =
  "0xd515ef07d4308c389b05fe13c55ac1ebe3270bd8bbf4470b0a134a1766fe3c81";

// ------------------------------------------------------------------ AlertHistory
const getAlertHistory = vi.fn();
vi.mock("../api/alerts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/alerts")>()),
  getAlertHistory: (...a: unknown[]) => getAlertHistory(...a),
  listAlerts: (...a: unknown[]) => listAlerts(...a),
  deleteAlert: (...a: unknown[]) => deleteAlert(...a),
  updateAlert: (...a: unknown[]) => updateAlert(...a),
  testAlert: (...a: unknown[]) => testAlert(...a),
}));
const listAlerts = vi.fn();
const deleteAlert = vi.fn();
const updateAlert = vi.fn();
const testAlert = vi.fn();

vi.mock("../hooks/useAlertWebSocket", () => ({
  useAlertWebSocket: () => ({ lastAlert: null, connected: false, alerts: [] }),
}));
vi.mock("../components/monitoring/AlertBuilder", () => ({
  default: ({ onCancel }: { onCancel: () => void }) => (
    <div data-testid="alert-builder">
      <button onClick={onCancel}>builder-cancel</button>
    </div>
  ),
}));

import AlertHistory from "../components/monitoring/AlertHistory";
import AlertDashboard from "../components/monitoring/AlertDashboard";

describe("AlertHistory supplemental", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders '--' for a row without a tx hash and the matched summary", async () => {
    getAlertHistory.mockResolvedValue({
      history: [
        {
          id: 1,
          alert_id: 7,
          triggered_at: "2026-06-23T12:00:00",
          tx_hash: null,
          block_number: null,
          matched_data: { summary: "Balance dropped below 1000 PLS" },
        },
      ],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    renderWithProviders(
      <AlertHistory alertId={7} alertName="Quiet" onBack={vi.fn()} />,
    );
    expect(
      await screen.findByText("Balance dropped below 1000 PLS"),
    ).toBeInTheDocument();
    // tx hash + block both render the "--" / "--" fallbacks
    expect(screen.getAllByText("--").length).toBeGreaterThanOrEqual(2);
  });

  it("uses the default summary when matched_data has none", async () => {
    getAlertHistory.mockResolvedValue({
      history: [
        {
          id: 2,
          alert_id: 7,
          triggered_at: "2026-06-23T12:00:00",
          tx_hash: HASH,
          block_number: 26804492,
          matched_data: {},
        },
      ],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    renderWithProviders(
      <AlertHistory alertId={7} alertName="x" onBack={vi.fn()} />,
    );
    expect(await screen.findByText("Alert triggered")).toBeInTheDocument();
  });

  it("calls onBack when the Back button is clicked", async () => {
    getAlertHistory.mockResolvedValue({
      history: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
    });
    const onBack = vi.fn();
    renderWithProviders(
      <AlertHistory alertId={7} alertName="x" onBack={onBack} />,
    );
    await screen.findByText("No alert history yet.");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalled();
  });

  it("paginates Next/Previous and re-fetches with the new page", async () => {
    getAlertHistory.mockResolvedValue({
      history: [
        {
          id: 1,
          alert_id: 7,
          triggered_at: "2026-06-23T12:00:00",
          tx_hash: HASH,
          block_number: 26804492,
          matched_data: { summary: "s" },
        },
      ],
      pagination: { page: 1, limit: 20, total: 60, totalPages: 3 },
    });
    renderWithProviders(
      <AlertHistory alertId={7} alertName="x" onBack={vi.fn()} />,
    );
    await screen.findByText(/Page 1 of 3/);

    // Previous is disabled on page 1
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(getAlertHistory).toHaveBeenCalledWith(7, 2, 20));

    // Now Previous is enabled; go back.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Previous" })).not.toBeDisabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    await waitFor(() => expect(getAlertHistory).toHaveBeenCalledWith(7, 1, 20));
  });
});

// ------------------------------------------------------------------ AlertDashboard
function alertFix(id: number, overrides: Partial<Alert> = {}): Alert {
  return {
    id,
    name: `alert-${id}`,
    type: "address_activity",
    chainid: 369,
    conditions: {},
    notifications: [{ type: "webhook", url: "https://example.com/hook" }],
    enabled: true,
    cooldown_seconds: 30,
    last_triggered_at: "2026-06-23T12:00:00",
    created_at: "2026-01-01T00:00:00.000",
    updated_at: "2026-01-01T00:00:00.000",
    ...overrides,
  };
}
function statsFix(overrides: Partial<AlertStats> = {}): AlertStats {
  return { total: 1, active: 1, triggered_today: 0, ...overrides };
}

describe("AlertDashboard supplemental", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("renders the list error banner when listAlerts rejects", async () => {
    listAlerts.mockRejectedValue(new Error("backend down"));
    renderWithProviders(<AlertDashboard />);
    expect(await screen.findByText("backend down")).toBeInTheDocument();
  });

  it("renders 'last triggered' and channel count metadata on a card", async () => {
    listAlerts.mockResolvedValue({
      alerts: [alertFix(1)],
      stats: statsFix(),
    });
    renderWithProviders(<AlertDashboard />);
    await screen.findByText("alert-1");
    expect(screen.getByText(/Last triggered:/)).toBeInTheDocument();
    expect(screen.getByText(/Channels: 1/)).toBeInTheDocument();
  });

  it("opens the create view, then cancels back to the list", async () => {
    listAlerts.mockResolvedValue({ alerts: [], stats: statsFix({ total: 0 }) });
    renderWithProviders(<AlertDashboard />);
    await screen.findByText(/No alerts configured/);
    fireEvent.click(screen.getByRole("button", { name: "Create Alert" }));
    expect(screen.getByTestId("alert-builder")).toBeInTheDocument();
    fireEvent.click(screen.getByText("builder-cancel"));
    await screen.findByText(/No alerts configured/);
  });

  it("opens the edit view from a card, then cancels", async () => {
    listAlerts.mockResolvedValue({ alerts: [alertFix(1)], stats: statsFix() });
    renderWithProviders(<AlertDashboard />);
    await screen.findByText("alert-1");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByTestId("alert-builder")).toBeInTheDocument();
    fireEvent.click(screen.getByText("builder-cancel"));
    await screen.findByText("alert-1");
  });

  it("opens the history sub-view from a card, then goes back", async () => {
    listAlerts.mockResolvedValue({ alerts: [alertFix(1)], stats: statsFix() });
    getAlertHistory.mockResolvedValue({
      history: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
    });
    renderWithProviders(<AlertDashboard />);
    await screen.findByText("alert-1");
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    expect(await screen.findByText("History: alert-1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await screen.findByText("alert-1");
  });

  it("deletes an alert when confirm() is accepted", async () => {
    listAlerts.mockResolvedValue({ alerts: [alertFix(5)], stats: statsFix() });
    deleteAlert.mockResolvedValue(undefined);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderWithProviders(<AlertDashboard />);
    await screen.findByText("alert-5");
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(deleteAlert).toHaveBeenCalledWith(5));
  });

  it("does NOT delete when confirm() is cancelled", async () => {
    listAlerts.mockResolvedValue({ alerts: [alertFix(5)], stats: statsFix() });
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderWithProviders(<AlertDashboard />);
    await screen.findByText("alert-5");
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(deleteAlert).not.toHaveBeenCalled();
  });

  it("sends a test notification and alerts success", async () => {
    listAlerts.mockResolvedValue({ alerts: [alertFix(8)], stats: statsFix() });
    testAlert.mockResolvedValue(undefined);
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    renderWithProviders(<AlertDashboard />);
    await screen.findByText("alert-8");
    fireEvent.click(screen.getByRole("button", { name: "Test" }));
    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith("Test notification sent!"),
    );
  });

  it("alerts the failure message when test fails", async () => {
    listAlerts.mockResolvedValue({ alerts: [alertFix(8)], stats: statsFix() });
    testAlert.mockRejectedValue(new Error("smtp down"));
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    renderWithProviders(<AlertDashboard />);
    await screen.findByText("alert-8");
    fireEvent.click(screen.getByRole("button", { name: "Test" }));
    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith(
        expect.stringContaining("smtp down"),
      ),
    );
  });

  it("logs (but doesn't crash) when toggling enabled fails", async () => {
    listAlerts.mockResolvedValue({
      alerts: [alertFix(9, { enabled: false })],
      stats: statsFix(),
    });
    updateAlert.mockRejectedValue(new Error("nope"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    renderWithProviders(<AlertDashboard />);
    await screen.findByText("alert-9");
    fireEvent.click(screen.getByRole("button", { name: /Enable/i }));
    await waitFor(() => expect(errSpy).toHaveBeenCalled());
  });
});
