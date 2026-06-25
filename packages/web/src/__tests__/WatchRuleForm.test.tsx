import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "./_test-utils";
import { WatchRuleForm } from "../components/workspace/watcher/WatchRuleForm";
import type { Workspace } from "../lib/workspace/types";

/**
 * Add-watch form. onAdd is a stub; the test drives the validation branches
 * (required address must be a real 0x address; optional counterparty + min
 * value must parse if present) and the kind switch between address-activity
 * and erc20-transfer field sets.
 *
 * Real on-chain fixtures (chain 369):
 *   WPLS address   https://scan.pulsechain.com/address/0xa1077a294dde1b09bb078844df40758a5d0f9a27
 *   PulseX router  0x165c3410fc91ef562c50559f7d2289febed552d9
 */

const WPLS = "0xa1077a294dde1b09bb078844df40758a5d0f9a27";
const ROUTER = "0x165c3410fc91ef562c50559f7d2289febed552d9";

function workspace(items: { kind: "address" | "tx" | "block"; value: string; label?: string }[] = []): Workspace {
  return {
    id: "w1",
    name: "DeFi",
    createdAt: 1,
    updatedAt: 1,
    items: items.map((it, i) => ({ id: `i${i}`, kind: it.kind, value: it.value, label: it.label, chainId: 369, addedAt: 1 })),
  };
}

