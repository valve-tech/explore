import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

/**
 * DestroyPanel — two-step confirm then DELETE the fork. forkId mirrors the
 * opaque id our API hands back for an Anvil child of PulseChain
 * (chain 369, https://scan.pulsechain.com).
 */

const destroyFork = vi.fn();
vi.mock("../api/testnets", () => ({
  destroyFork: (...a: unknown[]) => destroyFork(...a),
}));

import { DestroyPanel } from "../components/testnets/ForkControls/DestroyPanel";

const FORK_ID = "fork-abc123";

beforeEach(() => vi.clearAllMocks());

describe("DestroyPanel", () => {
  it("requires confirmation before destroying", async () => {
    destroyFork.mockResolvedValue(undefined);
    const onDestroyed = vi.fn();
    render(<DestroyPanel forkId={FORK_ID} onDestroyed={onDestroyed} />);

    fireEvent.click(screen.getByRole("button", { name: "Destroy TestNet" }));
    expect(screen.getByText("Are you sure? This cannot be undone.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Yes, Destroy" }));
    await waitFor(() =>
      expect(destroyFork).toHaveBeenCalledWith(FORK_ID),
    );
    await waitFor(() => expect(onDestroyed).toHaveBeenCalled());
  });

  it("cancel returns to the initial button", () => {
    render(<DestroyPanel forkId={FORK_ID} onDestroyed={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Destroy TestNet" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Destroy TestNet" })).toBeTruthy();
  });

  it("on destroy failure re-enables (clears loading) without calling onDestroyed", async () => {
    destroyFork.mockRejectedValue(new Error("anvil unreachable"));
    const onDestroyed = vi.fn();
    render(<DestroyPanel forkId={FORK_ID} onDestroyed={onDestroyed} />);

    fireEvent.click(screen.getByRole("button", { name: "Destroy TestNet" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, Destroy" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Yes, Destroy" })).not.toBeDisabled(),
    );
    expect(onDestroyed).not.toHaveBeenCalled();
  });
});
