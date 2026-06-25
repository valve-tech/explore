import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DebuggerWorkspaceSuggest } from "../components/debugger/DebuggerWorkspaceSuggest";

// Drive the workspace hook directly so we don't touch IDB. mutateAsync is the
// only surface the component calls.
const addMutate = vi.hoisted(() => vi.fn(async () => {}));
const createMutate = vi.hoisted(() => vi.fn(async () => ({ id: "ws-new" })));
const workspacesRef = vi.hoisted(() => ({
  value: [] as Array<{ id: string; name: string; items: unknown[] }>,
}));
vi.mock("../hooks/useWorkspaces", () => ({
  useWorkspaces: () => ({
    workspaces: workspacesRef.value,
    create: { mutateAsync: createMutate },
    addToWorkspace: { mutateAsync: addMutate },
  }),
}));

describe("DebuggerWorkspaceSuggest", () => {
  beforeEach(() => {
    addMutate.mockClear();
    createMutate.mockClear();
    workspacesRef.value = [];
  });

  it("renders nothing when there are no touched addresses", () => {
    const { container } = render(
      <DebuggerWorkspaceSuggest txHash="0xtx" addresses={[]} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("opens the picker and shows the empty-workspace hint", () => {
    render(
      <DebuggerWorkspaceSuggest
        txHash="0xtx"
        addresses={["0xAbC", "0xabc"]}
      />,
    );
    // Toggle open via the icon button (aria-label = tooltip).
    fireEvent.click(
      screen.getByRole("button", {
        name: /File 1 contract \+ this tx into a workspace/,
      }),
    );
    expect(
      screen.getByText("No workspaces yet. Create one below to start filing."),
    ).toBeInTheDocument();
    // deduped: 0xAbC and 0xabc collapse to one address → "1 contract".
  });

  it("batch-adds every deduped address plus the tx to a chosen workspace", async () => {
    workspacesRef.value = [{ id: "ws1", name: "DeFi", items: [] }];
    render(
      <DebuggerWorkspaceSuggest
        txHash="0xtx"
        addresses={["0xaaa", "0xbbb"]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /File 2 contracts/ }));
    fireEvent.click(screen.getByText("DeFi"));
    await waitFor(() => {
      // 2 addresses + 1 tx.
      expect(addMutate).toHaveBeenCalledTimes(3);
    });
    expect(addMutate).toHaveBeenCalledWith({
      id: "ws1",
      kind: "tx",
      value: "0xtx",
    });
  });

  it("creates a new workspace then files into it", async () => {
    render(
      <DebuggerWorkspaceSuggest txHash="0xtx" addresses={["0xaaa"]} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /File 1 contract/ }));
    const input = screen.getByPlaceholderText(
      "Create new workspace and add…",
    );
    fireEvent.change(input, { target: { value: "New WS" } });
    // The submit button appears once the name is non-empty.
    fireEvent.click(
      screen.getByRole("button", { name: /Create "New WS" and add 2/ }),
    );
    await waitFor(() => expect(createMutate).toHaveBeenCalledWith({ name: "New WS" }));
    await waitFor(() => expect(addMutate).toHaveBeenCalled());
  });
});
