import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { makeQueryClient } from "./_test-utils";
import WorkspaceDetail from "../components/workspace/WorkspaceDetail";
import type { Workspace } from "../lib/workspace/types";

/**
 * One workspace's detail page. The IDB hook and the heavy child panels
 * (Portfolio / Watches / BulkPaste / item-row previews) are mocked so the
 * test stays on WorkspaceDetail's own logic: loading, not-found, header
 * rename/delete, the bulk-paste toggle + sequential add, and the empty-items
 * vs populated-items branches.
 *
 * Real on-chain fixture (chain 369):
 *   WPLS https://scan.pulsechain.com/address/0xa1077a294dde1b09bb078844df40758a5d0f9a27
 */

const WPLS = "0xa1077a294dde1b09bb078844df40758a5d0f9a27";

const addMutate = vi.hoisted(() => vi.fn(async () => {}));
const removeFromMutate = vi.hoisted(() => vi.fn(() => {}));
const renameMutate = vi.hoisted(() => vi.fn(async () => {}));
const removeMutate = vi.hoisted(() => vi.fn(async () => {}));
const navigateMock = vi.hoisted(() => vi.fn());
const state = vi.hoisted(() => ({
  workspaces: [] as Workspace[],
  isLoading: false,
}));

vi.mock("../hooks/useWorkspaces", () => ({
  useWorkspaces: () => ({
    workspaces: state.workspaces,
    isLoading: state.isLoading,
    addToWorkspace: { mutateAsync: addMutate },
    removeFromWorkspace: { mutate: removeFromMutate },
    rename: { mutateAsync: renameMutate },
    remove: { mutateAsync: removeMutate },
  }),
}));
vi.mock("../lib/activeChain", () => ({ useActiveChainId: () => 369 }));
vi.mock("react-router-dom", async (orig) => {
  const actual = await orig<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => navigateMock };
});

// Stub the child panels so this file owns only WorkspaceDetail's branches.
vi.mock("../components/workspace/PortfolioPanel", () => ({
  PortfolioPanel: () => <div data-testid="portfolio" />,
}));
vi.mock("../components/workspace/watcher/WatchRulesPanel", () => ({
  WatchRulesPanel: () => <div data-testid="watches" />,
}));
vi.mock("../components/workspace/WorkspaceItemRow", () => ({
  WorkspaceItemRow: ({ canonicalHref, onRemove }: { canonicalHref: string; onRemove: () => void }) => (
    <button data-testid="item-row" data-href={canonicalHref} onClick={onRemove}>
      row
    </button>
  ),
}));
vi.mock("../components/workspace/BulkPastePanel", () => ({
  BulkPastePanel: ({ onAdd, onClose }: { onAdd: (i: { kind: string; value: string }[]) => Promise<unknown>; onClose: () => void }) => (
    <div data-testid="bulk">
      <button onClick={() => void onAdd([{ kind: "address", value: WPLS }, { kind: "tx", value: "0xabc" }])}>
        bulk-add
      </button>
      <button onClick={onClose}>bulk-close</button>
    </div>
  ),
}));

function ws(over: Partial<Workspace> = {}): Workspace {
  return {
    id: "w1",
    name: "DeFi",
    createdAt: 1,
    updatedAt: 1,
    items: [],
    ...over,
  };
}

function renderDetail() {
  const client = makeQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/workspace/w1"]}>
        <Routes>
          <Route path="/workspace/:id" element={<WorkspaceDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  addMutate.mockClear();
  removeFromMutate.mockClear();
  renameMutate.mockClear();
  removeMutate.mockClear();
  navigateMock.mockClear();
  state.workspaces = [ws()];
  state.isLoading = false;
});

