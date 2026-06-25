import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "./_test-utils";

/**
 * AlertHistory — fetches an alert's trigger history and renders it. We mock
 * getAlertHistory and assert the loaded rows (real WPLS tx hash, truncated) plus
 * the empty + error states.
 */

const getAlertHistory = vi.fn();
vi.mock("../api/alerts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/alerts")>()),
  getAlertHistory: (...a: unknown[]) => getAlertHistory(...a),
}));

import AlertHistory from "../components/monitoring/AlertHistory";

const HASH = "0xd515ef07d4308c389b05fe13c55ac1ebe3270bd8bbf4470b0a134a1766fe3c81";

beforeEach(() => vi.clearAllMocks());

describe("AlertHistory", () => {
  it("renders a trigger row with the truncated tx hash + block", async () => {
    getAlertHistory.mockResolvedValue({
      history: [
        {
          id: 1,
          alert_id: 7,
          triggered_at: "2026-06-23T12:00:00",
          tx_hash: HASH,
          block_number: 26804224,
          matched_data: {},
        },
      ],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });

    renderWithProviders(
      <AlertHistory alertId={7} alertName="Whale watch" onBack={vi.fn()} />,
    );

    expect(screen.getByText("History: Whale watch")).toBeInTheDocument();
    // truncateHash: 0x + first 8 + … + last 6
    expect(await screen.findByText("0xd515ef07...fe3c81")).toBeInTheDocument();
    expect(screen.getByText("26,804,224")).toBeInTheDocument();
    expect(getAlertHistory).toHaveBeenCalledWith(7, 1, 20);
  });

  it("shows an empty state when there's no history", async () => {
    getAlertHistory.mockResolvedValue({
      history: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
    });
    renderWithProviders(
      <AlertHistory alertId={7} alertName="Quiet" onBack={vi.fn()} />,
    );
    expect(await screen.findByText("No alert history yet.")).toBeInTheDocument();
  });

  it("shows an error when the fetch fails", async () => {
    getAlertHistory.mockRejectedValue(new Error("history unavailable"));
    renderWithProviders(
      <AlertHistory alertId={7} alertName="Broken" onBack={vi.fn()} />,
    );
    await waitFor(() =>
      expect(screen.getByText("history unavailable")).toBeInTheDocument(),
    );
  });
});
