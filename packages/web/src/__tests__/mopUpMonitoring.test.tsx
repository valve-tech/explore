import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor, fireEvent, act } from "@testing-library/react";
import { renderHook, act as hookAct } from "@testing-library/react";
import { renderWithProviders } from "./_test-utils";
import type { Alert, AlertStats } from "../api/alerts";
import type { AlertEvent } from "../hooks/useAlertWebSocket";

/**
 * Coverage mop-up for the monitoring feature. Targets specific uncovered
 * branches/statements in AlertDashboard, AlertBuilder, AlertHistory, and
 * useAlertWebSocket that the existing suites don't reach:
 *  - non-Error throw fallback arms (err instanceof Error ? … : "…")
 *  - console.error catch path on delete
 *  - the toast setTimeout callback + the clearTimeout-on-second-alert guard
 *  - handleSaved (setView list + refetch) via a child onSaved callback
 *  - AlertBuilder handleTypeChange (create vs edit) + cooldown NaN fallback
 *  - AlertHistory short-hash branch + pagination Next-button enabled/disabled
 */

// Single api/alerts mock: every consumer in this file (dashboard, builder,
// history) reads the same set of vi.fn()s. importOriginal preserves the types
// and any pass-through exports the components touch indirectly.
vi.mock("../api/alerts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/alerts")>()),
  listAlerts: vi.fn(),
  deleteAlert: vi.fn(),
  updateAlert: vi.fn(),
  testAlert: vi.fn(),
  createAlert: vi.fn(),
  getAlertHistory: vi.fn(),
}));

vi.mock("../lib/activeChain", () => ({ useActiveChainId: () => 369 }));
vi.mock("../lib/apiBase", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/apiBase")>()),
  wsUrl: (p: string) => `ws://test${p}`,
}));

const wsHolder: { lastAlert: AlertEvent | null } = { lastAlert: null };
vi.mock("../hooks/useAlertWebSocket", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../hooks/useAlertWebSocket")>()),
  useAlertWebSocket: () => ({
    lastAlert: wsHolder.lastAlert,
    connected: true,
    alerts: [],
  }),
}));

// NOTE: child components (AlertBuilder/AlertHistory) are NOT mocked — their
// real builds are exercised in their own describe blocks below, and the
// dashboard's handleSaved test drives the real AlertBuilder's save flow.

import AlertDashboard from "../components/monitoring/AlertDashboard";
import * as alertsApi from "../api/alerts";

const mockList = alertsApi.listAlerts as unknown as ReturnType<typeof vi.fn>;
const mockDelete = alertsApi.deleteAlert as unknown as ReturnType<typeof vi.fn>;
const mockTest = alertsApi.testAlert as unknown as ReturnType<typeof vi.fn>;
const mockCreate = alertsApi.createAlert as unknown as ReturnType<typeof vi.fn>;
const mockHistory = alertsApi.getAlertHistory as unknown as ReturnType<
  typeof vi.fn
>;

function mkAlert(id: number, overrides: Partial<Alert> = {}): Alert {
  return {
    id,
    name: `alert-${id}`,
    type: "address_activity",
    chainid: 369,
    conditions: {},
    notifications: [{ type: "webhook", url: "https://example.com/hook" }],
    enabled: true,
    cooldown_seconds: 30,
    last_triggered_at: null,
    created_at: "2026-01-01T00:00:00.000",
    updated_at: "2026-01-01T00:00:00.000",
    ...overrides,
  } as Alert;
}

function stats(overrides: Partial<AlertStats> = {}): AlertStats {
  return { total: 0, active: 0, triggered_today: 0, ...overrides };
}

function wsEvent(id: number, name = `live-${id}`): AlertEvent {
  return {
    type: "alert_triggered",
    data: {
      alert: { id, name, type: "function_call" },
      match: { summary: `live match for ${name}` },
    },
    ts: 1700000000 + id,
  };
}

