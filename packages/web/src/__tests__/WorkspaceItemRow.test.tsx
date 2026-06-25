import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent, within } from "@testing-library/react";
import { renderWithProviders } from "./_test-utils";
import { WorkspaceItemRow } from "../components/workspace/WorkspaceItemRow";
import type { WorkspaceItem } from "../lib/workspace/types";

/**
 * One row in a workspace's item list — collapsed (icon + value + label +
 * canonical link) and expanded (mounts the per-kind preview, which only then
 * fetches). The previews are mocked to stand-in markers so this test stays on
 * the row's own logic: icon/color per kind, label, "added Ns ago · chain",
 * expand/collapse, and remove.
 *
 * Known setups (chain 369):
 *   WPLS  https://scan.pulsechain.com/address/0xA1077a294dDE1B09bB078844df40758a5D0f9a27
 */

vi.mock("../components/workspace/previews/AddressPreview", () => ({
  AddressPreview: ({ address, chainId }: { address: string; chainId: number }) => (
    <div data-testid="address-preview">{`addr:${address}:${chainId}`}</div>
  ),
}));
vi.mock("../components/workspace/previews/TxPreview", () => ({
  TxPreview: ({ hash, chainId }: { hash: string; chainId: number }) => (
    <div data-testid="tx-preview">{`tx:${hash}:${chainId}`}</div>
  ),
}));
vi.mock("../components/workspace/previews/BlockPreview", () => ({
  BlockPreview: ({ numberOrHash, chainId }: { numberOrHash: string; chainId: number }) => (
    <div data-testid="block-preview">{`block:${numberOrHash}:${chainId}`}</div>
  ),
}));

const WPLS = "0xa1077a294dde1b09bb078844df40758a5d0f9a27";

function addrItem(over: Partial<WorkspaceItem> = {}): WorkspaceItem {
  return {
    id: "i1",
    kind: "address",
    value: WPLS,
    chainId: 369,
    addedAt: Date.now(),
    ...over,
  };
}

describe("<WorkspaceItemRow />", () => {
  it("renders kind, value, label, and the pinned chain name", () => {
    renderWithProviders(
      <WorkspaceItemRow
        item={addrItem({ label: "the WPLS contract" })}
        canonicalHref="/address/wpls"
        onRemove={() => {}}
      />,
    );
    expect(screen.getByText("address")).toBeInTheDocument();
    expect(screen.getByText("the WPLS contract")).toBeInTheDocument();
    expect(screen.getByText(WPLS)).toBeInTheDocument();
    expect(screen.getByText(/PulseChain/)).toBeInTheDocument();
    // collapsed → no preview mounted (no fetch)
    expect(screen.queryByTestId("address-preview")).not.toBeInTheDocument();
  });

  it("falls back to 'chain N' for an unregistered chain id", () => {
    renderWithProviders(
      <WorkspaceItemRow
        item={addrItem({ chainId: 99999 })}
        canonicalHref="/address/wpls"
        onRemove={() => {}}
      />,
    );
    expect(screen.getByText(/chain 99999/)).toBeInTheDocument();
  });

  it("expands to mount the AddressPreview and collapses again", () => {
    const { container } = renderWithProviders(
      <WorkspaceItemRow item={addrItem()} canonicalHref="/address/wpls" onRemove={() => {}} />,
    );
    // Two icon-only buttons in order: [expand/collapse, remove].
    const toggleBtn = within(container).getAllByRole("button")[0]!;
    fireEvent.click(toggleBtn);
    expect(screen.getByTestId("address-preview")).toHaveTextContent(`addr:${WPLS}:369`);
    fireEvent.click(toggleBtn);
    expect(screen.queryByTestId("address-preview")).not.toBeInTheDocument();
  });

  it("mounts the TxPreview for a tx item when expanded", () => {
    const { container } = renderWithProviders(
      <WorkspaceItemRow
        item={addrItem({ kind: "tx", value: "0xdeadbeef" })}
        canonicalHref="/tx/0xdeadbeef"
        onRemove={() => {}}
      />,
    );
    fireEvent.click(within(container).getAllByRole("button")[0]!);
    expect(screen.getByTestId("tx-preview")).toHaveTextContent("tx:0xdeadbeef:369");
  });

  it("mounts the BlockPreview for a block item when expanded", () => {
    const { container } = renderWithProviders(
      <WorkspaceItemRow
        item={addrItem({ kind: "block", value: "26804492" })}
        canonicalHref="/block/26804492"
        onRemove={() => {}}
      />,
    );
    fireEvent.click(within(container).getAllByRole("button")[0]!);
    expect(screen.getByTestId("block-preview")).toHaveTextContent("block:26804492:369");
  });

  it("invokes onRemove when the remove button is clicked", () => {
    const onRemove = vi.fn();
    const { container } = renderWithProviders(
      <WorkspaceItemRow item={addrItem()} canonicalHref="/address/wpls" onRemove={onRemove} />,
    );
    // [expand, remove] — remove is the second.
    fireEvent.click(within(container).getAllByRole("button")[1]!);
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("renders 'just now' for a fresh item", () => {
    renderWithProviders(
      <WorkspaceItemRow
        item={addrItem({ addedAt: Date.now() })}
        canonicalHref="/address/wpls"
        onRemove={() => {}}
      />,
    );
    expect(screen.getByText(/just now/)).toBeInTheDocument();
  });

  it("formats relative time in minutes, hours, and days", () => {
    const cases: [number, RegExp][] = [
      [5 * 60_000, /5m ago/], // minutes branch
      [3 * 3_600_000, /3h ago/], // hours branch
      [2 * 86_400_000, /2d ago/], // days branch
    ];
    for (const [ago, re] of cases) {
      const { unmount } = renderWithProviders(
        <WorkspaceItemRow
          item={addrItem({ addedAt: Date.now() - ago })}
          canonicalHref="/address/wpls"
          onRemove={() => {}}
        />,
      );
      expect(screen.getByText(re)).toBeInTheDocument();
      unmount();
    }
  });
});
