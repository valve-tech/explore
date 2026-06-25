import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, act } from "@testing-library/react";
import { renderWithProviders } from "./_test-utils";
import WatchNotifications from "../components/watcher/WatchNotifications";
import type { WatchMatch } from "../lib/watcher/types";

/**
 * App-level watcher mount. useWatchEngine is mocked to feed `latest` + a
 * pollers marker; the test drives the toast lifecycle (show on a new match,
 * dedupe by id, auto-dismiss) and the desktop-notification escalation call.
 */

const engineState = vi.hoisted(() => ({
  latest: null as WatchMatch | null,
  pollers: null as React.ReactNode,
}));
const showDesktop = vi.hoisted(() => vi.fn(() => true));
const navigateMock = vi.hoisted(() => vi.fn());

vi.mock("../hooks/useWatchEngine", () => ({
  useWatchEngine: () => engineState,
}));
vi.mock("../lib/watcher/desktopNotify", () => ({
  showDesktopNotification: showDesktop,
}));
vi.mock("react-router-dom", async (orig) => {
  const actual = await orig<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => navigateMock };
});

function match(over: Partial<WatchMatch> = {}): WatchMatch {
  return {
    id: "m1",
    ruleId: "r1",
    workspaceId: "w1",
    chainId: 369,
    kind: "address_activity",
    label: "Treasury watch",
    at: Date.now(),
    lead: "0xabc sent ",
    amount: null,
    trail: "to 0xdef",
    txHash: "0xfeed",
    ...over,
  };
}

beforeEach(() => {
  vi.useRealTimers();
  showDesktop.mockClear();
  navigateMock.mockClear();
  engineState.latest = null;
  engineState.pollers = <div data-testid="pollers" />;
});



describe("<WatchNotifications />", () => {
  it("renders the pollers and no toast when there is no match", () => {
    renderWithProviders(<WatchNotifications />);
    expect(screen.getByTestId("pollers")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("surfaces a toast + desktop notification for a new match", async () => {
    engineState.latest = match();
    renderWithProviders(<WatchNotifications />);

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByText("Treasury watch")).toBeInTheDocument();
    expect(screen.getByText(/0xabc sent to 0xdef/)).toBeInTheDocument();

    expect(showDesktop).toHaveBeenCalledTimes(1);
    const arg = (showDesktop.mock.calls[0] as unknown[])[0] as { title: string; tag: string; onClick: () => void };
    expect(arg.title).toBe("Treasury watch");
    expect(arg.tag).toBe("m1");
    // onClick routes to the match's deep link (/tx/:hash).
    arg.onClick();
    expect(navigateMock).toHaveBeenCalledWith("/tx/0xfeed");
  });

  it("replaces the toast (clearing the prior timer) when a second match arrives", () => {
    engineState.latest = match({ id: "m1", label: "First" });
    const { rerender } = renderWithProviders(<WatchNotifications />);
    expect(screen.getByText("First")).toBeInTheDocument();

    // A new match with a different id replaces the toast and clears the
    // still-pending dismiss timer (line 35 branch).
    engineState.latest = match({ id: "m2", label: "Second" });
    rerender(<WatchNotifications />);
    expect(screen.getByText("Second")).toBeInTheDocument();
    expect(screen.queryByText("First")).not.toBeInTheDocument();
    expect(showDesktop).toHaveBeenCalledTimes(2);
  });

  it("auto-dismisses the toast after 6s", async () => {
    vi.useFakeTimers();
    engineState.latest = match();
    renderWithProviders(<WatchNotifications />);
    // effect runs synchronously after render; toast shows.
    expect(screen.getByRole("alert")).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(6_000);
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    vi.useRealTimers();
  });
});
