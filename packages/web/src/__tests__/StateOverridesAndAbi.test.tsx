import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { StateOverride } from "../types";
import StateOverrides from "../components/StateOverrides";
import AbiInput from "../components/AbiInput";

/**
 * StateOverrides (add/remove override rows, storage-slot editor) and AbiInput
 * (paste JSON vs auto-fetch) — both are controlled components driven entirely
 * by props, so no providers/mocks are needed.
 *
 * Fixture address: WPLS 0xA1077a294dDE1B09bB078844df40758a5D0f9a27 (PulseChain 369)
 * https://scan.pulsechain.com/address/0xA1077a294dDE1B09bB078844df40758a5D0f9a27
 */

const WPLS = "0xA1077a294dDE1B09bB078844df40758a5D0f9a27";

describe("StateOverrides", () => {
  it("is collapsed initially and shows no override rows", () => {
    render(<StateOverrides overrides={[]} onChange={vi.fn()} />);
    expect(screen.getByText("State Overrides")).toBeInTheDocument();
    expect(screen.queryByText(/Add State Override/)).not.toBeInTheDocument();
  });

  it("adding an override expands the panel and emits a new override entry", () => {
    const onChange = vi.fn();
    render(<StateOverrides overrides={[]} onChange={onChange} />);
    // Expand
    fireEvent.click(screen.getByText("State Overrides"));
    fireEvent.click(screen.getByRole("button", { name: /Add State Override/ }));
    expect(onChange).toHaveBeenCalledWith([
      { address: "", balance: "", nonce: "", code: "", storage: {} },
    ]);
  });

  it("renders a count badge and the override fields when overrides exist", () => {
    const overrides: StateOverride[] = [
      { address: WPLS, balance: "0x1", nonce: "0x0", code: "", storage: {} },
    ];
    render(<StateOverrides overrides={overrides} onChange={vi.fn()} />);
    fireEvent.click(screen.getByText("State Overrides"));
    expect(screen.getByText(/1 override/)).toBeInTheDocument();
    expect(screen.getByText("Override #1")).toBeInTheDocument();
    expect(screen.getByDisplayValue(WPLS)).toBeInTheDocument();
  });

  it("editing the address field emits the updated override", () => {
    const overrides: StateOverride[] = [
      { address: "", balance: "", nonce: "", code: "", storage: {} },
    ];
    const onChange = vi.fn();
    render(<StateOverrides overrides={overrides} onChange={onChange} />);
    fireEvent.click(screen.getByText("State Overrides"));
    // address + balance both use "0x..."; the address field is the first.
    fireEvent.change(screen.getAllByPlaceholderText("0x...")[0]!, {
      target: { value: WPLS },
    });
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ address: WPLS }),
    ]);
  });

  it("editing balance, nonce and code emits updates for each field", () => {
    const overrides: StateOverride[] = [
      { address: WPLS, balance: "", nonce: "", code: "", storage: {} },
    ];
    const onChange = vi.fn();
    render(<StateOverrides overrides={overrides} onChange={onChange} />);
    fireEvent.click(screen.getByText("State Overrides"));

    // address + balance both use "0x..."; the balance field is the second one.
    const zeroXInputs = screen.getAllByPlaceholderText("0x...");
    fireEvent.change(zeroXInputs[1]!, { target: { value: "0xff" } });
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ balance: "0xff" }),
    ]);

    const nonceInput = screen.getByPlaceholderText("0x0");
    fireEvent.change(nonceInput, { target: { value: "0x5" } });
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ nonce: "0x5" }),
    ]);

    const codeInput = screen.getByPlaceholderText("0x608060...");
    fireEvent.change(codeInput, { target: { value: "0x6080" } });
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ code: "0x6080" }),
    ]);
  });

  it("removing an override emits the filtered list", () => {
    const overrides: StateOverride[] = [
      { address: WPLS, storage: {} },
      { address: "", storage: {} },
    ];
    const onChange = vi.fn();
    render(<StateOverrides overrides={overrides} onChange={onChange} />);
    fireEvent.click(screen.getByText("State Overrides"));
    fireEvent.click(screen.getAllByRole("button", { name: /^Remove$/ })[0]!);
    expect(onChange).toHaveBeenCalledWith([{ address: "", storage: {} }]);
  });

  it("toggling Storage Overrides reveals the slot editor and can add a slot", () => {
    const overrides: StateOverride[] = [{ address: WPLS, storage: {} }];
    const onChange = vi.fn();
    render(<StateOverrides overrides={overrides} onChange={onChange} />);
    fireEvent.click(screen.getByText("State Overrides"));
    fireEvent.click(screen.getByText("Storage Overrides"));
    fireEvent.click(screen.getByRole("button", { name: /Add Slot/ }));
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ storage: { "": "" } }),
    ]);
  });

  it("editing and removing a storage slot emits updated storage maps", () => {
    const overrides: StateOverride[] = [
      { address: WPLS, storage: { "0x0": "0x1" } },
    ];
    const onChange = vi.fn();
    render(<StateOverrides overrides={overrides} onChange={onChange} />);
    fireEvent.click(screen.getByText("State Overrides"));
    // storage already non-empty so showStorage starts true
    const slotKey = screen.getByPlaceholderText("0x0 (slot)");
    fireEvent.change(slotKey, { target: { value: "0x2" } });
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ storage: { "0x2": "0x1" } }),
    ]);

    const slotVal = screen.getByPlaceholderText("0x... (value)");
    fireEvent.change(slotVal, { target: { value: "0x9" } });
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ storage: { "0x0": "0x9" } }),
    ]);

    // Remove the slot — the icon-only delete button in the slot row (no text,
    // theme-danger but not the override-level theme-danger-bg "Remove" button).
    const xBtn = screen
      .getAllByRole("button")
      .find(
        (b) =>
          b.textContent === "" &&
          b.className.includes("theme-danger") &&
          !b.className.includes("theme-danger-bg"),
      );
    fireEvent.click(xBtn!);
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ storage: {} }),
    ]);
  });

  it("toggling storage on a fresh override initialises an empty storage map", () => {
    const overrides: StateOverride[] = [{ address: WPLS }];
    const onChange = vi.fn();
    render(<StateOverrides overrides={overrides} onChange={onChange} />);
    fireEvent.click(screen.getByText("State Overrides"));
    fireEvent.click(screen.getByText("Storage Overrides"));
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ storage: {} }),
    ]);
  });
});

