import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "./_test-utils";
import {
  PaletteWorkspaceDropZone,
  PALETTE_ENTITY_MIME,
} from "../components/workspace/PaletteWorkspaceDropZone";

/**
 * In-palette drop overlay — each workspace is a drop target; releasing a
 * dragged entity over one calls addToWorkspace, or drops onto an inline
 * "create + add" target. The IDB hook is mocked; we assert the drag/drop
 * plumbing: payload parse from dataTransfer, hover highlighting, and the
 * create-then-add path.
 *
 * Real on-chain fixture (chain 369):
 *   WPLS https://scan.pulsechain.com/address/0xa1077a294dde1b09bb078844df40758a5d0f9a27
 */

const WPLS = "0xa1077a294dde1b09bb078844df40758a5d0f9a27";

const addMutate = vi.hoisted(() => vi.fn(async () => {}));
const createMutate = vi.hoisted(() => vi.fn(async () => ({ id: "ws-new" })));
const state = vi.hoisted(() => ({
  workspaces: [] as Array<{ id: string; name: string; items: unknown[] }>,
}));

vi.mock("../hooks/useWorkspaces", () => ({
  useWorkspaces: () => ({
    workspaces: state.workspaces,
    create: { mutateAsync: createMutate },
    addToWorkspace: { mutateAsync: addMutate },
  }),
}));

beforeEach(() => {
  addMutate.mockClear();
  createMutate.mockClear();
  state.workspaces = [{ id: "w1", name: "DeFi", items: [{}, {}] }];
});

/** Build a drag event whose dataTransfer carries an entity payload. */
function dataTransfer(payload?: { kind: string; value: string }) {
  const types = payload ? [PALETTE_ENTITY_MIME] : [];
  return {
    types,
    getData: (mime: string) =>
      mime === PALETTE_ENTITY_MIME && payload ? JSON.stringify(payload) : "",
    setData: () => {},
  };
}

