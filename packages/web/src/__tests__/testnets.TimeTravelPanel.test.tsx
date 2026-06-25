import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

/**
 * TimeTravelPanel — advances block timestamps on an Anvil fork of PulseChain
 * (chain 369, https://scan.pulsechain.com). The live preview formats the
 * seconds input (s / m s / h m); the action calls timeTravel then onAdvanced.
 */

const timeTravel = vi.fn();
vi.mock("../api/testnets", () => ({
  timeTravel: (...a: unknown[]) => timeTravel(...a),
}));

import { TimeTravelPanel } from "../components/testnets/ForkControls/TimeTravelPanel";

const FORK_ID = "fork-abc123";

beforeEach(() => vi.clearAllMocks());

describe("TimeTravelPanel", () => {
  it("defaults to 3600s and previews it as hours/minutes", () => {
    render(<TimeTravelPanel forkId={FORK_ID} onAdvanced={vi.fn()} />);
    expect(screen.getByText("Advance 1h 0m")).toBeTruthy();
  });

  it("previews minutes+seconds for a sub-hour value", () => {
    render(<TimeTravelPanel forkId={FORK_ID} onAdvanced={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText("Seconds"), {
      target: { value: "90" },
    });
    expect(screen.getByText("Advance 1m 30s")).toBeTruthy();
  });

  it("previews bare seconds under a minute", () => {
    render(<TimeTravelPanel forkId={FORK_ID} onAdvanced={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText("Seconds"), {
      target: { value: "42" },
    });
    expect(screen.getByText("Advance 42s")).toBeTruthy();
  });

  it("falls back to the raw string in the preview when not a number", () => {
    render(<TimeTravelPanel forkId={FORK_ID} onAdvanced={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText("Seconds"), {
      target: { value: "" },
    });
    expect(screen.getByText("Advance")).toBeTruthy();
  });

  it("advances time and calls onAdvanced", async () => {
    timeTravel.mockResolvedValue(undefined);
    const onAdvanced = vi.fn();
    render(<TimeTravelPanel forkId={FORK_ID} onAdvanced={onAdvanced} />);
    fireEvent.click(screen.getByRole("button", { name: "Travel" }));
    await waitFor(() => expect(timeTravel).toHaveBeenCalledWith(FORK_ID, 3600));
    await screen.findByText("Advanced time by 3,600 seconds");
    expect(onAdvanced).toHaveBeenCalled();
  });

  it("ignores invalid (<1) input", () => {
    render(<TimeTravelPanel forkId={FORK_ID} onAdvanced={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText("Seconds"), {
      target: { value: "0" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Travel" }));
    expect(timeTravel).not.toHaveBeenCalled();
  });

  it("surfaces an error on failure", async () => {
    timeTravel.mockRejectedValue(new Error("evm_increaseTime failed"));
    render(<TimeTravelPanel forkId={FORK_ID} onAdvanced={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Travel" }));
    await screen.findByText("Error: evm_increaseTime failed");
  });

  it("uses the generic message for a non-Error rejection", async () => {
    timeTravel.mockRejectedValue("boom");
    render(<TimeTravelPanel forkId={FORK_ID} onAdvanced={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Travel" }));
    await screen.findByText("Error: Failed to time travel");
  });
});