describe("AbiInput", () => {
  it("is collapsed initially; no badge with empty value", () => {
    render(<AbiInput value="" onChange={vi.fn()} />);
    expect(screen.getByText(/ABI \(optional\)/)).toBeInTheDocument();
    expect(screen.queryByText("Valid JSON")).not.toBeInTheDocument();
  });

  it("shows a Valid JSON badge for valid JSON value", () => {
    render(<AbiInput value="[]" onChange={vi.fn()} />);
    expect(screen.getByText("Valid JSON")).toBeInTheDocument();
  });

  it("shows an Invalid JSON badge for malformed value", () => {
    render(<AbiInput value="[not json" onChange={vi.fn()} />);
    expect(screen.getByText("Invalid JSON")).toBeInTheDocument();
  });

  it("shows the inline invalid-JSON error under the expanded textarea", () => {
    render(<AbiInput value="[not json" onChange={vi.fn()} />);
    fireEvent.click(screen.getByText(/ABI \(optional\)/));
    expect(
      screen.getByText(/Invalid JSON\. Please paste a valid ABI array/),
    ).toBeInTheDocument();
  });

  it("typing into the textarea emits the raw string", () => {
    const onChange = vi.fn();
    render(<AbiInput value="" onChange={onChange} />);
    fireEvent.click(screen.getByText(/ABI \(optional\)/));
    const textarea = screen.getByPlaceholderText(/"type":"function"/);
    fireEvent.change(textarea, { target: { value: "[{}]" } });
    expect(onChange).toHaveBeenCalledWith("[{}]");
  });

  it("toggling auto-fetch emits the sentinel and hides the textarea", () => {
    const onChange = vi.fn();
    render(<AbiInput value="" onChange={onChange} />);
    fireEvent.click(screen.getByText(/ABI \(optional\)/));
    expect(screen.getByText(/Auto-fetch ABI from contract/)).toBeInTheDocument();
    const checkbox = screen.getByRole("checkbox");
    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledWith("__auto_fetch__");
    // Auto-fetch hides the paste textarea
    expect(screen.queryByPlaceholderText(/"type":"function"/)).not.toBeInTheDocument();
    expect(screen.getByText("Auto-fetch")).toBeInTheDocument();

    // Un-toggle clears it
    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("renders an empty textarea when value is the auto-fetch sentinel", () => {
    render(<AbiInput value="__auto_fetch__" onChange={vi.fn()} />);
    fireEvent.click(screen.getByText(/ABI \(optional\)/));
    const textarea = screen.getByPlaceholderText(/"type":"function"/) as HTMLTextAreaElement;
    expect(textarea.value).toBe("");
  });
});
