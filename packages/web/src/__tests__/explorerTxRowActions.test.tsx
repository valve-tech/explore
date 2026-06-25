import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "./_test-utils";

/**
 * TxRowActions: inline debug/fork/overflow actions next to a tx hash. Routes via
 * react-router navigate() (mocked) and copies via lib/clipboard (mocked). Real
 * WPLS transfer tx on chain 369:
 *   https://scan.pulsechain.com/tx/0xd515ef07d4308c389b05fe13c55ac1ebe3270bd8bbf4470b0a134a1766fe3c81
 */

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>(
    "react-router-dom",
  );
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock("../lib/clipboard", () => ({
  copyToClipboard: vi.fn().mockResolvedValue(undefined),
}));

import TxRowActions from "../components/explorer/TxRowActions";
import { copyToClipboard } from "../lib/clipboard";

const HASH =
  "0xd515ef07d4308c389b05fe13c55ac1ebe3270bd8bbf4470b0a134a1766fe3c81";
const CONTRACT = "0xA1077a294dDE1B09bB078844df40758a5D0f9a27";

describe("<TxRowActions />", () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    (copyToClipboard as ReturnType<typeof vi.fn>).mockClear();
  });
  afterEach(() => vi.restoreAllMocks());

  it("navigates to the debugger for the tx", () => {
    renderWithProviders(<TxRowActions hash={HASH} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Debug this transaction" }),
    );
    expect(mockNavigate).toHaveBeenCalledWith(`/debugger/${HASH}`);
  });

  it("navigates to a fork seeded from the tx", () => {
    renderWithProviders(<TxRowActions hash={HASH} />);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Simulate a fork from this transaction",
      }),
    );
    expect(mockNavigate).toHaveBeenCalledWith(`/fork?fromTx=${HASH}`);
  });

  it("opens the overflow menu and copies the tx hash", () => {
    renderWithProviders(<TxRowActions hash={HASH} />);
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByText("Copy tx hash"));
    expect(copyToClipboard).toHaveBeenCalledWith(HASH);
  });

  it("opens the menu and navigates to the explorer view", () => {
    renderWithProviders(<TxRowActions hash={HASH} />);
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByText("View in Explorer"));
    expect(mockNavigate).toHaveBeenCalledWith(`/tx/${HASH}`);
  });

  it("enables 'View contract storage' only when a contract address is given", () => {
    renderWithProviders(
      <TxRowActions hash={HASH} contractAddress={CONTRACT} compact />,
    );
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    const storage = screen.getByText("View contract storage").closest("button");
    expect(storage).not.toBeDisabled();
    fireEvent.click(storage!);
    expect(mockNavigate).toHaveBeenCalledWith(
      `/storage?address=${CONTRACT}`,
    );
  });

  it("disables 'View contract storage' (n/a) when no contract address", () => {
    renderWithProviders(<TxRowActions hash={HASH} />);
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    const storage = screen.getByText("View contract storage").closest("button");
    expect(storage).toBeDisabled();
    expect(screen.getByText("n/a")).toBeInTheDocument();
    // Clicking a disabled item does nothing.
    fireEvent.click(storage!);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("closes the overflow menu on Escape and outside click", () => {
    renderWithProviders(<TxRowActions hash={HASH} />);
    const more = screen.getByRole("button", { name: "More actions" });

    fireEvent.click(more);
    expect(screen.getByText("Copy tx hash")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByText("Copy tx hash")).not.toBeInTheDocument();

    // Re-open then dismiss via an outside mousedown.
    fireEvent.click(more);
    expect(screen.getByText("Copy tx hash")).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByText("Copy tx hash")).not.toBeInTheDocument();
  });

  it("toggles the menu closed when More actions is clicked twice", () => {
    renderWithProviders(<TxRowActions hash={HASH} />);
    const more = screen.getByRole("button", { name: "More actions" });
    fireEvent.click(more);
    expect(screen.getByText("Copy tx hash")).toBeInTheDocument();
    fireEvent.click(more);
    expect(screen.queryByText("Copy tx hash")).not.toBeInTheDocument();
  });
});
