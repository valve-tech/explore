import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "./_test-utils";
import type {
  AddressInfo,
  AddressTransaction,
  AddressToken,
} from "../api/explorer";

/**
 * AddressView is a useEffect-driven fetch shell wiring AddressHeader + a
 * Transactions/Tokens sub-tab bar. Mock api/explorer and assert the
 * loading / error / loaded surfaces and the tab switch. Real WPLS holder data
 * (chain 369):
 *   https://scan.pulsechain.com/address/0xA1077a294dDE1B09bB078844df40758a5D0f9a27
 */

vi.mock("../api/explorer", () => ({
  fetchAddressInfo: vi.fn(),
  fetchAddressTransactions: vi.fn(),
  fetchAddressTokens: vi.fn(),
}));

import AddressView from "../components/explorer/AddressView";
import {
  fetchAddressInfo,
  fetchAddressTransactions,
  fetchAddressTokens,
} from "../api/explorer";

const mockInfo = fetchAddressInfo as unknown as ReturnType<typeof vi.fn>;
const mockTxs = fetchAddressTransactions as unknown as ReturnType<typeof vi.fn>;
const mockTokens = fetchAddressTokens as unknown as ReturnType<typeof vi.fn>;

const ADDR = "0x165c3410fc91ef562c50559f7d2289febed552d9";
const WPLS = "0xA1077a294dDE1B09bB078844df40758a5D0f9a27";

const eoaInfo: AddressInfo = {
  address: ADDR,
  balance: "1000000000000000000",
  balancePLS: "1.0",
  isContract: false,
};

const tx: AddressTransaction = {
  hash: "0xd515ef07d4308c389b05fe13c55ac1ebe3270bd8bbf4470b0a134a1766fe3c81",
  blockNumber: "26804224",
  timeStamp: "1781000000",
  from: ADDR,
  to: WPLS,
  value: "5456507558918974858760",
  valuePLS: "0",
  gas: "100000",
  gasUsed: "51000",
  gasPrice: "2000000000000",
  isError: "0",
  functionName: "transfer(address,uint256)",
  methodId: "0xa9059cbb",
  input: "0xa9059cbb",
  type: "eip1559",
  maxFeePerGas: "3000000000000",
  maxPriorityFeePerGas: "1000000000000",
};

const token: AddressToken = {
  balance: "5456507558918974858760",
  formattedBalance: "5,456.51",
  contractAddress: WPLS,
  name: "Wrapped Pulse",
  symbol: "WPLS",
  decimals: "18",
  type: "ERC-20",
};

describe("<AddressView />", () => {
  beforeEach(() => {
    mockInfo.mockReset();
    mockTxs.mockReset();
    mockTokens.mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  it("shows the loading spinner copy before the fetches resolve", () => {
    mockInfo.mockReturnValue(new Promise(() => {}));
    mockTxs.mockReturnValue(new Promise(() => {}));
    mockTokens.mockReturnValue(new Promise(() => {}));
    renderWithProviders(<AddressView address={ADDR} onNavigate={vi.fn()} />);
    expect(screen.getByText("Loading address...")).toBeInTheDocument();
  });

  it("renders an error when a fetch rejects", async () => {
    mockInfo.mockRejectedValue(new Error("boom"));
    mockTxs.mockResolvedValue({ transactions: [] });
    mockTokens.mockResolvedValue([]);
    renderWithProviders(<AddressView address={ADDR} onNavigate={vi.fn()} />);
    expect(await screen.findByText("boom")).toBeInTheDocument();
  });

  it("renders the header + transactions tab, and switches to tokens", async () => {
    mockInfo.mockResolvedValue(eoaInfo);
    mockTxs.mockResolvedValue({ transactions: [tx] });
    mockTokens.mockResolvedValue([token]);

    renderWithProviders(<AddressView address={ADDR} onNavigate={vi.fn()} />);

    // Header shows the address; transactions tab is default.
    expect(await screen.findByText(ADDR)).toBeInTheDocument();
    expect(screen.getByText("0xd515...3c81")).toBeInTheDocument(); // tx hash row

    // Switch to the Token Balances tab.
    fireEvent.click(screen.getByRole("button", { name: /Token Balances/ }));
    expect(await screen.findByText("Wrapped Pulse")).toBeInTheDocument();
    expect(screen.getByText("5,456.51")).toBeInTheDocument();
  });

  it("loads the next page of transactions via pagination", async () => {
    // Page 1 returns a full page (>=25) so Next is enabled.
    const page1 = Array.from({ length: 25 }, (_, i) => ({
      ...tx,
      hash: "0x" + String(i).padStart(64, "0"),
    }));
    mockInfo.mockResolvedValue(eoaInfo);
    mockTokens.mockResolvedValue([]);
    mockTxs.mockResolvedValueOnce({ transactions: page1 });
    // Subsequent loadPage call.
    mockTxs.mockResolvedValueOnce({ transactions: [tx] });

    renderWithProviders(<AddressView address={ADDR} onNavigate={vi.fn()} />);
    await screen.findByText("Page 1");

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Page 2")).toBeInTheDocument();
    expect(mockTxs).toHaveBeenCalledWith(ADDR, 2, 25, expect.any(Number));
  });

  it("shows the contract badge + View Contract link for a contract address", async () => {
    mockInfo.mockResolvedValue({ ...eoaInfo, isContract: true });
    mockTxs.mockResolvedValue({ transactions: [] });
    mockTokens.mockResolvedValue([]);
    const onNavigate = vi.fn();

    renderWithProviders(<AddressView address={WPLS} onNavigate={onNavigate} />);
    const link = await screen.findByText("View Contract Details");
    fireEvent.click(link);
    expect(onNavigate).toHaveBeenCalledWith({ type: "contract", value: WPLS });
  });
});
