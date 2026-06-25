import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "./_test-utils";

/**
 * Supplemental TransactionBuilder coverage — read-tab switch + empty list,
 * the loading message, the success/revert result block, the error block, and
 * the "Debug This Transaction" navigate. Base flow lives in
 * TransactionBuilder.test.tsx.
 *
 * Fixture: WPLS 0xA1077a294dDE1B09bB078844df40758a5D0f9a27 (PulseChain 369)
 * https://scan.pulsechain.com/address/0xA1077a294dDE1B09bB078844df40758a5D0f9a27
 */

const sourceMock = vi.fn();
vi.mock("../hooks/useContractSource", () => ({
  useContractSource: (...a: unknown[]) => sourceMock(...a),
}));

const navigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>(
    "react-router-dom",
  );
  return { ...actual, useNavigate: () => navigate };
});

import TransactionBuilder from "../components/TransactionBuilder";

const CONTRACT = "0xA1077a294dDE1B09bB078844df40758a5D0f9a27";

const ABI = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }],
    outputs: [{ type: "bool" }],
  },
  {
    // no-arg function so encodeFunctionData doesn't need a filled address arg
    type: "function",
    name: "deposit",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
];

const VIEW_ONLY_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
];

beforeEach(() => {
  sourceMock.mockReset();
  navigate.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe("<TransactionBuilder /> — extra branches", () => {
  it("switches to the Read tab and shows 'No write functions' when there are none", async () => {
    sourceMock.mockReturnValue({
      data: { abi: VIEW_ONLY_ABI, contractName: "Token" },
      isLoading: false,
    });
    renderWithProviders(<TransactionBuilder />);
    fireEvent.change(screen.getByPlaceholderText("0x..."), {
      target: { value: CONTRACT },
    });

    // Write tab has 0 functions → empty-state copy
    expect(await screen.findByText(/No write functions/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Read \(1\)/ }));
    expect(screen.getByText("balanceOf")).toBeInTheDocument();
  });

  it("edits the From-address field and a function argument input", async () => {
    sourceMock.mockReturnValue({
      data: { abi: ABI, contractName: "Token" },
      isLoading: false,
    });
    renderWithProviders(<TransactionBuilder />);
    const zeroXInputs = screen.getAllByPlaceholderText(/0x/);
    const contractInput = zeroXInputs[0]!;
    const fromInput = zeroXInputs[1]!;
    fireEvent.change(contractInput, { target: { value: CONTRACT } });
    fireEvent.change(fromInput, {
      target: { value: "0x742D35CC6634c0532925A3b844BC9E7595F0BEb0" },
    });
    expect((fromInput as HTMLInputElement).value).toBe(
      "0x742D35CC6634c0532925A3b844BC9E7595F0BEb0",
    );

    // Select transfer and edit the `amount` arg input.
    fireEvent.click(await screen.findByText("transfer"));
    const amount = screen
      .getAllByRole("textbox")
      .find((el) => (el as HTMLInputElement).value === "0") as HTMLInputElement;
    fireEvent.change(amount, { target: { value: "1000" } });
    expect(amount.value).toBe("1000");

    // Toggle back to the Write tab (re-click) to exercise setShowRead(false).
    fireEvent.click(screen.getByRole("button", { name: /Read \(0\)/ }));
    fireEvent.click(screen.getByRole("button", { name: /Write \(2\)/ }));
    expect(screen.getByText("deposit")).toBeInTheDocument();
  });

  it("shows the Loading ABI message while source is loading", () => {
    sourceMock.mockReturnValue({ data: null, isLoading: true });
    renderWithProviders(<TransactionBuilder />);
    fireEvent.change(screen.getByPlaceholderText("0x..."), {
      target: { value: CONTRACT },
    });
    expect(screen.getByText(/Loading ABI/i)).toBeInTheDocument();
  });

  it("renders a SUCCESS result with state-change summary and Debug button", async () => {
    sourceMock.mockReturnValue({
      data: { abi: ABI, contractName: "Token" },
      isLoading: false,
    });
    const txHash = "0x" + "cd".repeat(32);
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        result: {
          success: true,
          gasUsed: "51234",
          txHash,
          stateDiff: {
            balanceChanges: [{ address: CONTRACT, before: "0", after: "1", delta: "1" }],
            storageChanges: [],
          },
        },
      }),
    } as Response);

    renderWithProviders(<TransactionBuilder />);
    fireEvent.change(screen.getByPlaceholderText("0x..."), {
      target: { value: CONTRACT },
    });
    fireEvent.click(await screen.findByText("deposit"));
    fireEvent.click(screen.getByRole("button", { name: /Fork Simulate/i }));

    expect(await screen.findByText("SUCCESS")).toBeInTheDocument();
    expect(screen.getByText(/Gas: 51,234/)).toBeInTheDocument();
    expect(screen.getByText(/1 balance change/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Debug This Transaction/ }));
    expect(navigate).toHaveBeenCalledWith(`/debugger/${txHash}`);
  });

  it("renders a REVERTED result with the revert reason", async () => {
    sourceMock.mockReturnValue({
      data: { abi: ABI, contractName: "Token" },
      isLoading: false,
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        result: {
          success: false,
          gasUsed: "21000",
          revertReason: "ERC20: insufficient allowance",
          stateDiff: { balanceChanges: [], storageChanges: [] },
        },
      }),
    } as Response);

    renderWithProviders(<TransactionBuilder />);
    fireEvent.change(screen.getByPlaceholderText("0x..."), {
      target: { value: CONTRACT },
    });
    fireEvent.click(await screen.findByText("deposit"));
    fireEvent.click(screen.getByRole("button", { name: /Fork Simulate/i }));

    expect(await screen.findByText("REVERTED")).toBeInTheDocument();
    expect(screen.getByText(/insufficient allowance/)).toBeInTheDocument();
  });

  it("renders an error block when the API responds not-ok", async () => {
    sourceMock.mockReturnValue({
      data: { abi: ABI, contractName: "Token" },
      isLoading: false,
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: false, error: "fork spawn failed" }),
    } as Response);

    renderWithProviders(<TransactionBuilder />);
    fireEvent.change(screen.getByPlaceholderText("0x..."), {
      target: { value: CONTRACT },
    });
    fireEvent.click(await screen.findByText("deposit"));
    fireEvent.click(screen.getByRole("button", { name: /Fork Simulate/i }));

    await waitFor(() =>
      expect(screen.getByText("fork spawn failed")).toBeInTheDocument(),
    );
  });

  it("catches an encoding error from bad argument types", async () => {
    sourceMock.mockReturnValue({
      data: { abi: ABI, contractName: "Token" },
      isLoading: false,
    });
    renderWithProviders(<TransactionBuilder />);
    fireEvent.change(screen.getByPlaceholderText("0x..."), {
      target: { value: CONTRACT },
    });
    fireEvent.click(await screen.findByText("transfer"));

    // Put a non-numeric value into the uint256 `amount` field → encode throws.
    const inputs = screen.getAllByRole("textbox");
    const amount = inputs.find(
      (el) => (el as HTMLInputElement).placeholder === "uint256",
    ) as HTMLInputElement | undefined;
    if (amount) fireEvent.change(amount, { target: { value: "not-a-number" } });

    fireEvent.click(screen.getByRole("button", { name: /Fork Simulate/i }));
    await waitFor(() => expect(screen.getByText("Error")).toBeInTheDocument());
  });
});
