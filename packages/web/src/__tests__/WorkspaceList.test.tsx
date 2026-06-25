import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "./_test-utils";
import WorkspaceList from "../components/workspace/WorkspaceList";

/**
 * Index of named workspaces. The IDB-backed hook is mocked so this stays on
 * the list's own logic: loading state, empty state, create-row submit, the
 * per-row delete confirm/keep flow, and "updated Ns ago".
 */

const createMutate = vi.hoisted(() => vi.fn(async () => ({ id: "ws-new" })));
const removeMutate = vi.hoisted(() => vi.fn(() => {}));
const state = vi.hoisted(() => ({
  workspaces: [] as Array<{ id: string; name: string; description?: string; items: unknown[]; updatedAt: number }>,
  isLoading: false,
  createPending: false,
}));

vi.mock("../hooks/useWorkspaces", () => ({
  useWorkspaces: () => ({
    workspaces: state.workspaces,
    isLoading: state.isLoading,
    create: { mutateAsync: createMutate, isPending: state.createPending },
    remove: { mutate: removeMutate },
  }),
}));

beforeEach(() => {
  createMutate.mockClear();
  removeMutate.mockClear();
  state.workspaces = [];
  state.isLoading = false;
  state.createPending = false;
});

describe("<WorkspaceList />", () => {
  it("shows the loading placeholder while the store loads", () => {
    state.isLoading = true;
    renderWithProviders(<WorkspaceList />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("shows the empty hint when there are no workspaces", () => {
    renderWithProviders(<WorkspaceList />);
    expect(screen.getByText(/No workspaces yet/)).toBeInTheDocument();
  });

  it("renders a row per workspace with item count and description", () => {
    state.workspaces = [
      { id: "w1", name: "Lido incident", description: "the hack", items: [{}, {}], updatedAt: Date.now() },
      { id: "w2", name: "Solo", items: [{}], updatedAt: Date.now() },
    ];
    renderWithProviders(<WorkspaceList />);
    expect(screen.getByText("Lido incident")).toBeInTheDocument();
    expect(screen.getByText("the hack")).toBeInTheDocument();
    expect(screen.getByText("2 items")).toBeInTheDocument();
    expect(screen.getByText("1 item")).toBeInTheDocument();
    expect(screen.getAllByText(/just now/).length).toBe(2);
  });

  it("formats 'updated' time in minutes, hours, and days", () => {
    state.workspaces = [
      { id: "w1", name: "Mins", items: [], updatedAt: Date.now() - 5 * 60_000 },
      { id: "w2", name: "Hours", items: [], updatedAt: Date.now() - 3 * 3_600_000 },
      { id: "w3", name: "Days", items: [], updatedAt: Date.now() - 2 * 86_400_000 },
    ];
    renderWithProviders(<WorkspaceList />);
    expect(screen.getByText(/5m ago/)).toBeInTheDocument();
    expect(screen.getByText(/3h ago/)).toBeInTheDocument();
    expect(screen.getByText(/2d ago/)).toBeInTheDocument();
  });

  it("opens the create row and creates a workspace on submit", async () => {
    renderWithProviders(<WorkspaceList />);
    fireEvent.click(screen.getByRole("button", { name: /New workspace/ }));

    // Submit disabled until a name is typed.
    const submit = screen.getByRole("button", { name: "Create" });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText(/Lido incident/), {
      target: { value: "  My research  " },
    });
    fireEvent.change(screen.getByPlaceholderText("What is this workspace for?"), {
      target: { value: "notes" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(createMutate).toHaveBeenCalledTimes(1));
    expect(createMutate).toHaveBeenCalledWith({ name: "My research", description: "notes" });
  });

  it("ignores a create-form submit when the name is blank", () => {
    renderWithProviders(<WorkspaceList />);
    fireEvent.click(screen.getByRole("button", { name: /New workspace/ }));
    const input = screen.getByPlaceholderText(/Lido incident/);
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.submit(input.closest("form")!);
    expect(createMutate).not.toHaveBeenCalled();
  });

  it("cancels the create row without creating", () => {
    renderWithProviders(<WorkspaceList />);
    fireEvent.click(screen.getByRole("button", { name: /New workspace/ }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByPlaceholderText(/Lido incident/)).not.toBeInTheDocument();
    expect(createMutate).not.toHaveBeenCalled();
  });

  it("shows 'Creating…' while a create is pending", () => {
    state.createPending = true;
    renderWithProviders(<WorkspaceList />);
    fireEvent.click(screen.getByRole("button", { name: /New workspace/ }));
    expect(screen.getByRole("button", { name: "Creating…" })).toBeInTheDocument();
  });

  it("confirms then deletes a workspace; Keep aborts", () => {
    state.workspaces = [{ id: "w1", name: "Doomed", items: [], updatedAt: Date.now() }];
    renderWithProviders(<WorkspaceList />);

    const row = screen.getByText("Doomed").closest("div.card") as HTMLElement;
    // The delete trigger is the only icon-only button in the row.
    fireEvent.click(within(row).getByRole("button"));
    // Keep aborts.
    fireEvent.click(screen.getByRole("button", { name: "Keep" }));
    expect(removeMutate).not.toHaveBeenCalled();

    // After Keep, the row shows the single trash trigger again.
    fireEvent.click(within(row).getByRole("button"));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    expect(removeMutate).toHaveBeenCalledWith("w1");
  });
});
