import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor, act } from "@testing-library/react";
import { renderWithProviders } from "./_test-utils";
import { AddToWorkspaceButton } from "../components/workspace/AddToWorkspaceButton";

/**
 * The "Add to Workspace" picker button. Mocks the IDB hook + navigate so the
 * test stays on the popover logic: trigger toggle (compact vs full), the
 * empty-state hint, picking an existing workspace (with the just-added check
 * + auto-close), and create-new-and-add (which navigates to the new ws).
 *
 * Real on-chain fixture (chain 369):
 *   WPLS https://scan.pulsechain.com/address/0xa1077a294dde1b09bb078844df40758a5d0f9a27
 */

const WPLS = "0xa1077a294dde1b09bb078844df40758a5d0f9a27";

const addMutate = vi.hoisted(() => vi.fn(async () => {}));
const createMutate = vi.hoisted(() => vi.fn(async () => ({ id: "ws-new" })));
const navigateMock = vi.hoisted(() => vi.fn());
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
vi.mock("../lib/activeChain", () => ({ useActiveChainId: () => 369 }));
vi.mock("react-router-dom", async (orig) => {
  const actual = await orig<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => navigateMock };
});

beforeEach(() => {
  vi.useRealTimers();
  addMutate.mockClear();
  createMutate.mockClear();
  navigateMock.mockClear();
  state.workspaces = [];
});

describe("<AddToWorkspaceButton />", () => {
  it("opens the full-variant picker and shows the empty hint", () => {
    renderWithProviders(<AddToWorkspaceButton kind="address" value={WPLS} />);
    fireEvent.click(screen.getByRole("button", { name: "Add to Workspace" }));
    expect(screen.getByText("Add this address to…")).toBeInTheDocument();
    expect(screen.getByText(/No workspaces yet/)).toBeInTheDocument();
  });

  it("renders the compact trigger and toggles the popover closed again", () => {
    renderWithProviders(<AddToWorkspaceButton kind="tx" value="0xabc" compact />);
    const trigger = screen.getByRole("button", { name: "Add to Workspace" });
    fireEvent.click(trigger);
    expect(screen.getByText("Add this tx to…")).toBeInTheDocument();
    fireEvent.click(trigger);
    expect(screen.queryByText("Add this tx to…")).not.toBeInTheDocument();
  });

  it("pins to the explicit chainId prop over the active chain", async () => {
    state.workspaces = [{ id: "w1", name: "DeFi", items: [] }];
    renderWithProviders(<AddToWorkspaceButton kind="address" value={WPLS} chainId={1} />);
    fireEvent.click(screen.getByRole("button", { name: "Add to Workspace" }));
    fireEvent.click(screen.getByRole("button", { name: /DeFi/ }));
    await waitFor(() => expect(addMutate).toHaveBeenCalledTimes(1));
    expect(addMutate).toHaveBeenCalledWith({ id: "w1", kind: "address", value: WPLS, chainId: 1 });
  });

  it("picks an existing workspace using the active chain and auto-closes after the check", async () => {
    vi.useFakeTimers();
    state.workspaces = [{ id: "w1", name: "DeFi", items: [{}] }];
    renderWithProviders(<AddToWorkspaceButton kind="address" value={WPLS} />);
    fireEvent.click(screen.getByRole("button", { name: "Add to Workspace" }));
    fireEvent.click(screen.getByRole("button", { name: /DeFi/ }));

    // flush the addToWorkspace microtask, then the 800ms close timer
    await act(async () => {
      await Promise.resolve();
    });
    expect(addMutate).toHaveBeenCalledWith({ id: "w1", kind: "address", value: WPLS, chainId: 369 });

    await act(async () => {
      vi.advanceTimersByTime(800);
    });
    expect(screen.queryByText("Add this address to…")).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it("creates a new workspace, adds the item, and navigates to it", async () => {
    renderWithProviders(<AddToWorkspaceButton kind="block" value="26804492" />);
    fireEvent.click(screen.getByRole("button", { name: "Add to Workspace" }));

    const input = screen.getByPlaceholderText(/Create new workspace and add/);
    fireEvent.change(input, { target: { value: "  Investigations  " } });
    fireEvent.click(screen.getByRole("button", { name: /Create "Investigations" and add/ }));

    await waitFor(() => expect(createMutate).toHaveBeenCalledWith({ name: "Investigations" }));
    expect(addMutate).toHaveBeenCalledWith({ id: "ws-new", kind: "block", value: "26804492", chainId: 369 });
    expect(navigateMock).toHaveBeenCalledWith("/workspace/ws-new");
  });

  it("does not show the create submit until a name is typed", () => {
    renderWithProviders(<AddToWorkspaceButton kind="address" value={WPLS} />);
    fireEvent.click(screen.getByRole("button", { name: "Add to Workspace" }));
    expect(screen.queryByRole("button", { name: /and add/ })).not.toBeInTheDocument();
  });

  it("ignores a create submit when the name is only whitespace", () => {
    renderWithProviders(<AddToWorkspaceButton kind="address" value={WPLS} />);
    fireEvent.click(screen.getByRole("button", { name: "Add to Workspace" }));
    const input = screen.getByPlaceholderText(/Create new workspace and add/);
    fireEvent.change(input, { target: { value: "   " } });
    // Submitting the form (e.g. Enter) with a blank name is a no-op.
    fireEvent.submit(input.closest("form")!);
    expect(createMutate).not.toHaveBeenCalled();
  });
});
