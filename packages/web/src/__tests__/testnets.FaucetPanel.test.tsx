import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

/**
 * FaucetPanel — funds an address with native PLS on an Anvil fork of
 * PulseChain (chain 369, https://scan.pulsechain.com). Recipient fixture is a
 * checksummed PulseChain address; amount is in PLS (not wei).
 */

const fundAddress = vi.fn();
vi.mock("../api/testnets", () => ({
  fundAddress: (...a: unknown[]) => fundAddress(...a),
}));

import { FaucetPanel } from "../components/testnets/ForkControls/FaucetPanel";

const FORK_ID = "fork-abc123";
const RECIPIENT = "0xA1077a294dDE1B09bB078844df40758a5D0f9a27"; // WPLS contract addr as a valid 0x target

beforeEach(() => vi.clearAllMocks());

describe("FaucetPanel", () => {
  it("Fund is disabled until an address is entered", () => {
    render(<FaucetPanel forkId={FORK_ID} />);
    expect(screen.getByRole("button", { name: "Fund" })).toBeDisabled();
  });

  it("funds the trimmed address with the entered amount and clears the field", async () => {
    fundAddress.mockResolvedValue(undefined);
    render(<FaucetPanel forkId={FORK_ID} />);

    const addr = screen.getByPlaceholderText("0x... address");
    fireEvent.change(addr, { target: { value: RECIPIENT } });
    fireEvent.change(screen.getByPlaceholderText("Amount (PLS)"), {
      target: { value: "5000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Fund" }));

    await waitFor(() =>
      expect(fundAddress).toHaveBeenCalledWith(FORK_ID, RECIPIENT, "5000"),
    );
    // The success message slices the first 10 chars of the address.
    await screen.findByText("Funded 5000 PLS to 0xA1077a29...");
    expect((addr as HTMLInputElement).value).toBe("");
  });

  it("surfaces an error message on failure", async () => {
    fundAddress.mockRejectedValue(new Error("insufficient faucet balance"));
    render(<FaucetPanel forkId={FORK_ID} />);

    fireEvent.change(screen.getByPlaceholderText("0x... address"), {
      target: { value: RECIPIENT },
    });
    fireEvent.click(screen.getByRole("button", { name: "Fund" }));

    await screen.findByText("Error: insufficient faucet balance");
  });

  it("keeps Fund disabled for a whitespace-only address", () => {
    render(<FaucetPanel forkId={FORK_ID} />);
    fireEvent.change(screen.getByPlaceholderText("0x... address"), {
      target: { value: "   " },
    });
    expect(screen.getByRole("button", { name: "Fund" })).toBeDisabled();
    expect(fundAddress).not.toHaveBeenCalled();
  });

  it("uses the generic message for a non-Error rejection", async () => {
    fundAddress.mockRejectedValue("boom");
    render(<FaucetPanel forkId={FORK_ID} />);
    fireEvent.change(screen.getByPlaceholderText("0x... address"), {
      target: { value: RECIPIENT },
    });
    fireEvent.click(screen.getByRole("button", { name: "Fund" }));
    await screen.findByText("Error: Failed to fund");
  });
});