describe("<WorkspaceDetail />", () => {
  it("shows the loading state", () => {
    state.isLoading = true;
    renderDetail();
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("shows not-found when the id doesn't match a workspace", () => {
    state.workspaces = [];
    renderDetail();
    expect(screen.getByText(/This workspace doesn't exist/)).toBeInTheDocument();
  });

  it("renders the header, description, and the empty-items hint", () => {
    state.workspaces = [ws({ description: "the research", items: [] })];
    renderDetail();
    expect(screen.getByRole("heading", { name: "DeFi" })).toBeInTheDocument();
    expect(screen.getByText("the research")).toBeInTheDocument();
    expect(screen.getByText(/Add to Workspace/)).toBeInTheDocument(); // empty hint copy
    expect(screen.getByText("0 items")).toBeInTheDocument();
    expect(screen.getByTestId("portfolio")).toBeInTheDocument();
    expect(screen.getByTestId("watches")).toBeInTheDocument();
  });

  it("renders one item row per item with its canonical href (chain-scoped)", () => {
    state.workspaces = [
      ws({
        items: [
          { id: "a", kind: "address", value: WPLS, chainId: 369, addedAt: 1 },
          { id: "b", kind: "tx", value: "0xabc", chainId: 1, addedAt: 1 },
          { id: "c", kind: "block", value: "26804492", chainId: 369, addedAt: 1 },
        ],
      }),
    ];
    renderDetail();
    const rows = screen.getAllByTestId("item-row");
    expect(rows).toHaveLength(3);
    // default chain (369) omits ?chainid; chain 1 appends it.
    expect(rows[0]).toHaveAttribute("data-href", `/address/${WPLS}`);
    expect(rows[1]).toHaveAttribute("data-href", "/tx/0xabc?chainid=1");
    expect(rows[2]).toHaveAttribute("data-href", "/block/26804492"); // block arm

    fireEvent.click(rows[0]!);
    expect(removeFromMutate).toHaveBeenCalledWith({ id: "w1", itemId: "a" });
  });

  it("renders the singular item-count label for one item", () => {
    state.workspaces = [
      ws({ items: [{ id: "a", kind: "address", value: WPLS, chainId: 369, addedAt: 1 }] }),
    ];
    renderDetail();
    expect(screen.getByText("1 item")).toBeInTheDocument();
  });

  it("does not rename when the edited name is blank (form submit)", () => {
    renderDetail();
    const editBtn = headerIconButtons()[1]!;
    fireEvent.click(editBtn);
    const nameInput = screen.getByDisplayValue("DeFi");
    fireEvent.change(nameInput, { target: { value: "   " } });
    fireEvent.submit(nameInput.closest("form")!);
    expect(renameMutate).not.toHaveBeenCalled();
  });

  it("toggles the bulk-paste panel and adds each item pinned to the active chain", async () => {
    renderDetail();
    // Header has three icon-only buttons: [bulk-paste, edit, delete]. Open
    // bulk-paste (the first).
    const bulkBtn = headerIconButtons()[0]!;
    fireEvent.click(bulkBtn);
    expect(screen.getByTestId("bulk")).toBeInTheDocument();

    fireEvent.click(screen.getByText("bulk-add"));
    await waitFor(() => expect(addMutate).toHaveBeenCalledTimes(2));
    expect(addMutate).toHaveBeenNthCalledWith(1, { id: "w1", kind: "address", value: WPLS, chainId: 369 });
    expect(addMutate).toHaveBeenNthCalledWith(2, { id: "w1", kind: "tx", value: "0xabc", chainId: 369 });

    // close via the panel's own close
    fireEvent.click(screen.getByText("bulk-close"));
    expect(screen.queryByTestId("bulk")).not.toBeInTheDocument();
  });

  it("renames the workspace via the edit form (Save) and cancels (restoring)", async () => {
    renderDetail();
    // [bulk, edit, delete] — edit is the second header icon button.
    const editBtn = headerIconButtons()[1]!;
    fireEvent.click(editBtn);

    const nameInput = screen.getByDisplayValue("DeFi");
    fireEvent.change(nameInput, { target: { value: "  Renamed  " } });
    const descInput = screen.getByPlaceholderText("Description (optional)");
    fireEvent.change(descInput, { target: { value: "notes" } });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(renameMutate).toHaveBeenCalledTimes(1));
    expect(renameMutate).toHaveBeenCalledWith({ id: "w1", name: "Renamed", description: "notes" });
  });

  it("renames with an empty description (passes undefined)", async () => {
    state.workspaces = [ws({ description: "old" })];
    renderDetail();
    const editBtn = headerIconButtons()[1]!;
    fireEvent.click(editBtn);
    fireEvent.change(screen.getByDisplayValue("DeFi"), { target: { value: "New name" } });
    // Clear the description → `description.trim() || undefined` falsy arm.
    fireEvent.change(screen.getByDisplayValue("old"), { target: { value: "  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(renameMutate).toHaveBeenCalledTimes(1));
    expect(renameMutate).toHaveBeenCalledWith({ id: "w1", name: "New name", description: undefined });
  });

  it("cancels the edit form without renaming", () => {
    renderDetail();
    const editBtn = headerIconButtons()[1]!;
    fireEvent.click(editBtn);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByDisplayValue("DeFi")).not.toBeInTheDocument();
    expect(renameMutate).not.toHaveBeenCalled();
  });

  it("disables Save when the edited name is blank", () => {
    renderDetail();
    const editBtn = headerIconButtons()[1]!;
    fireEvent.click(editBtn);
    fireEvent.change(screen.getByDisplayValue("DeFi"), { target: { value: "   " } });
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("confirms delete then navigates back; Keep aborts", async () => {
    renderDetail();
    const deleteBtn = headerIconButtons()[2]!;

    // First click reveals confirm/keep; Keep aborts.
    fireEvent.click(deleteBtn);
    fireEvent.click(screen.getByRole("button", { name: "Keep" }));
    expect(removeMutate).not.toHaveBeenCalled();

    // Re-open and confirm.
    fireEvent.click(headerIconButtons()[2]!);
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    await waitFor(() => expect(removeMutate).toHaveBeenCalledWith("w1"));
    expect(navigateMock).toHaveBeenCalledWith("/workspace", { replace: true });
  });
});

/**
 * The header's three icon-only buttons in DOM order: [bulk-paste, edit,
 * delete]. They carry no accessible name (icon-only), so order is the stable
 * handle. The first <button> elements on the page belong to this header (the
 * "All workspaces" nav is a link, not a button).
 */
function headerIconButtons(): HTMLElement[] {
  return screen
    .getAllByRole("button")
    .filter((b) => b.textContent?.trim() === "")
    .slice(0, 3);
}
