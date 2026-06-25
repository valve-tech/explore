import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "./_test-utils";
import { BackHistoryControl } from "../components/RecentMenu";
import type { RecentEntity } from "../lib/recentEntities";

/**
 * Split back-button control in the top bar: the arrow goes back, the caret
 * opens a Recent & Pinned dropdown. Drives the open/close (outside-click +
 * Escape), the back-disabled state, navigate-on-row, clear, and pin toggle.
 * Anchored on PulseChain (369) — https://scan.pulsechain.com.
 */
const WPLS = "0xa1077a294dde1b09bb078844df40758a5d0f9a27";
const TX = "0x" + "ef".repeat(32);

const togglePin = vi.fn();
const clearRecent = vi.fn();
let store: RecentEntity[] = [];

vi.mock("../hooks/useRecentEntities", () => ({
  useRecentEntities: () => store,
}));
vi.mock("../lib/recentEntities", async (orig) => {
  const actual = await orig<typeof import("../lib/recentEntities")>();
  return {
    ...actual,
    togglePin: (...a: unknown[]) => togglePin(...a),
    clearRecent: () => clearRecent(),
  };
});
const navigate = vi.fn();
vi.mock("react-router-dom", async (orig) => {
  const actual = await orig<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => navigate };
});

function ent(over: Partial<RecentEntity>): RecentEntity {
  return {
    kind: "address",
    value: WPLS,
    pinned: false,
    visits: 1,
    lastSeen: Date.now(),
    ...over,
  };
}

describe("<BackHistoryControl />", () => {
  beforeEach(() => {
    store = [];
    togglePin.mockClear();
    clearRecent.mockClear();
    navigate.mockClear();
  });

  it("the back button is disabled when there's no history, enabled otherwise", () => {
    const onBack = vi.fn();
    const { rerender } = renderWithProviders(
      <BackHistoryControl canGoBack={false} onBack={onBack} />,
    );
    expect(screen.getByRole("button", { name: "Go back" })).toBeDisabled();

    rerender(<BackHistoryControl canGoBack onBack={onBack} />);
    const back = screen.getByRole("button", { name: "Go back" });
    expect(back).toBeEnabled();
    fireEvent.click(back);
    expect(onBack).toHaveBeenCalled();
  });

  it("opens the dropdown and shows the empty hint when nothing is stored", () => {
    renderWithProviders(<BackHistoryControl canGoBack={false} onBack={vi.fn()} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Recent and pinned history" }),
    );
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByText(/Nothing viewed yet\./)).toBeInTheDocument();
  });

  it("lists Pinned + Recent groups, navigates on a row, and closes", () => {
    store = [
      ent({ kind: "address", value: WPLS, pinned: true, label: "WPLS" }),
      ent({ kind: "tx", value: TX, status: "success" }),
    ];
    renderWithProviders(<BackHistoryControl canGoBack onBack={vi.fn()} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Recent and pinned history" }),
    );
    expect(screen.getByText("★ Pinned")).toBeInTheDocument();
    expect(screen.getByText("Recent")).toBeInTheDocument();

    fireEvent.click(screen.getByText("WPLS"));
    expect(navigate).toHaveBeenCalledWith(`/address/${WPLS}`);
    // Navigating closes the menu.
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("'Clear recent' calls the store mutation (only shown with recents)", () => {
    store = [ent({ kind: "tx", value: TX })];
    renderWithProviders(<BackHistoryControl canGoBack onBack={vi.fn()} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Recent and pinned history" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear recent" }));
    expect(clearRecent).toHaveBeenCalled();
  });

  it("the pin star toggles without navigating", () => {
    store = [ent({ kind: "address", value: WPLS })];
    renderWithProviders(<BackHistoryControl canGoBack onBack={vi.fn()} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Recent and pinned history" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Pin" }));
    expect(togglePin).toHaveBeenCalledWith("address", WPLS);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("Escape closes the open dropdown", () => {
    store = [ent({ kind: "tx", value: TX })];
    renderWithProviders(<BackHistoryControl canGoBack onBack={vi.fn()} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Recent and pinned history" }),
    );
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("a mousedown INSIDE the open dropdown keeps it open", () => {
    store = [ent({ kind: "tx", value: TX })];
    renderWithProviders(<BackHistoryControl canGoBack onBack={vi.fn()} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Recent and pinned history" }),
    );
    // Click within the menu → ref.contains(target) is true → stays open.
    fireEvent.mouseDown(screen.getByRole("menu"));
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("an unrelated keydown does not close the open dropdown", () => {
    store = [ent({ kind: "tx", value: TX })];
    renderWithProviders(<BackHistoryControl canGoBack onBack={vi.fn()} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Recent and pinned history" }),
    );
    fireEvent.keyDown(document, { key: "a" });
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("an outside mousedown closes the open dropdown", () => {
    store = [ent({ kind: "tx", value: TX })];
    renderWithProviders(<BackHistoryControl canGoBack onBack={vi.fn()} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Recent and pinned history" }),
    );
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
