import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "./_test-utils";
import { RecentRail } from "../components/RecentRail";
import type { RecentEntity } from "../lib/recentEntities";

/**
 * Landing "Jump back in" rail. Reads the shared recent-entities store (mocked
 * here) and groups Pinned above Recent. Clicking a row navigates; the star
 * toggles the pin. Anchored on PulseChain (369) — WPLS address +  a tx hash,
 * https://scan.pulsechain.com.
 */
const WPLS = "0xa1077a294dde1b09bb078844df40758a5d0f9a27";
const TX = "0x" + "cd".repeat(32);

const togglePin = vi.fn();
let store: RecentEntity[] = [];

vi.mock("../hooks/useRecentEntities", () => ({
  useRecentEntities: () => store,
}));
vi.mock("../lib/recentEntities", async (orig) => {
  const actual = await orig<typeof import("../lib/recentEntities")>();
  return { ...actual, togglePin: (...a: unknown[]) => togglePin(...a) };
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

describe("<RecentRail />", () => {
  beforeEach(() => {
    store = [];
    togglePin.mockClear();
    navigate.mockClear();
  });

  it("renders the empty state when nothing has been viewed", () => {
    renderWithProviders(<RecentRail />);
    expect(screen.getByText("Nothing viewed yet")).toBeInTheDocument();
  });

  it("groups Pinned above Recent and shows the total count", () => {
    store = [
      ent({ kind: "address", value: WPLS, pinned: true, label: "WPLS" }),
      ent({ kind: "tx", value: TX, status: "success" }),
    ];
    renderWithProviders(<RecentRail />);
    expect(screen.getByText("★ Pinned")).toBeInTheDocument();
    expect(screen.getByText("Recent")).toBeInTheDocument();
    // Count badge.
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("WPLS")).toBeInTheDocument();
  });

  it("clicking a row navigates to its scan path", () => {
    store = [ent({ kind: "tx", value: TX, status: "reverted" })];
    renderWithProviders(<RecentRail />);
    fireEvent.click(screen.getByText(/0x/).closest("div")!.parentElement!);
    expect(navigate).toHaveBeenCalledWith(`/tx/${TX}`);
  });

  it("clicking the star toggles the pin (without navigating)", () => {
    store = [ent({ kind: "address", value: WPLS })];
    renderWithProviders(<RecentRail />);
    fireEvent.click(screen.getByRole("button", { name: "Pin" }));
    expect(togglePin).toHaveBeenCalledWith("address", WPLS);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("renders the Unpin affordance for a pinned entity", () => {
    store = [ent({ kind: "block", value: "19000000", pinned: true })];
    renderWithProviders(<RecentRail />);
    expect(screen.getByRole("button", { name: "Unpin" })).toBeInTheDocument();
  });
});
