import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

/**
 * ActionLogs — fetches an action's execution log page and renders it. We mock
 * getActionLogs and assert the loaded rows (trigger type parsed from
 * trigger_data, duration, total) plus the empty state and refresh.
 */
const getActionLogs = vi.fn();
vi.mock("../api/actions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/actions")>()),
  getActionLogs: (...a: unknown[]) => getActionLogs(...a),
}));

import ActionLogs from "../components/actions/ActionLogs";

const row = {
  id: 1,
  action_id: 5,
  triggered_at: "2026-06-23T12:00:00",
  duration_ms: 123,
  success: 1,
  stdout: "ok",
  stderr: "",
  trigger_data: JSON.stringify({ type: "block" }),
};

beforeEach(() => vi.clearAllMocks());

describe("ActionLogs", () => {
  it("renders a log row with trigger type, duration, and total", async () => {
    getActionLogs.mockResolvedValue({ rows: [row], total: 1, page: 1, limit: 15 });
    render(<ActionLogs actionId={5} actionName="My Action" onBack={vi.fn()} />);

    expect(screen.getByText("Logs: My Action")).toBeInTheDocument();
    expect(await screen.findByText("block")).toBeInTheDocument(); // parsed from trigger_data
    expect(screen.getByText("123ms")).toBeInTheDocument();
    expect(screen.getByText("(1 total)")).toBeInTheDocument();
    expect(getActionLogs).toHaveBeenCalledWith(5, 1, 15);
  });

  it("shows the empty state when there are no logs", async () => {
    getActionLogs.mockResolvedValue({ rows: [], total: 0, page: 1, limit: 15 });
    render(<ActionLogs actionId={5} actionName="Quiet" onBack={vi.fn()} />);
    expect(await screen.findByText("No execution logs yet")).toBeInTheDocument();
  });

  it("refetches when Refresh is clicked", async () => {
    getActionLogs.mockResolvedValue({ rows: [], total: 0, page: 1, limit: 15 });
    render(<ActionLogs actionId={5} actionName="X" onBack={vi.fn()} />);
    await waitFor(() => expect(getActionLogs).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByText("Refresh"));
    await waitFor(() => expect(getActionLogs).toHaveBeenCalledTimes(2));
  });

  it("Back calls onBack", async () => {
    getActionLogs.mockResolvedValue({ rows: [], total: 0, page: 1, limit: 15 });
    const onBack = vi.fn();
    render(<ActionLogs actionId={5} actionName="X" onBack={onBack} />);
    fireEvent.click(screen.getByText("Back"));
    expect(onBack).toHaveBeenCalled();
  });
});
