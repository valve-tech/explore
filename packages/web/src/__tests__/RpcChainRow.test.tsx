import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RpcChainRow } from "../components/settings/RpcChainRow";
import { rpcOverrideKey } from "../lib/rpcEndpoint";

/**
 * One chain's BYO-RPC editor. Drives the set / clear / validation branches and
 * the source label ("Explore backend" vs "your node"). Anchored on PulseChain
 * (chain 369, https://scan.pulsechain.com).
 */
const CHAIN_ID = 369;
const KEY = rpcOverrideKey(CHAIN_ID);

describe("<RpcChainRow />", () => {
  beforeEach(() => localStorage.clear());

  it("shows 'Explore backend' with no override set, Clear disabled", () => {
    render(<RpcChainRow chainId={CHAIN_ID} name="PulseChain" />);
    expect(screen.getByText("Explore backend")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear" })).toBeDisabled();
  });

  it("shows 'your node' when an override is already stored", () => {
    localStorage.setItem(KEY, "https://node.example/rpc");
    render(<RpcChainRow chainId={CHAIN_ID} name="PulseChain" />);
    expect(screen.getByText("your node")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear" })).toBeEnabled();
  });

  it("Set persists a valid URL, flips the label, and fires onChange", () => {
    const onChange = vi.fn();
    render(
      <RpcChainRow chainId={CHAIN_ID} name="PulseChain" onChange={onChange} />,
    );
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "https://node.example/rpc" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Set" }));

    expect(localStorage.getItem(KEY)).toBe("https://node.example/rpc");
    expect(screen.getByText("your node")).toBeInTheDocument();
    expect(onChange).toHaveBeenCalledWith("https://node.example/rpc");
  });

  it("Set on an empty draft shows the 'enter a URL' error", () => {
    render(<RpcChainRow chainId={CHAIN_ID} name="PulseChain" />);
    fireEvent.click(screen.getByRole("button", { name: "Set" }));
    expect(screen.getByText("Enter an http(s) RPC URL.")).toBeInTheDocument();
  });

  it("Set on a non-http value shows the 'not valid' error and writes nothing", () => {
    render(<RpcChainRow chainId={CHAIN_ID} name="PulseChain" />);
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "javascript:alert(1)" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Set" }));
    expect(screen.getByText("Not a valid http(s) URL.")).toBeInTheDocument();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("typing after an error clears the error message", () => {
    render(<RpcChainRow chainId={CHAIN_ID} name="PulseChain" />);
    fireEvent.click(screen.getByRole("button", { name: "Set" }));
    expect(screen.getByText("Enter an http(s) RPC URL.")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "h" },
    });
    expect(
      screen.queryByText("Enter an http(s) RPC URL."),
    ).not.toBeInTheDocument();
  });

  it("Enter key in the input applies the override", () => {
    render(<RpcChainRow chainId={CHAIN_ID} name="PulseChain" />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "https://node.example/rpc" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(localStorage.getItem(KEY)).toBe("https://node.example/rpc");
  });

  it("Clear removes the override, resets the label, and fires onChange(null)", () => {
    const onChange = vi.fn();
    localStorage.setItem(KEY, "https://node.example/rpc");
    render(
      <RpcChainRow chainId={CHAIN_ID} name="PulseChain" onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(screen.getByText("Explore backend")).toBeInTheDocument();
    expect(onChange).toHaveBeenCalledWith(null);
  });
});
