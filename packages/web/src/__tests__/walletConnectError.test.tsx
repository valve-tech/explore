import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * WalletConnectButton — supplemental coverage for the disconnected-with-error
 * branch (the popover that explains a connect failure), which the mock-connector
 * happy-path test in walletConnect.test.tsx can't reach. We mock wagmi's hooks
 * directly so we can place a real error into useConnect().error.
 *
 * A connected wallet is an EOA; the chip truncates its address. Chain explorer:
 * https://scan.pulsechain.com
 */

const useAccount = vi.fn();
const useConnect = vi.fn();
const useDisconnect = vi.fn();

vi.mock("wagmi", () => ({
  useAccount: () => useAccount(),
  useConnect: () => useConnect(),
  useDisconnect: () => useDisconnect(),
}));

import { WalletConnectButton } from "../components/wallet/WalletConnectButton";

function renderBtn() {
  return render(
    <MemoryRouter>
      <WalletConnectButton />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  useDisconnect.mockReturnValue({ disconnect: vi.fn() });
});

describe("WalletConnectButton — error popover", () => {
  it("shows a real error message in the popover", () => {
    useAccount.mockReturnValue({ isConnected: false, address: undefined });
    useConnect.mockReturnValue({
      connectors: [{ id: "injected" }],
      connectAsync: vi.fn(),
      isPending: false,
      error: new Error("Something exploded"),
      reset: vi.fn(),
    });
    renderBtn();
    expect(screen.getByText("Something exploded")).toBeInTheDocument();
  });

  it("maps a 'No injected' error to the install-wallet hint", () => {
    useAccount.mockReturnValue({ isConnected: false, address: undefined });
    useConnect.mockReturnValue({
      connectors: [{ id: "injected" }],
      connectAsync: vi.fn(),
      isPending: false,
      error: new Error("No injected provider found"),
      reset: vi.fn(),
    });
    renderBtn();
    expect(screen.getByText(/No wallet detected/)).toBeInTheDocument();
  });

  it("hides the popover for a user-rejection error and resets immediately", () => {
    const reset = vi.fn();
    useAccount.mockReturnValue({ isConnected: false, address: undefined });
    const err = new Error("User rejected the request");
    useConnect.mockReturnValue({
      connectors: [{ id: "injected" }],
      connectAsync: vi.fn(),
      isPending: false,
      error: err,
      reset,
    });
    renderBtn();
    expect(screen.queryByText(/User rejected/)).not.toBeInTheDocument();
  });

  it("auto-dismisses a real error after the timeout", () => {
    vi.useFakeTimers();
    const reset = vi.fn();
    useAccount.mockReturnValue({ isConnected: false, address: undefined });
    useConnect.mockReturnValue({
      connectors: [{ id: "injected" }],
      connectAsync: vi.fn(),
      isPending: false,
      error: new Error("transient"),
      reset,
    });
    renderBtn();
    act(() => {
      vi.advanceTimersByTime(6000);
    });
    expect(reset).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("shows 'Connecting…' while a connect is pending", () => {
    useAccount.mockReturnValue({ isConnected: false, address: undefined });
    useConnect.mockReturnValue({
      connectors: [{ id: "injected" }],
      connectAsync: vi.fn(),
      isPending: true,
      error: null,
      reset: vi.fn(),
    });
    renderBtn();
    expect(screen.getByText("Connecting…")).toBeInTheDocument();
  });

  it("no-op connect click when no connector is present", () => {
    useAccount.mockReturnValue({ isConnected: false, address: undefined });
    const connectAsync = vi.fn();
    useConnect.mockReturnValue({
      connectors: [],
      connectAsync,
      isPending: false,
      error: null,
      reset: vi.fn(),
    });
    renderBtn();
    // disabled button — clicking does nothing
    const btn = screen.getByRole("button", { name: /connect wallet/i });
    btn.click();
    expect(connectAsync).not.toHaveBeenCalled();
  });

  it("opens and closes the connected popover (chip + mouseLeave + disconnect)", () => {
    const disconnect = vi.fn();
    useDisconnect.mockReturnValue({ disconnect });
    const addr = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
    useAccount.mockReturnValue({ isConnected: true, address: addr });
    useConnect.mockReturnValue({
      connectors: [{ id: "injected" }],
      connectAsync: vi.fn(),
      isPending: false,
      error: null,
      reset: vi.fn(),
    });
    renderBtn();
    const chip = screen.getByRole("button", { name: /0x7099/ });
    fireEvent.click(chip);
    // popover open → full address shown
    expect(screen.getByText(addr)).toBeInTheDocument();
    // mouseLeave on the popover closes it (line 115 handler)
    const popover = screen.getByText("Connected").parentElement!;
    fireEvent.mouseLeave(popover);
    // re-open and disconnect
    fireEvent.click(chip);
    fireEvent.click(screen.getByRole("button", { name: /disconnect/i }));
    expect(disconnect).toHaveBeenCalled();
  });

  it("attempts connect (calling reset + connectAsync) when a connector exists", async () => {
    const reset = vi.fn();
    const connectAsync = vi.fn().mockRejectedValue(new Error("rejected"));
    useAccount.mockReturnValue({ isConnected: false, address: undefined });
    useConnect.mockReturnValue({
      connectors: [{ id: "injected" }],
      connectAsync,
      isPending: false,
      error: null,
      reset,
    });
    renderBtn();
    screen.getByRole("button", { name: /connect wallet/i }).click();
    expect(reset).toHaveBeenCalled();
    await waitFor(() => expect(connectAsync).toHaveBeenCalled());
  });
});