// ---------------------------------------------------------------------------
// AlertDashboard
// ---------------------------------------------------------------------------
describe("<AlertDashboard /> mop-up", () => {
  beforeEach(() => {
    mockList.mockReset();
    mockDelete.mockReset();
    mockTest.mockReset();
    wsHolder.lastAlert = null;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // branch@57 false arm: listAlerts throws a non-Error → fallback message.
  it("uses the fallback load-error message when a non-Error is thrown", async () => {
    mockList.mockRejectedValue("boom-string");
    renderWithProviders(<AlertDashboard />);
    expect(
      await screen.findByText("Failed to load alerts"),
    ).toBeInTheDocument();
  });

  // stmt 116: console.error catch path when deleteAlert rejects.
  it("logs to console.error when deleting an alert fails", async () => {
    mockList.mockResolvedValue({
      alerts: [mkAlert(5)],
      stats: stats({ total: 1, active: 1 }),
    });
    mockDelete.mockRejectedValue(new Error("nope"));
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    renderWithProviders(<AlertDashboard />);
    await screen.findByText("alert-5");
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() =>
      expect(errSpy).toHaveBeenCalledWith(
        "Failed to delete alert:",
        expect.any(Error),
      ),
    );
    confirmSpy.mockRestore();
    errSpy.mockRestore();
  });

  // branch@126 false arm: testAlert rejects with a non-Error → "Unknown error".
  it("uses 'Unknown error' in the test-failed alert when a non-Error is thrown", async () => {
    mockList.mockResolvedValue({
      alerts: [mkAlert(8)],
      stats: stats({ total: 1, active: 1 }),
    });
    mockTest.mockRejectedValue("string-failure");
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});

    renderWithProviders(<AlertDashboard />);
    await screen.findByText("alert-8");
    fireEvent.click(screen.getByRole("button", { name: "Test" }));

    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith("Test failed: Unknown error"),
    );
    alertSpy.mockRestore();
  });

  // stmts 80,81: the toast dismiss setTimeout callback runs after 6s.
  it("clears the active toast after the 6s dismiss timer fires", () => {
    vi.useFakeTimers();
    mockList.mockResolvedValue({
      alerts: [mkAlert(1, { name: "existing" })],
      stats: stats({ total: 1, active: 1 }),
    });

    // Seed the WS alert before render so the toast effect fires on mount,
    // independent of the (fake-timer-throttled) initial fetch.
    wsHolder.lastAlert = wsEvent(99, "live-99");
    renderWithProviders(<AlertDashboard />);

    // Toast match summary is showing.
    expect(screen.getByText("live match for live-99")).toBeInTheDocument();

    // Advance past the 6s dismiss timer → setActiveToast(null) + timer = null.
    act(() => {
      vi.advanceTimersByTime(6000);
    });

    expect(
      screen.queryByText("live match for live-99"),
    ).not.toBeInTheDocument();
  });

  // stmt 76 + branch@75 true arm: a second WS alert while a timer is active
  // hits the clearTimeout(toastTimerRef.current) guard.
  it("clears the previous toast timer when a second alert arrives", async () => {
    vi.useFakeTimers();
    const clearSpy = vi.spyOn(globalThis, "clearTimeout");
    mockList.mockResolvedValue({
      alerts: [mkAlert(1, { name: "existing" })],
      stats: stats({ total: 1, active: 1 }),
    });

    // First alert is present at mount; the toast effect schedules a timer.
    wsHolder.lastAlert = wsEvent(101, "live-101");
    const { rerender } = renderWithProviders(<AlertDashboard />);

    const callsBefore = clearSpy.mock.calls.length;

    // Second alert arrives before the first timer elapses.
    act(() => {
      wsHolder.lastAlert = wsEvent(102, "live-102");
    });
    rerender(<AlertDashboard />);

    expect(clearSpy.mock.calls.length).toBeGreaterThan(callsBefore);
    clearSpy.mockRestore();
  });

  // stmts 132,133: handleSaved → setView({type:"list"}) + fetchAlerts refetch.
  // Uses the real AlertBuilder: a successful create fires onSaved → handleSaved.
  it("returns to the list and refetches after the builder saves", async () => {
    mockList
      .mockResolvedValueOnce({ alerts: [], stats: stats() })
      .mockResolvedValueOnce({
        alerts: [mkAlert(3, { name: "fresh" })],
        stats: stats({ total: 1, active: 1 }),
      });
    mockCreate.mockResolvedValue({ id: 3 });

    renderWithProviders(<AlertDashboard />);
    await screen.findByText(/No alerts configured/i);

    // Enter create view (list-view "Create Alert" button).
    fireEvent.click(screen.getByRole("button", { name: "Create Alert" }));

    // Real builder is shown — give it a name, then save (its own "Create
    // Alert" button), which resolves createAlert and calls onSaved.
    fireEvent.change(
      await screen.findByPlaceholderText("e.g., Large Transfer Monitor"),
      { target: { value: "fresh" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Create Alert" }));

    // Back on the list view, the refetch result is rendered.
    expect(await screen.findByText("fresh")).toBeInTheDocument();
    expect(mockList).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// AlertBuilder (real children)
// ---------------------------------------------------------------------------
import AlertBuilderReal from "../components/monitoring/AlertBuilder";

describe("AlertBuilder mop-up", () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  // stmts 50,51 + branch@51 true arm: handleTypeChange in create mode resets
  // conditions ({}).
  it("changes the alert type and resets conditions in create mode", async () => {
    renderWithProviders(
      <AlertBuilderReal onSaved={vi.fn()} onCancel={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Alert type" }));
    fireEvent.click(
      await screen.findByRole("option", { name: "Function Call" }),
    );
    expect(
      screen.getByRole("button", { name: "Alert type" }),
    ).toHaveTextContent("Function Call");
  });

  // branch@51 false arm: handleTypeChange in edit mode does NOT reset.
  it("changes the alert type without resetting conditions in edit mode", async () => {
    const alert = {
      id: 7,
      name: "Existing",
      type: "address_activity",
      conditions: {},
      notifications: [],
      cooldown_seconds: 120,
      enabled: true,
    } as unknown as Alert;
    renderWithProviders(
      <AlertBuilderReal alert={alert} onSaved={vi.fn()} onCancel={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Alert type" }));
    fireEvent.click(
      await screen.findByRole("option", { name: "Failed Transaction" }),
    );
    expect(
      screen.getByRole("button", { name: "Alert type" }),
    ).toHaveTextContent("Failed Transaction");
  });

  // branch@64: cooldown that does not parse → `|| 60` fallback.
  it("falls back to a 60s cooldown when the cooldown field is non-numeric", async () => {
    mockCreate.mockResolvedValue({ id: 1 });
    renderWithProviders(
      <AlertBuilderReal onSaved={vi.fn()} onCancel={vi.fn()} />,
    );
    fireEvent.change(
      screen.getByPlaceholderText("e.g., Large Transfer Monitor"),
      { target: { value: "named" } },
    );
    // Clear the cooldown so parseInt("", 10) → NaN → || 60.
    fireEvent.change(screen.getByPlaceholderText("60"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create Alert" }));

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    const [payload] = mockCreate.mock.calls[0]!;
    expect(payload).toMatchObject({ cooldown_seconds: 60 });
  });

  // branch@73 false arm: createAlert rejects with a non-Error → fallback msg.
  it("uses the fallback save-error message on a non-Error rejection", async () => {
    mockCreate.mockRejectedValue("string-error");
    renderWithProviders(
      <AlertBuilderReal onSaved={vi.fn()} onCancel={vi.fn()} />,
    );
    fireEvent.change(
      screen.getByPlaceholderText("e.g., Large Transfer Monitor"),
      { target: { value: "named" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Create Alert" }));
    expect(await screen.findByText("Failed to save alert")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// AlertHistory
// ---------------------------------------------------------------------------
import AlertHistory from "../components/monitoring/AlertHistory";

describe("AlertHistory mop-up", () => {
  beforeEach(() => {
    mockHistory.mockReset();
  });

  // stmt 59 + branch@59 true arm: a short hash (<= 16) returns unchanged.
  it("renders a short tx hash unchanged (no truncation)", async () => {
    const shortHash = "0x1234abcd"; // length 10 <= 16
    mockHistory.mockResolvedValue({
      history: [
        {
          id: 1,
          alert_id: 7,
          triggered_at: "2026-06-23T12:00:00",
          tx_hash: shortHash,
          block_number: 100,
          matched_data: {},
        },
      ],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });

    renderWithProviders(
      <AlertHistory alertId={7} alertName="Short" onBack={vi.fn()} />,
    );
    expect(await screen.findByText(shortHash)).toBeInTheDocument();
  });

  // branch@39 false arm: getAlertHistory rejects with a non-Error → fallback.
  it("uses the fallback fetch-error message on a non-Error rejection", async () => {
    mockHistory.mockRejectedValue("oops");
    renderWithProviders(
      <AlertHistory alertId={7} alertName="Broken" onBack={vi.fn()} />,
    );
    await waitFor(() =>
      expect(screen.getByText("Failed to fetch history")).toBeInTheDocument(),
    );
  });

  // branches@213,217,218: pagination Next button enabled (page 1) then
  // disabled (last page) — exercises both arms of the page>=totalPages ternaries.
  it("toggles the Next button between enabled and disabled across pages", async () => {
    mockHistory
      .mockResolvedValueOnce({
        history: [
          {
            id: 1,
            alert_id: 7,
            triggered_at: "2026-06-23T12:00:00",
            tx_hash: "0x1234abcd",
            block_number: 1,
            matched_data: {},
          },
        ],
        pagination: { page: 1, limit: 20, total: 2, totalPages: 2 },
      })
      .mockResolvedValueOnce({
        history: [
          {
            id: 2,
            alert_id: 7,
            triggered_at: "2026-06-23T12:01:00",
            tx_hash: "0x5678ef01",
            block_number: 2,
            matched_data: {},
          },
        ],
        pagination: { page: 2, limit: 20, total: 2, totalPages: 2 },
      });

    renderWithProviders(
      <AlertHistory alertId={7} alertName="Paged" onBack={vi.fn()} />,
    );

    // On page 1, Next is enabled (page < totalPages).
    const next = await screen.findByRole("button", { name: "Next" });
    expect(next).not.toBeDisabled();

    fireEvent.click(next);

    // After moving to page 2 (last page), Next becomes disabled.
    await waitFor(() => expect(mockHistory).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Next" })).toBeDisabled(),
    );
  });
});

// ---------------------------------------------------------------------------
// useAlertWebSocket — real hook (un-mock by importing through importOriginal)
// ---------------------------------------------------------------------------
type WsHandler = (ev: unknown) => void;

class FakeWS {
  static instances: FakeWS[] = [];
  url: string;
  closed = false;
  handlers: Record<string, WsHandler[]> = {};
  constructor(url: string) {
    this.url = url;
    FakeWS.instances.push(this);
  }
  addEventListener(type: string, cb: WsHandler) {
    (this.handlers[type] ??= []).push(cb);
  }
  close() {
    this.closed = true;
  }
  emit(type: string, ev?: unknown) {
    for (const cb of this.handlers[type] ?? []) cb(ev);
  }
}

describe("useAlertWebSocket mop-up", () => {
  beforeEach(() => {
    FakeWS.instances = [];
    vi.stubGlobal("WebSocket", FakeWS as unknown as typeof WebSocket);
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  // Reconnect re-enters connect() after a close while mounted, exercising the
  // line-61 guard (false arm) on the reconnect-driven call.
  it("reconnects via connect() after a close while mounted", async () => {
    const { useAlertWebSocket: realHook } = await vi.importActual<
      typeof import("../hooks/useAlertWebSocket")
    >("../hooks/useAlertWebSocket");

    const { unmount } = renderHook(() => realHook());
    expect(FakeWS.instances).toHaveLength(1);
    hookAct(() => FakeWS.instances.at(-1)!.emit("close"));
    hookAct(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(FakeWS.instances).toHaveLength(2);
    // Unmount while still on fake timers so the effect cleanup clears any
    // pending reconnect timer and closes the socket — otherwise a stray
    // macrotask can fire after the jsdom env tears down ("window is not
    // defined" leaking into a later test file).
    hookAct(() => unmount());
  });
});