describe("<WatchRuleForm />", () => {
  it("keeps Add disabled until a valid address is entered", () => {
    renderWithProviders(
      <WatchRuleForm workspace={workspace()} onAdd={async () => {}} onCancel={() => {}} />,
    );
    const add = screen.getByRole("button", { name: "Add watch" });
    expect(add).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Address"), { target: { value: "0xnot-an-address" } });
    expect(add).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Address"), { target: { value: WPLS } });
    expect(add).toBeEnabled();
  });

  it("submits an address_activity rule with direction + parsed min value", async () => {
    const onAdd = vi.fn(async () => {});
    const onCancel = vi.fn();
    renderWithProviders(
      <WatchRuleForm workspace={workspace()} onAdd={onAdd} onCancel={onCancel} />,
    );
    fireEvent.change(screen.getByLabelText("Address"), { target: { value: WPLS } });
    fireEvent.change(screen.getByLabelText("Direction"), { target: { value: "in" } });
    fireEvent.change(screen.getByLabelText(/Min value/), { target: { value: "1.5" } });
    fireEvent.change(screen.getByLabelText(/Label/), { target: { value: " Treasury " } });

    fireEvent.click(screen.getByRole("button", { name: "Add watch" }));
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
    expect(onAdd).toHaveBeenCalledWith({
      workspaceId: "w1",
      chainId: 369,
      kind: "address_activity",
      label: "Treasury",
      address: WPLS,
      direction: "in",
      minValueWei: "1500000000000000000", // 1.5 PLS in wei
      contractAddress: undefined,
      counterparty: undefined,
    });
    expect(onCancel).toHaveBeenCalled(); // form closes after add
  });

  it("submits with the chain selected in the Chain dropdown", async () => {
    const onAdd = vi.fn(async () => {});
    renderWithProviders(
      <WatchRuleForm workspace={workspace()} onAdd={onAdd} onCancel={() => {}} />,
    );
    fireEvent.change(screen.getByLabelText("Chain"), { target: { value: "1" } }); // Ethereum
    fireEvent.change(screen.getByLabelText("Address"), { target: { value: WPLS } });
    fireEvent.click(screen.getByRole("button", { name: "Add watch" }));
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ chainId: 1 }));
  });

  it("flags an unparseable min value and blocks Add", () => {
    renderWithProviders(
      <WatchRuleForm workspace={workspace()} onAdd={async () => {}} onCancel={() => {}} />,
    );
    fireEvent.change(screen.getByLabelText("Address"), { target: { value: WPLS } });
    fireEvent.change(screen.getByLabelText(/Min value/), { target: { value: "abc" } });
    expect(screen.getByRole("button", { name: "Add watch" })).toBeDisabled();
  });

  it("switches to erc20_transfer fields and validates the token + counterparty", async () => {
    const onAdd = vi.fn(async () => {});
    renderWithProviders(
      <WatchRuleForm workspace={workspace()} onAdd={onAdd} onCancel={() => {}} />,
    );
    fireEvent.change(screen.getByLabelText("Watch"), { target: { value: "erc20_transfer" } });

    const add = screen.getByRole("button", { name: "Add watch" });
    expect(add).toBeDisabled(); // token required

    // Bad counterparty blocks even with a valid token.
    fireEvent.change(screen.getByLabelText("Token contract"), { target: { value: WPLS } });
    fireEvent.change(screen.getByLabelText(/Counterparty/), { target: { value: "0xbad" } });
    expect(add).toBeDisabled();

    // Valid counterparty enables.
    fireEvent.change(screen.getByLabelText(/Counterparty/), { target: { value: ROUTER } });
    expect(add).toBeEnabled();

    fireEvent.click(add);
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
    expect(onAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "erc20_transfer",
        contractAddress: WPLS,
        counterparty: ROUTER,
        address: undefined,
        direction: undefined,
        minValueWei: undefined,
      }),
    );
  });

  it("seeds address suggestions from the workspace's address items", () => {
    renderWithProviders(
      <WatchRuleForm
        workspace={workspace([
          { kind: "address", value: WPLS, label: "WPLS label" },
          { kind: "address", value: ROUTER }, // no label → falls back to value
          { kind: "tx", value: "0xabc" },
        ])}
        onAdd={async () => {}}
        onCancel={() => {}}
      />,
    );
    // datalist options from the two address items (tx item excluded).
    const labeled = document.querySelector(`option[value="${WPLS}"]`);
    expect(labeled?.textContent).toBe("WPLS label");
    const unlabeled = document.querySelector(`option[value="${ROUTER}"]`);
    expect(unlabeled?.textContent).toBe(ROUTER); // label ?? value fallback
  });

  it("submits a minimal address rule (no min value → undefined threshold)", async () => {
    const onAdd = vi.fn(async () => {});
    renderWithProviders(
      <WatchRuleForm workspace={workspace()} onAdd={onAdd} onCancel={() => {}} />,
    );
    fireEvent.change(screen.getByLabelText("Address"), { target: { value: WPLS } });
    fireEvent.click(screen.getByRole("button", { name: "Add watch" }));
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
    expect(onAdd).toHaveBeenCalledWith(
      expect.objectContaining({ address: WPLS, minValueWei: undefined, label: undefined }),
    );
  });

  it("submits a minimal erc20 rule (no counterparty → undefined)", async () => {
    const onAdd = vi.fn(async () => {});
    renderWithProviders(
      <WatchRuleForm workspace={workspace()} onAdd={onAdd} onCancel={() => {}} />,
    );
    fireEvent.change(screen.getByLabelText("Watch"), { target: { value: "erc20_transfer" } });
    fireEvent.change(screen.getByLabelText("Token contract"), { target: { value: WPLS } });
    fireEvent.click(screen.getByRole("button", { name: "Add watch" }));
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
    expect(onAdd).toHaveBeenCalledWith(
      expect.objectContaining({ contractAddress: WPLS, counterparty: undefined }),
    );
  });

  it("does nothing when the form is submitted while invalid", () => {
    const onAdd = vi.fn(async () => {});
    const onCancel = vi.fn();
    renderWithProviders(
      <WatchRuleForm workspace={workspace()} onAdd={onAdd} onCancel={onCancel} />,
    );
    // No address yet → canAdd false. Submitting the form (Enter) is a no-op.
    fireEvent.submit(screen.getByLabelText("Address").closest("form")!);
    expect(onAdd).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("falls back to a symbol-less Min value label for an unregistered chain", () => {
    // An address item pinned to an unregistered chain seeds defaultChain, so
    // chainById(...) is undefined → symbol "" → label has no "(SYM)" suffix.
    const ws: Workspace = {
      id: "w1",
      name: "DeFi",
      createdAt: 1,
      updatedAt: 1,
      items: [{ id: "i0", kind: "address", value: WPLS, chainId: 424242, addedAt: 1 }],
    };
    renderWithProviders(
      <WatchRuleForm workspace={ws} onAdd={async () => {}} onCancel={() => {}} />,
    );
    // Label is exactly "Min value" (no symbol) for the unknown chain.
    expect(screen.getByText("Min value")).toBeInTheDocument();
  });

  it("calls onCancel from the Cancel button", () => {
    const onCancel = vi.fn();
    renderWithProviders(
      <WatchRuleForm workspace={workspace()} onAdd={async () => {}} onCancel={onCancel} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
