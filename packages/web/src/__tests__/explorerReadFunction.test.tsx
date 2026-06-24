import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "./_test-utils";
import type { AbiItem } from "../components/explorer/ContractView/types";

/**
 * ReadFunction is the contract read-call UI. It delegates the actual call to
 * callReadFunction (tested separately); here we mock that and assert the
 * expand → input → query → result/error flow.
 */
const callReadFunction = vi.fn();
vi.mock("../components/explorer/ContractView/callReadFunction", () => ({
  callReadFunction: (...a: unknown[]) => callReadFunction(...a),
}));

import { ReadFunction } from "../components/explorer/ContractView/ReadFunction";

const balanceOf: AbiItem = {
  name: "balanceOf",
  type: "function",
  stateMutability: "view",
  inputs: [{ name: "owner", type: "address" }],
  outputs: [{ name: "", type: "uint256" }],
} as AbiItem;

const ADDR = "0xA1077a294dDE1B09bB078844df40758a5D0f9a27";

beforeEach(() => vi.clearAllMocks());

describe("ReadFunction", () => {
  it("expands, takes an arg, queries, and shows the result", async () => {
    callReadFunction.mockResolvedValue({ ok: true, result: "result (uint256): 42" });
    renderWithProviders(<ReadFunction fn={balanceOf} address={ADDR} />);

    // Collapsed: the signature is shown, the Query button isn't.
    expect(screen.getByText("balanceOf")).toBeInTheDocument();
    expect(screen.queryByText("Query")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("balanceOf"));
    const input = screen.getByPlaceholderText("address");
    fireEvent.change(input, { target: { value: "0xdead" } });
    fireEvent.click(screen.getByText("Query"));

    expect(await screen.findByText("result (uint256): 42")).toBeInTheDocument();
    expect(callReadFunction).toHaveBeenCalledWith(balanceOf, ADDR, { owner: "0xdead" });
  });

  it("shows the error from a failed call", async () => {
    callReadFunction.mockResolvedValue({ ok: false, error: "execution reverted" });
    renderWithProviders(<ReadFunction fn={balanceOf} address={ADDR} />);
    fireEvent.click(screen.getByText("balanceOf"));
    fireEvent.click(screen.getByText("Query"));
    await waitFor(() =>
      expect(screen.getByText("execution reverted")).toBeInTheDocument(),
    );
  });
});
