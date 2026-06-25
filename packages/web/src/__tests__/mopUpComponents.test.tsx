import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "./_test-utils";
import type { RecentEntity } from "../lib/recentEntities";
import type { StateDiff } from "../api/simulate";
import type { DiffResult } from "../components/ContractDiff/types";

/**
 * Coverage mop-up: drives the last few uncovered statement branches across a
 * handful of components, each of which already has a dedicated test file. The
 * cases here target paths the existing suites don't reach — a same-address
 * storage-grouping push, the in-palette drop-overlay onComplete, a re-expand
 * toggle, a stale-validity simulate guard, and a recent-row navigate callback.
 *
 * Chain anchors mirror PulseChain (369) — https://scan.pulsechain.com:
 *   WPLS 0xA1077a294dDE1B09bB078844df40758a5D0f9a27
 */
const WPLS = "0xA1077a294dDE1B09bB078844df40758a5D0f9a27";
const WPLS_LC = "0xa1077a294dde1b09bb078844df40758a5d0f9a27";
const ADDR_B = "0x95B303987A60C71504D99Aa1b13B4DA07b0790ab";

/* ----------------------------- shared mocks ----------------------------- */

// One recent store shared by CommandPalette + RecentMenu (both read the hook).
let recents: RecentEntity[] = [];
vi.mock("../hooks/useRecentEntities", () => ({
  useRecentEntities: () => recents,
}));

const navigate = vi.fn();
vi.mock("react-router-dom", async (orig) => {
  const actual = await orig<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => navigate };
});

// Stub the palette drop overlay so we can fire its onComplete directly — that
// is the inline callback CommandPalette passes ({ setIsDragging(false);
// onClose(); }, lines 80-81). Render a button only while `visible`.
vi.mock("../components/workspace/PaletteWorkspaceDropZone", () => ({
  PaletteWorkspaceDropZone: ({
    visible,
    onComplete,
  }: {
    visible: boolean;
    onComplete: () => void;
  }) => (visible ? <button onClick={onComplete}>__complete-drop</button> : null),
  PALETTE_ENTITY_MIME: "application/x-explore-entity",
}));

const fetchDiff = vi.fn();
vi.mock("../components/ContractDiff/api", async () => {
  const actual = await vi.importActual<
    typeof import("../components/ContractDiff/api")
  >("../components/ContractDiff/api");
  return { ...actual, fetchDiff: (...a: unknown[]) => fetchDiff(...a) };
});

import StateDiffPanel from "../components/StateDiffPanel";
import { CommandPalette } from "../components/AppShell/CommandPalette";
import ContractDiff from "../components/ContractDiff";
import { BackHistoryControl } from "../components/RecentMenu";

function ent(over: Partial<RecentEntity>): RecentEntity {
  return {
    kind: "address",
    value: WPLS_LC,
    pinned: false,
    visits: 1,
    lastSeen: Date.now(),
    ...over,
  };
}

beforeEach(() => {
  recents = [];
  navigate.mockClear();
  vi.clearAllMocks();
});
afterEach(() => vi.restoreAllMocks());

/* ------------------------------------------------------------------ */
/* StateDiffPanel — stmts 315,317 (existing storage group → push)      */
/* ------------------------------------------------------------------ */

describe("StateDiffPanel — same-address storage grouping", () => {
  it("pushes a second change into the existing group when addresses match", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        ({
          ok: false,
          status: 404,
          json: async () => ({ ok: false, storageLayout: undefined }),
        }) as Response,
    );
    const diff: StateDiff = {
      balanceChanges: [],
      storageChanges: [
        { address: WPLS, contractName: "WPLS", slot: "0x1", before: "0x0", after: "0x1" },
        { address: WPLS, contractName: "WPLS", slot: "0x2", before: "0x0", after: "0x2" },
      ],
      nonceChanges: [],
    };
    renderWithProviders(<StateDiffPanel stateDiff={diff} />);
    // Two changes share an address → a single group with a "2 slots" count.
    expect(await screen.findByText("2 slots")).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------ */
/* CommandPalette — stmts 80,81 (drop-overlay onComplete callback)     */
/* ------------------------------------------------------------------ */

describe("CommandPalette — drop-overlay onComplete", () => {
  it("completing a workspace drop clears dragging and closes the palette", () => {
    recents = [ent({ value: WPLS_LC, label: "WPLS" })];
    const onClose = vi.fn();
    renderWithProviders(<CommandPalette onClose={onClose} />);

    // Start a drag on the recent row → isDragging true → overlay visible.
    const row = screen.getByText("WPLS").closest("[draggable='true']")!;
    fireEvent.dragStart(row, {
      dataTransfer: { setData: vi.fn(), effectAllowed: "" },
    });
    // Fire the overlay's onComplete → setIsDragging(false) + onClose().
    fireEvent.click(screen.getByText("__complete-drop"));
    expect(onClose).toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/* ContractDiff — stmt 41 (toggleFile re-expand / add branch)          */
/* ------------------------------------------------------------------ */

describe("ContractDiff — re-expand a collapsed file", () => {
  it("toggling a collapsed file re-adds it to the expanded set", async () => {
    const RESULT: DiffResult = {
      contractA: { address: WPLS, name: "WPLS" },
      contractB: { address: ADDR_B, name: null },
      files: [
        {
          filename: "Token.sol",
          status: "changed",
          linesAdded: 1,
          linesRemoved: 0,
          lines: [{ type: "added", lineA: null, lineB: 1, content: "uint256 y;" }],
        },
      ],
      summary: {
        filesChanged: 1,
        filesAdded: 0,
        filesRemoved: 0,
        totalLinesAdded: 1,
        totalLinesRemoved: 0,
      },
    };
    fetchDiff.mockResolvedValue({ ok: true, diff: RESULT });
    renderWithProviders(<ContractDiff />);
    const inputs = screen.getAllByPlaceholderText("0x...");
    fireEvent.change(inputs[0]!, { target: { value: WPLS } });
    fireEvent.change(inputs[1]!, { target: { value: ADDR_B } });
    fireEvent.click(screen.getByRole("button", { name: /Compare/ }));

    // Expanded by default after compare.
    expect(await screen.findByText("uint256 y;")).toBeInTheDocument();
    // Collapse (delete branch).
    fireEvent.click(screen.getByText("Token.sol"));
    await waitFor(() =>
      expect(screen.queryByText("uint256 y;")).not.toBeInTheDocument(),
    );
    // Re-expand (else → add branch, stmt 41).
    fireEvent.click(screen.getByText("Token.sol"));
    expect(await screen.findByText("uint256 y;")).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------ */
/* TransactionBuilder stmt 55 is intentionally NOT covered here — see   */
/* the report: the address-input onChange clears selectedFn, so the     */
/* Simulate button (the only caller) is unmounted whenever validAddress */
/* could be false, making the `!selectedFn || !validAddress` guard      */
/* unreachable via the public component API.                            */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* RecentMenu — stmt 117 (recent-row navigate → onNavigate closes)     */
/* ------------------------------------------------------------------ */

describe("RecentMenu — navigating from a recent row closes the menu", () => {
  it("clicking a recent (non-pinned) row navigates and closes via onNavigate", () => {
    recents = [ent({ value: WPLS_LC, label: "WPLS recent", pinned: false })];
    renderWithProviders(<BackHistoryControl canGoBack onBack={vi.fn()} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Recent and pinned history" }),
    );
    fireEvent.click(screen.getByText("WPLS recent"));
    expect(navigate).toHaveBeenCalledWith(`/address/${WPLS_LC}`);
    // onNavigate ran setOpen(false) → menu unmounts.
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
