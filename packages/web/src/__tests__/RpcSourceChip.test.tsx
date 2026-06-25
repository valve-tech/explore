import { describe, it, expect, beforeEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { RpcSourceChip } from "../components/settings/RpcSourceChip";
import { renderWithProviders } from "./_test-utils";
import { rpcOverrideKey } from "../lib/rpcEndpoint";

/**
 * Top-bar RPC source chip. The active chain comes from the `?chainid` URL param
 * (useActiveChainId); the label derives from whether that chain has a BYO-RPC
 * override. Opening the popover reveals the shared RpcChainRow + a Settings
 * link, and an outside click closes it. Anchored on PulseChain (369) and
 * Ethereum (1) — https://scan.pulsechain.com.
 */

describe("<RpcSourceChip />", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to the PulseChain backend label when no chainid + no override", () => {
    renderWithProviders(<RpcSourceChip />, { initialEntries: ["/explorer"] });
    expect(screen.getByText("backend")).toBeInTheDocument();
  });

  it("reads the active chain from ?chainid and shows 'your node' when overridden", () => {
    // Ethereum (1) has a BYO-RPC override set.
    localStorage.setItem(rpcOverrideKey(1), "https://eth.example/rpc");
    renderWithProviders(<RpcSourceChip />, {
      initialEntries: ["/explorer?chainid=1"],
    });
    expect(screen.getByText("your node")).toBeInTheDocument();
  });

  it("falls back to 'Chain N' for an unregistered chain id", () => {
    renderWithProviders(<RpcSourceChip />, {
      initialEntries: ["/explorer?chainid=999"],
    });
    fireEvent.click(screen.getByRole("button", { name: /backend/i }));
    expect(screen.getByText(/RPC source · Chain 999/)).toBeInTheDocument();
  });

  it("toggles the popover open and closed via the chip button", () => {
    renderWithProviders(<RpcSourceChip />, { initialEntries: ["/explorer"] });
    const button = screen.getByRole("button", { name: /backend/i });

    fireEvent.click(button);
    expect(screen.getByText(/RPC source ·/)).toBeInTheDocument();
    // Popover reuses RpcChainRow → has the node URL input + a Settings link.
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /All chains & settings/i }),
    ).toBeInTheDocument();

    fireEvent.click(button);
    expect(screen.queryByText(/RPC source ·/)).not.toBeInTheDocument();
  });

  it("an outside mousedown closes the open popover", () => {
    renderWithProviders(<RpcSourceChip />, { initialEntries: ["/explorer"] });
    fireEvent.click(screen.getByRole("button", { name: /backend/i }));
    expect(screen.getByText(/RPC source ·/)).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    expect(screen.queryByText(/RPC source ·/)).not.toBeInTheDocument();
  });

  it("clicking the 'All chains & settings' link closes the popover", () => {
    renderWithProviders(<RpcSourceChip />, { initialEntries: ["/explorer"] });
    fireEvent.click(screen.getByRole("button", { name: /backend/i }));
    fireEvent.click(
      screen.getByRole("link", { name: /All chains & settings/i }),
    );
    expect(screen.queryByText(/RPC source ·/)).not.toBeInTheDocument();
  });

  it("editing the RPC in the popover re-derives the chip label to 'your node'", () => {
    renderWithProviders(<RpcSourceChip />, {
      initialEntries: ["/explorer?chainid=369"],
    });
    fireEvent.click(screen.getByRole("button", { name: /backend/i }));
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "https://pls.example/rpc" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Set" }));
    // The chip bumps its counter on onChange → re-reads localStorage. Both the
    // chip label span and the RpcChainRow source <code> now say "your node".
    expect(screen.getAllByText("your node").length).toBe(2);
  });
});
