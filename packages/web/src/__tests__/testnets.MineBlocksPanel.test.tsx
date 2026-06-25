import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

/**
 * MineBlocksPanel — instant-mines N blocks on an Anvil fork of PulseChain
 * (chain 369, https://scan.pulsechain.com), then calls onMined so the parent
 * re-fetches the fork's current block.
 */

const mineBlocks = vi.fn();
vi.mock("../api/testnets", () => ({
  mineBlocks: (...a: unknown[]) => mineBlocks(...a),
}));

import { MineBlocksPanel } from "../components/testnets/ForkControls/MineBlocksPanel";

const FORK_ID = "fork-abc123";

beforeEach(() => vi.clearAllMocks());

describe("MineBlocksPanel", () => {
  it("mines the entered count (singular message) and calls onMined", async () => {
    mineBlocks.mockResolvedValue(undefined);
    const onMined = vi.fn();
    render(<MineBlocksPanel forkId={FORK_ID} onMined={onMined} />);

    fireEvent.click(screen.getByRole("button", { name: "Mine" }));
    await waitFor(() => expect(mineBlocks).toHaveBeenCalledWith(FORK_ID, 1));
    await screen.findByText("Mined 1 block");
    expect(onMined).toHaveBeenCalled();
  });

  it("pluralizes the message for >1 block", async () => {
    mineBlocks.mockResolvedValue(undefined);
    render(<MineBlocksPanel forkId={FORK_ID} onMined={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText("Count"), {
      target: { value: "12" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Mine" }));
    await screen.findByText("Mined 12 blocks");
  });

  it("ignores invalid counts (no api call)", () => {
    render(<MineBlocksPanel forkId={FORK_ID} onMined={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText("Count"), {
      target: { value: "0" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Mine" }));
    expect(mineBlocks).not.toHaveBeenCalled();
  });

  it("surfaces an error on failure", async () => {
    mineBlocks.mockRejectedValue(new Error("evm_mine failed"));
    render(<MineBlocksPanel forkId={FORK_ID} onMined={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Mine" }));
    await screen.findByText("Error: evm_mine failed");
  });

  it("uses the generic message for a non-Error rejection", async () => {
    mineBlocks.mockRejectedValue("boom");
    render(<MineBlocksPanel forkId={FORK_ID} onMined={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Mine" }));
    await screen.findByText("Error: Failed to mine blocks");
  });
});
