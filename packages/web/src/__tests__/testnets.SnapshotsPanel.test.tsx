import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

/**
 * SnapshotsPanel — takes/reverts Anvil snapshots on a fork of PulseChain
 * (chain 369, https://scan.pulsechain.com). Snapshot ids mirror Anvil's
 * evm_snapshot hex handles (e.g. "0x1").
 */

const takeSnapshot = vi.fn();
const revertSnapshot = vi.fn();
vi.mock("../api/testnets", () => ({
  takeSnapshot: (...a: unknown[]) => takeSnapshot(...a),
  revertSnapshot: (...a: unknown[]) => revertSnapshot(...a),
}));

import { SnapshotsPanel } from "../components/testnets/ForkControls/SnapshotsPanel";

const FORK_ID = "fork-abc123";

beforeEach(() => vi.clearAllMocks());

describe("SnapshotsPanel", () => {
  it("takes a snapshot and lists it", async () => {
    takeSnapshot.mockResolvedValue("0x1");
    render(<SnapshotsPanel forkId={FORK_ID} onReverted={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Take Snapshot" }));
    await waitFor(() => expect(takeSnapshot).toHaveBeenCalledWith(FORK_ID));
    await screen.findByText("Snapshot created: 0x1");
    expect(screen.getByText("0x1")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Revert" })).toBeTruthy();
  });

  it("reverts to a listed snapshot and notifies the parent", async () => {
    takeSnapshot.mockResolvedValue("0x2");
    revertSnapshot.mockResolvedValue(true);
    const onReverted = vi.fn();
    render(<SnapshotsPanel forkId={FORK_ID} onReverted={onReverted} />);

    fireEvent.click(screen.getByRole("button", { name: "Take Snapshot" }));
    await screen.findByRole("button", { name: "Revert" });

    fireEvent.click(screen.getByRole("button", { name: "Revert" }));
    await waitFor(() =>
      expect(revertSnapshot).toHaveBeenCalledWith(FORK_ID, "0x2"),
    );
    await screen.findByText("Reverted to snapshot 0x2");
    expect(onReverted).toHaveBeenCalled();
  });

  it("surfaces an error when taking a snapshot fails", async () => {
    takeSnapshot.mockRejectedValue(new Error("evm_snapshot failed"));
    render(<SnapshotsPanel forkId={FORK_ID} onReverted={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Take Snapshot" }));
    await screen.findByText("Error: evm_snapshot failed");
  });

  it("surfaces an error when reverting fails", async () => {
    takeSnapshot.mockResolvedValue("0x3");
    revertSnapshot.mockRejectedValue(new Error("snapshot expired"));
    render(<SnapshotsPanel forkId={FORK_ID} onReverted={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Take Snapshot" }));
    await screen.findByRole("button", { name: "Revert" });
    fireEvent.click(screen.getByRole("button", { name: "Revert" }));
    await screen.findByText("Error: snapshot expired");
  });

  it("uses the generic messages for non-Error rejections (take + revert)", async () => {
    takeSnapshot.mockRejectedValueOnce("boom");
    render(<SnapshotsPanel forkId={FORK_ID} onReverted={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Take Snapshot" }));
    await screen.findByText("Error: Failed to snapshot");

    takeSnapshot.mockResolvedValueOnce("0x9");
    revertSnapshot.mockRejectedValueOnce("boom");
    fireEvent.click(screen.getByRole("button", { name: "Take Snapshot" }));
    await screen.findByRole("button", { name: "Revert" });
    fireEvent.click(screen.getByRole("button", { name: "Revert" }));
    await screen.findByText("Error: Failed to revert");
  });
});
