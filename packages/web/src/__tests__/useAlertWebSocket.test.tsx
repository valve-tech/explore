import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

/**
 * useAlertWebSocket — connects to /ws/alerts, tracks connected state, buffers
 * the last 50 alert_triggered events, and auto-reconnects 5s after a close. We
 * install a fake WebSocket that captures addEventListener handlers so we can
 * drive open/message/error/close deterministically, and fake timers for the
 * reconnect. We mock wsUrl to a stable URL.
 *
 * Pure transport/UI plumbing — alert payloads are realistic fixtures.
 */

vi.mock("../lib/apiBase", () => ({ wsUrl: (p: string) => `ws://test${p}` }));

import { useAlertWebSocket } from "../hooks/useAlertWebSocket";

type Handler = (ev: unknown) => void;

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  url: string;
  readyState = 0;
  closed = false;
  handlers: Record<string, Handler[]> = {};
  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }
  addEventListener(type: string, cb: Handler) {
    (this.handlers[type] ??= []).push(cb);
  }
  close() {
    this.closed = true;
  }
  emit(type: string, ev?: unknown) {
    for (const cb of this.handlers[type] ?? []) cb(ev);
  }
}

const ALERT_EVENT = {
  type: "alert_triggered",
  data: {
    alert: { id: 1, name: "Whale moved", type: "address_activity", chainId: 369 },
    match: { summary: "0xabc sent 100 PLS" },
  },
  ts: 1700000000,
};

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeWebSocket as unknown as typeof WebSocket);
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function latest(): FakeWebSocket {
  return FakeWebSocket.instances.at(-1)!;
}

describe("useAlertWebSocket", () => {
  it("connects to /ws/alerts and flips connected on open", () => {
    const { result } = renderHook(() => useAlertWebSocket());
    expect(latest().url).toBe("ws://test/ws/alerts");
    expect(result.current.connected).toBe(false);

    act(() => latest().emit("open"));
    expect(result.current.connected).toBe(true);
  });

  it("buffers alert_triggered messages newest-first and tracks lastAlert", () => {
    const { result } = renderHook(() => useAlertWebSocket());
    act(() => latest().emit("open"));

    act(() =>
      latest().emit("message", { data: JSON.stringify(ALERT_EVENT) } as MessageEvent),
    );
    expect(result.current.lastAlert?.data.alert.name).toBe("Whale moved");
    expect(result.current.alerts).toHaveLength(1);

    const second = { ...ALERT_EVENT, ts: 1700000001 };
    act(() =>
      latest().emit("message", { data: JSON.stringify(second) } as MessageEvent),
    );
    expect(result.current.alerts).toHaveLength(2);
    // newest-first
    expect(result.current.alerts[0]?.ts).toBe(1700000001);
  });

  it("ignores non-JSON and non-alert messages", () => {
    const { result } = renderHook(() => useAlertWebSocket());
    act(() => latest().emit("message", { data: "not json{" } as MessageEvent));
    act(() =>
      latest().emit("message", {
        data: JSON.stringify({ type: "heartbeat" }),
      } as MessageEvent),
    );
    act(() =>
      latest().emit("message", { data: JSON.stringify(null) } as MessageEvent),
    );
    expect(result.current.alerts).toHaveLength(0);
    expect(result.current.lastAlert).toBeNull();
  });

  it("caps the buffer at 50 events", () => {
    const { result } = renderHook(() => useAlertWebSocket());
    act(() => {
      for (let i = 0; i < 60; i++) {
        latest().emit("message", {
          data: JSON.stringify({ ...ALERT_EVENT, ts: i }),
        } as MessageEvent);
      }
    });
    expect(result.current.alerts).toHaveLength(50);
    // newest (ts 59) at the front
    expect(result.current.alerts[0]?.ts).toBe(59);
  });

  it("error sets connected false without scheduling a reconnect", () => {
    const { result } = renderHook(() => useAlertWebSocket());
    act(() => latest().emit("open"));
    expect(result.current.connected).toBe(true);
    act(() => latest().emit("error"));
    expect(result.current.connected).toBe(false);
  });

  it("auto-reconnects 5s after a close", () => {
    renderHook(() => useAlertWebSocket());
    expect(FakeWebSocket.instances).toHaveLength(1);

    act(() => latest().emit("close"));
    expect(FakeWebSocket.instances).toHaveLength(1); // not yet

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(FakeWebSocket.instances).toHaveLength(2); // reconnected
  });

  it("clears a pending reconnect timer on unmount", () => {
    const { unmount } = renderHook(() => useAlertWebSocket());
    // A close schedules a reconnect timer...
    act(() => latest().emit("close"));
    // ...which unmount must clear (covers the timer-present cleanup branch).
    unmount();
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(FakeWebSocket.instances).toHaveLength(1); // no reconnect fired
  });

  it("closes the socket and stops reconnecting on unmount", () => {
    const { unmount } = renderHook(() => useAlertWebSocket());
    const ws = latest();
    unmount();
    expect(ws.closed).toBe(true);

    // A close after unmount must not schedule a reconnect (unmountedRef guard).
    act(() => ws.emit("close"));
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("ignores events that arrive after unmount", () => {
    const { result, unmount } = renderHook(() => useAlertWebSocket());
    const ws = latest();
    unmount();
    // open / message / error handlers all early-return on the unmounted guard.
    act(() => ws.emit("open"));
    act(() =>
      ws.emit("message", { data: JSON.stringify(ALERT_EVENT) } as MessageEvent),
    );
    act(() => ws.emit("error"));
    expect(result.current.connected).toBe(false);
    expect(result.current.alerts).toHaveLength(0);
  });
});
