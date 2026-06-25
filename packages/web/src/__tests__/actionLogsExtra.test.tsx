import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import type { ActionLog } from "../api/actions";

/**
 * ActionLogs — supplemental coverage for the rows not exercised by
 * ActionLogs.test.tsx: row expand/collapse rendering stdout / stderr /
 * trigger-data, pagination (Next/Previous + page math), and the fetch-error
 * catch. Kept in a separate file so the original ActionLogs.test.tsx stays
 * untouched.
 *
 * Trigger types are block/event/periodic/webhook. Chain explorer:
 * https://scan.pulsechain.com
 */

const getActionLogs = vi.fn();
vi.mock("../api/actions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/actions")>()),
  getActionLogs: (...a: unknown[]) => getActionLogs(...a),
}));

import ActionLogs from "../components/actions/ActionLogs";

function logRow(over: Partial<ActionLog> = {}): ActionLog {
  return {
    id: 1,
    action_id: 5,
    triggered_at: "2026-06-23T12:00:00",
    duration_ms: 42,
    success: 1,
    stdout: "hello stdout",
    stderr: "",
    trigger_data: JSON.stringify({ type: "event", blockNumber: 26804492 }),
    ...over,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("ActionLogs — expand + pagination", () => {
  it("expands a row to show stdout and trigger data, then collapses", async () => {
    getActionLogs.mockResolvedValue({ rows: [logRow()], total: 1, page: 1, limit: 15 });
    render(<ActionLogs actionId={5} actionName="Watcher" onBack={vi.fn()} />);

    const triggerCell = await screen.findByText("event");
    fireEvent.click(triggerCell);
    expect(await screen.findByText("hello stdout")).toBeInTheDocument();
    expect(screen.getByText("stdout")).toBeInTheDocument();
    // trigger data is non-empty JSON → rendered pretty
    expect(screen.getByText("Trigger Data")).toBeInTheDocument();

    // collapse
    fireEvent.click(triggerCell);
    await waitFor(() => expect(screen.queryByText("hello stdout")).not.toBeInTheDocument());
  });

  it("renders stderr and the Error status badge for a failed run", async () => {
    getActionLogs.mockResolvedValue({
      rows: [logRow({ success: 0, stdout: "", stderr: "boom stderr" })],
      total: 1,
      page: 1,
      limit: 15,
    });
    render(<ActionLogs actionId={5} actionName="Watcher" onBack={vi.fn()} />);
    expect(await screen.findByText("Error")).toBeInTheDocument();
    fireEvent.click(screen.getByText("event"));
    expect(await screen.findByText("boom stderr")).toBeInTheDocument();
    expect(screen.getByText("stderr")).toBeInTheDocument();
  });

  it("falls back to 'unknown' trigger type on malformed trigger_data", async () => {
    getActionLogs.mockResolvedValue({
      rows: [logRow({ trigger_data: "not-json" })],
      total: 1,
      page: 1,
      limit: 15,
    });
    render(<ActionLogs actionId={5} actionName="Watcher" onBack={vi.fn()} />);
    expect(await screen.findByText("unknown")).toBeInTheDocument();
  });

  it("paginates through pages with Next / Previous", async () => {
    // total 30, limit 15 → 2 pages
    getActionLogs.mockResolvedValue({ rows: [logRow()], total: 30, page: 1, limit: 15 });
    render(<ActionLogs actionId={5} actionName="Watcher" onBack={vi.fn()} />);
    await screen.findByText("event");
    expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Next"));
    await waitFor(() => expect(getActionLogs).toHaveBeenCalledWith(5, 2, 15));
    expect(await screen.findByText("Page 2 of 2")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Previous"));
    await waitFor(() => expect(getActionLogs).toHaveBeenCalledWith(5, 1, 15));
  });

  it("exercises Back / Refresh / row hover handlers", async () => {
    getActionLogs.mockResolvedValue({ rows: [logRow()], total: 1, page: 1, limit: 15 });
    render(<ActionLogs actionId={5} actionName="Watcher" onBack={vi.fn()} />);
    await screen.findByText("event");
    for (const label of ["Back", "Refresh"]) {
      const btn = screen.getByText(label);
      fireEvent.mouseOver(btn);
      fireEvent.mouseOut(btn);
    }
    // the clickable log row also has hover handlers
    const rowCell = screen.getByText("event").parentElement!;
    fireEvent.mouseOver(rowCell);
    fireEvent.mouseOut(rowCell);
    expect(screen.getByText("event")).toBeInTheDocument();
  });

  it("logs an error when getActionLogs rejects", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    getActionLogs.mockRejectedValue(new Error("logs down"));
    render(<ActionLogs actionId={5} actionName="Watcher" onBack={vi.fn()} />);
    await waitFor(() => expect(spy).toHaveBeenCalledWith("Failed to fetch logs:", expect.any(Error)));
    spy.mockRestore();
  });
});
