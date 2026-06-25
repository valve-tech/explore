import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "./_test-utils";
import { BulkPastePanel } from "../components/workspace/BulkPastePanel";
import type { Workspace } from "../lib/workspace/types";

/**
 * Bulk-paste panel: the user pastes a free-form blob, the real parser
 * (lib/workspace/bulkParse) sniffs entities, and the preview shows the
 * fresh-vs-already-present split + per-kind chips before a single Add.
 *
 * Real on-chain fixtures (chain 369):
 *   WPLS address  https://scan.pulsechain.com/address/0xa1077a294dde1b09bb078844df40758a5d0f9a27
 *   transfer tx   https://scan.pulsechain.com/tx/0xd515ef07d4308c389b05fe13c55ac1ebe3270bd8bbf4470b0a134a1766fe3c81
 *   block         https://scan.pulsechain.com/block/26804492
 */

const WPLS = "0xa1077a294dde1b09bb078844df40758a5d0f9a27";
const TX = "0xd515ef07d4308c389b05fe13c55ac1ebe3270bd8bbf4470b0a134a1766fe3c81";
const BLOCK = "26804492";

function workspace(items: { kind: "address" | "tx" | "block"; value: string }[] = []): Workspace {
  return {
    id: "w1",
    name: "bags",
    createdAt: 1,
    updatedAt: 1,
    items: items.map((it, i) => ({ id: `i${i}`, kind: it.kind, value: it.value, chainId: 369, addedAt: 1 })),
  };
}

describe("<BulkPastePanel />", () => {
  it("starts with the Add button disabled and no detection summary", () => {
    renderWithProviders(
      <BulkPastePanel workspace={workspace()} onAdd={async () => {}} onClose={() => {}} />,
    );
    const addBtn = screen.getByRole("button", { name: /Add 0 items/ });
    expect(addBtn).toBeDisabled();
    expect(screen.queryByText(/Detected/)).not.toBeInTheDocument();
  });

  it("detects a mix of kinds and renders per-kind chips", () => {
    renderWithProviders(
      <BulkPastePanel workspace={workspace()} onAdd={async () => {}} onClose={() => {}} />,
    );
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: `${WPLS}\n${TX}\n${BLOCK}` },
    });
    expect(screen.getByText(/Detected/)).toBeInTheDocument();
    expect(screen.getByText(/1 address/)).toBeInTheDocument();
    expect(screen.getByText(/1 tx/)).toBeInTheDocument();
    expect(screen.getByText(/1 block/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add 3 items/ })).toBeEnabled();
  });

  it("pluralizes chip labels for multiple entries of a kind", () => {
    const ADDR2 = "0x2b591e99afe9f32eaa6214f7b7629768c40eeb39";
    renderWithProviders(
      <BulkPastePanel workspace={workspace()} onAdd={async () => {}} onClose={() => {}} />,
    );
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: `${WPLS}\n${ADDR2}` },
    });
    expect(screen.getByText(/2 addresses/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add 2 items/ })).toBeEnabled();
  });

  it("counts an entry already in the workspace as 'already here' and excludes it", () => {
    renderWithProviders(
      <BulkPastePanel
        workspace={workspace([{ kind: "address", value: WPLS }])}
        onAdd={async () => {}}
        onClose={() => {}}
      />,
    );
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: `${WPLS}\n${TX}` },
    });
    // 2 detected; WPLS already present → 1 new.
    expect(screen.getByText(/1 already here/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add 1 item$/ })).toBeEnabled();
  });

  it("calls onAdd with only the fresh items, then clears and closes", async () => {
    const onAdd = vi.fn(async () => {});
    const onClose = vi.fn();
    renderWithProviders(
      <BulkPastePanel workspace={workspace()} onAdd={onAdd} onClose={onClose} />,
    );
    fireEvent.change(screen.getByRole("textbox"), { target: { value: WPLS } });
    fireEvent.click(screen.getByRole("button", { name: /Add 1 item$/ }));

    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
    const passed = (onAdd.mock.calls[0] as unknown[])[0] as { kind: string; value: string }[];
    expect(passed).toEqual([{ kind: "address", value: WPLS }]);
    expect(onClose).toHaveBeenCalled();
  });

  it("closes via the header close (icon) button and the Cancel button", () => {
    const onClose = vi.fn();
    renderWithProviders(
      <BulkPastePanel workspace={workspace()} onAdd={async () => {}} onClose={onClose} />,
    );
    // Header close is icon-only (no accessible name); Cancel has text.
    const iconClose = screen.getAllByRole("button").find((b) => b.textContent?.trim() === "")!;
    fireEvent.click(iconClose);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
