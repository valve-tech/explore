import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderWithProviders } from "./_test-utils";
import { screen, fireEvent, waitFor } from "@testing-library/react";

/**
 * CreateForkDialog — modal form that forks a launch-set chain into an Anvil
 * testnet. Defaults its chain to the active chain (PulseChain 369,
 * https://scan.pulsechain.com). Returned ForkInfo mirrors the API shape.
 */

const createFork = vi.fn();
vi.mock("../api/testnets", () => ({
  createFork: (...a: unknown[]) => createFork(...a),
}));
vi.mock("../lib/activeChain", () => ({ useActiveChainId: () => 369 }));

import CreateForkDialog from "../components/testnets/CreateForkDialog";

const FORK = {
  id: "fork-abc123",
  port: 8545,
  rpcUrl: "http://localhost:10100/api/testnets/fork-abc123/rpc",
  blockNumber: "latest" as const,
  label: "My TestNet",
  createdAt: new Date().toISOString(),
  pid: 4242,
  chainId: 369,
};

beforeEach(() => vi.clearAllMocks());

describe("CreateForkDialog", () => {
  it("creates a fork with defaults (active chain, no label/block) then onCreated", async () => {
    createFork.mockResolvedValue(FORK);
    const onCreated = vi.fn();
    renderWithProviders(
      <CreateForkDialog onCreated={onCreated} onCancel={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Create TestNet" }));

    await waitFor(() =>
      expect(createFork).toHaveBeenCalledWith({
        chainId: 369,
        label: undefined,
        blockNumber: undefined,
      }),
    );
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(FORK));
  });

  it("passes a chosen chain, trimmed label, and parsed block number", async () => {
    createFork.mockResolvedValue(FORK);
    const onCreated = vi.fn();
    renderWithProviders(
      <CreateForkDialog onCreated={onCreated} onCancel={vi.fn()} />,
    );

    // Pick Ethereum from the chain pills.
    fireEvent.click(screen.getByRole("button", { name: /Ethereum/ }));
    fireEvent.change(screen.getByPlaceholderText("My TestNet"), {
      target: { value: "  Whale fork  " },
    });
    fireEvent.change(screen.getByPlaceholderText("latest"), {
      target: { value: "19000000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create TestNet" }));

    await waitFor(() =>
      expect(createFork).toHaveBeenCalledWith({
        chainId: 1,
        label: "Whale fork",
        blockNumber: 19000000,
      }),
    );
  });

  it("shows an error message on failure and stays open", async () => {
    createFork.mockRejectedValue(new Error("no anvil binary on PATH"));
    const onCreated = vi.fn();
    renderWithProviders(
      <CreateForkDialog onCreated={onCreated} onCancel={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Create TestNet" }));
    await screen.findByText("no anvil binary on PATH");
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("uses the generic message for a non-Error rejection", async () => {
    createFork.mockRejectedValue("boom");
    renderWithProviders(
      <CreateForkDialog onCreated={vi.fn()} onCancel={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Create TestNet" }));
    await screen.findByText("Failed to create testnet");
  });

  it("cancels via the Cancel button", () => {
    const onCancel = vi.fn();
    renderWithProviders(
      <CreateForkDialog onCreated={vi.fn()} onCancel={onCancel} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
  });

  it("cancels when clicking the backdrop, but not the dialog body", () => {
    const onCancel = vi.fn();
    const { container } = renderWithProviders(
      <CreateForkDialog onCreated={vi.fn()} onCancel={onCancel} />,
    );
    // Clicking the heading (inside the dialog) must not close.
    fireEvent.click(screen.getByText("Create Virtual TestNet"));
    expect(onCancel).not.toHaveBeenCalled();

    // The outermost element is the backdrop overlay.
    fireEvent.click(container.firstChild as Element);
    expect(onCancel).toHaveBeenCalled();
  });
});