describe("<PaletteWorkspaceDropZone />", () => {
  it("renders nothing when not visible", () => {
    const { container } = renderWithProviders(
      <PaletteWorkspaceDropZone visible={false} onComplete={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("lists each workspace with its item count when visible", () => {
    renderWithProviders(<PaletteWorkspaceDropZone visible onComplete={() => {}} />);
    expect(screen.getByText("DeFi")).toBeInTheDocument();
    expect(screen.getByText("2 items")).toBeInTheDocument();
    expect(screen.getByText("Drop into a workspace")).toBeInTheDocument();
  });

  it("highlights a tile on dragOver and adds the dropped entity", async () => {
    const onComplete = vi.fn();
    renderWithProviders(<PaletteWorkspaceDropZone visible onComplete={onComplete} />);

    const tile = screen.getByText("DeFi").closest("div.card")!;
    const payload = { kind: "address", value: WPLS };

    fireEvent.dragOver(tile, { dataTransfer: dataTransfer(payload) });
    expect(screen.getByText("release")).toBeInTheDocument(); // hover affordance

    fireEvent.drop(tile, { dataTransfer: dataTransfer(payload) });
    await waitFor(() => expect(addMutate).toHaveBeenCalledTimes(1));
    expect(addMutate).toHaveBeenCalledWith({ id: "w1", kind: "address", value: WPLS });
    expect(onComplete).toHaveBeenCalled();
  });

  it("ignores a drop carrying no entity payload", async () => {
    renderWithProviders(<PaletteWorkspaceDropZone visible onComplete={() => {}} />);
    const tile = screen.getByText("DeFi").closest("div.card")!;
    fireEvent.drop(tile, { dataTransfer: dataTransfer(undefined) });
    // no payload → consumePayload returns null → no mutation
    await new Promise((r) => setTimeout(r, 0));
    expect(addMutate).not.toHaveBeenCalled();
  });

  it("clears hover on dragLeave", () => {
    renderWithProviders(<PaletteWorkspaceDropZone visible onComplete={() => {}} />);
    const tile = screen.getByText("DeFi").closest("div.card")!;
    fireEvent.dragOver(tile, { dataTransfer: dataTransfer({ kind: "address", value: WPLS }) });
    expect(screen.getByText("release")).toBeInTheDocument();
    fireEvent.dragLeave(tile);
    expect(screen.queryByText("release")).not.toBeInTheDocument();
  });

  it("keeps hover on the active tile when a different tile fires dragLeave", () => {
    state.workspaces = [
      { id: "w1", name: "DeFi", items: [] },
      { id: "w2", name: "NFTs", items: [] },
    ];
    renderWithProviders(<PaletteWorkspaceDropZone visible onComplete={() => {}} />);
    const tileA = screen.getByText("DeFi").closest("div.card")!;
    const tileB = screen.getByText("NFTs").closest("div.card")!;
    const payload = { kind: "address", value: WPLS };

    fireEvent.dragOver(tileA, { dataTransfer: dataTransfer(payload) });
    // dragLeave on B while A is hovered → setter's `h === w.id ? null : h`
    // false arm keeps A's hover.
    fireEvent.dragLeave(tileB);
    expect(screen.getByText("release")).toBeInTheDocument();
  });

  it("creates a new workspace and adds the entity via the create target", async () => {
    const onComplete = vi.fn();
    renderWithProviders(<PaletteWorkspaceDropZone visible onComplete={onComplete} />);

    fireEvent.click(screen.getByRole("button", { name: /New workspace/ }));
    fireEvent.change(screen.getByPlaceholderText(/New workspace name/), {
      target: { value: "Fresh" },
    });

    const payload = { kind: "tx", value: "0xabc" };
    const target = screen.getByPlaceholderText(/New workspace name/).closest("div.card")!;
    fireEvent.drop(target, { dataTransfer: dataTransfer(payload) });

    await waitFor(() => expect(createMutate).toHaveBeenCalledWith({ name: "Fresh" }));
    expect(addMutate).toHaveBeenCalledWith({ id: "ws-new", kind: "tx", value: "0xabc" });
    expect(onComplete).toHaveBeenCalled();
  });

  it("ignores dragOver without the entity MIME and a drop with malformed JSON", async () => {
    renderWithProviders(<PaletteWorkspaceDropZone visible onComplete={() => {}} />);
    const tile = screen.getByText("DeFi").closest("div.card")!;

    // dragOver lacking the entity MIME → early return, no hover highlight.
    fireEvent.dragOver(tile, { dataTransfer: dataTransfer(undefined) });
    expect(screen.queryByText("release")).not.toBeInTheDocument();

    // Drop with the MIME present but un-parseable JSON → consumePayload catch.
    fireEvent.drop(tile, {
      dataTransfer: {
        types: [PALETTE_ENTITY_MIME],
        getData: () => "{not valid json",
        setData: () => {},
      },
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(addMutate).not.toHaveBeenCalled();
  });

  it("ignores a drop whose payload is missing kind/value", async () => {
    renderWithProviders(<PaletteWorkspaceDropZone visible onComplete={() => {}} />);
    const tile = screen.getByText("DeFi").closest("div.card")!;
    fireEvent.drop(tile, {
      dataTransfer: {
        types: [PALETTE_ENTITY_MIME],
        getData: () => JSON.stringify({ kind: "address" }), // no value
        setData: () => {},
      },
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(addMutate).not.toHaveBeenCalled();
  });

  it("highlights and un-highlights the new-workspace create target", () => {
    renderWithProviders(<PaletteWorkspaceDropZone visible onComplete={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /New workspace/ }));
    const target = screen.getByPlaceholderText(/New workspace name/).closest("div.card")!;
    const payload = { kind: "address", value: WPLS };

    // Hover the create target (sets hoverId "__new"), then leave it (true arm).
    fireEvent.dragOver(target, { dataTransfer: dataTransfer(payload) });
    fireEvent.dragLeave(target);
    // dragOver without MIME on the create target → early return.
    fireEvent.dragOver(target, { dataTransfer: dataTransfer(undefined) });
    expect(target).toBeInTheDocument();
  });

  it("keeps an existing tile's hover when the create target fires dragLeave", () => {
    renderWithProviders(<PaletteWorkspaceDropZone visible onComplete={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /New workspace/ }));
    const tile = screen.getByText("DeFi").closest("div.card")!;
    const target = screen.getByPlaceholderText(/New workspace name/).closest("div.card")!;
    const payload = { kind: "address", value: WPLS };

    fireEvent.dragOver(tile, { dataTransfer: dataTransfer(payload) });
    // create target dragLeave while a real tile is hovered → `h === "__new"`
    // false arm preserves the tile's hover.
    fireEvent.dragLeave(target);
    expect(screen.getByText("release")).toBeInTheDocument();
  });

  it("does not create when the new-workspace name is blank", async () => {
    renderWithProviders(<PaletteWorkspaceDropZone visible onComplete={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /New workspace/ }));
    const target = screen.getByPlaceholderText(/New workspace name/).closest("div.card")!;
    fireEvent.drop(target, { dataTransfer: dataTransfer({ kind: "tx", value: "0xabc" }) });
    await new Promise((r) => setTimeout(r, 0));
    expect(createMutate).not.toHaveBeenCalled();
  });
});
