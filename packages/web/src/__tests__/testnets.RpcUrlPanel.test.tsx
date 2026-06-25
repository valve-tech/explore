import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

/**
 * RpcUrlPanel — shows a fork's RPC endpoint + a Copy button that flips to
 * "Copied!" for 2s via copyToClipboard. Fixture mirrors a real Anvil fork of
 * PulseChain (chain 369, https://scan.pulsechain.com): the child listens on a
 * loopback port and proxies through our API.
 */

const copyToClipboard = vi.fn();
vi.mock("../lib/clipboard", () => ({
  copyToClipboard: (...a: unknown[]) => copyToClipboard(...a),
}));

import { RpcUrlPanel } from "../components/testnets/ForkControls/RpcUrlPanel";

const RPC_URL = "http://localhost:10100/api/testnets/fork-abc123/rpc";

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("RpcUrlPanel", () => {
  it("renders the rpc url", () => {
    render(<RpcUrlPanel rpcUrl={RPC_URL} />);
    expect(screen.getByText(RPC_URL)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy();
  });

  it("copies the url and flips the label, then resets after 2s", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    copyToClipboard.mockResolvedValue(true);
    render(<RpcUrlPanel rpcUrl={RPC_URL} />);

    fireEvent.click(screen.getByRole("button", { name: "Copy" }));

    expect(copyToClipboard).toHaveBeenCalledWith(RPC_URL);
    await screen.findByRole("button", { name: "Copied!" });

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy(),
    );
  });
});
