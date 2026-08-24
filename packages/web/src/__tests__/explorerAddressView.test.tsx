import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { useLocation } from "react-router-dom";
import { renderWithProviders } from "./_test-utils";
import type {
  AddressInfo,
  AddressTransaction,
  AddressToken,
  ContractInfo,
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
  fetchContractInfo: vi.fn(),
}));
// Holdings gateway is the preferred token source; default it to not-indexed so
// the view falls back to fetchAddressTokens (the RPC/chifra list) unless a test
// opts into the indexed path.
vi.mock("../api/portfolio", () => ({ fetchHoldings: vi.fn() }));

import AddressView from "../components/explorer/AddressView";
import {
  fetchAddressInfo,
  fetchAddressTransactions,
  fetchAddressTokens,
  fetchContractInfo,
} from "../api/explorer";
import { fetchHoldings } from "../api/portfolio";

const mockInfo = fetchAddressInfo as unknown as ReturnType<typeof vi.fn>;
const mockTxs = fetchAddressTransactions as unknown as ReturnType<typeof vi.fn>;
const mockTokens = fetchAddressTokens as unknown as ReturnType<typeof vi.fn>;
const mockHoldings = fetchHoldings as unknown as ReturnType<typeof vi.fn>;
const mockContractInfo = fetchContractInfo as unknown as ReturnType<typeof vi.fn>;

/** Reads the live router location so a test can assert the URL after an action. */
function LocationProbe() {
  const location = useLocation();
  return (
    <div data-testid="location">
      {location.pathname}
      {location.search}
    </div>
  );
}

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
    mockHoldings.mockReset();
    mockContractInfo.mockReset();
    // Default: gateway not indexed for this chain → fall back to fetchAddressTokens.
    mockHoldings.mockResolvedValue({
      chainId: 369,
      address: ADDR,
      native: { symbol: "PLS", balance: "0" },
      holdings: [],
      indexed: false,
    });
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
    expect(screen.getByTitle(tx.hash)).toBeInTheDocument(); // tx hash row, full value searchable

    // Switch to the Token Balances tab.
    fireEvent.click(screen.getByRole("button", { name: /Token Balances/ }));
    expect(await screen.findByText("Wrapped Pulse")).toBeInTheDocument();
    expect(screen.getByText("5,456.51")).toBeInTheDocument();
  });

  it("prefers the indexed holdings gateway over the RPC token list", async () => {
    mockInfo.mockResolvedValue(eoaInfo);
    mockTxs.mockResolvedValue({ transactions: [] });
    // RPC/chifra fallback would say "Old Name" — must be overridden by the gateway.
    mockTokens.mockResolvedValue([{ ...token, name: "Old Name", formattedBalance: "0" }]);
    mockHoldings.mockResolvedValue({
      chainId: 369,
      address: ADDR,
      native: { symbol: "PLS", balance: "0" },
      indexed: true,
      holdings: [
        {
          tokenAddress: WPLS,
          symbol: "WPLS",
          name: "Wrapped Pulse",
          decimals: 18,
          balance: "5456507558918974858760", // 5,456.5075… WPLS
        },
      ],
    });

    renderWithProviders(<AddressView address={ADDR} onNavigate={vi.fn()} />);
    await screen.findByText(ADDR);
    fireEvent.click(screen.getByRole("button", { name: /Token Balances/ }));

    // Storage-diff name + formatted-from-raw balance, plus the source caption.
    expect(await screen.findByText("Wrapped Pulse")).toBeInTheDocument();
    expect(screen.queryByText("Old Name")).not.toBeInTheDocument();
    expect(screen.getByText("5,456.5076")).toBeInTheDocument();
    expect(screen.getByText(/indexed balance-changes archive/i)).toBeInTheDocument();
  });

  it("loads the next page of transactions via pagination", async () => {
    // Page 1 returns a full page (>=25) so Next is enabled.
    const page1 = Array.from({ length: 25 }, (_, i) => ({
      ...tx,
      hash: "0x" + String(i).padStart(64, "0"),
    }));
    mockInfo.mockResolvedValue(eoaInfo);
    mockTokens.mockResolvedValue([]);
    // total 42 > one page → Next is enabled.
    mockTxs.mockResolvedValueOnce({ transactions: page1, total: 42 });
    // Subsequent loadPage call (page 2 of 42).
    mockTxs.mockResolvedValueOnce({ transactions: [tx], total: 42 });

    renderWithProviders(<AddressView address={ADDR} onNavigate={vi.fn()} />);
    await screen.findByText("Page 1");

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Page 2")).toBeInTheDocument();
    expect(mockTxs).toHaveBeenCalledWith(ADDR, 2, 25, expect.any(Number));
  });

  it("shows the TRUE total in the tab badge, not the current page size", async () => {
    // The reported bug: the badge showed 25 (the page length) while the address
    // actually has 42 transactions across two pages.
    const page1 = Array.from({ length: 25 }, (_, i) => ({
      ...tx,
      hash: "0x" + String(i).padStart(64, "0"),
    }));
    mockInfo.mockResolvedValue(eoaInfo);
    mockTokens.mockResolvedValue([]);
    mockTxs.mockResolvedValue({ transactions: page1, total: 42 });

    renderWithProviders(<AddressView address={ADDR} onNavigate={vi.fn()} />);
    const tab = await screen.findByRole("button", { name: /Transactions/ });
    // Badge reflects the real total, and NOT the page size.
    expect(tab).toHaveTextContent("42");
    expect(tab).not.toHaveTextContent("25");
  });

  it("disables Next on an exactly-full final page (no phantom empty page)", async () => {
    // total 25 with a full 25-row page: the old `txs.length >= 25` heuristic
    // wrongly enabled Next into an empty page 2. Driven by total, Next is off.
    const page1 = Array.from({ length: 25 }, (_, i) => ({
      ...tx,
      hash: "0x" + String(i).padStart(64, "0"),
    }));
    mockInfo.mockResolvedValue(eoaInfo);
    mockTokens.mockResolvedValue([]);
    mockTxs.mockResolvedValue({ transactions: page1, total: 25 });

    renderWithProviders(<AddressView address={ADDR} onNavigate={vi.fn()} />);
    await screen.findByText("Page 1");
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
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

describe("<AddressView /> — sub-tab lives in the URL", () => {
  const contractInfo: AddressInfo = { ...eoaInfo, address: WPLS, isContract: true };

  beforeEach(() => {
    mockTxs.mockResolvedValue({ transactions: [tx], total: 1 });
    mockTokens.mockResolvedValue([token]);
  });

  it("carries the selected tab in ?tab= and reads it back on click", async () => {
    mockInfo.mockResolvedValue(eoaInfo);

    renderWithProviders(
      <>
        <LocationProbe />
        <AddressView address={ADDR} onNavigate={vi.fn()} />
      </>,
      { initialEntries: [`/address/${ADDR}`] },
    );
    await screen.findByText(ADDR);
    expect(screen.getByTestId("location")).toHaveTextContent(`/address/${ADDR}`);

    fireEvent.click(screen.getByRole("button", { name: /Token Balances/ }));
    await screen.findByText("Wrapped Pulse");
    expect(screen.getByTestId("location").textContent).toContain("tab=tokens");

    fireEvent.click(screen.getByRole("button", { name: /^Transactions/ }));
    expect(screen.getByTestId("location").textContent).toContain("tab=transactions");
  });

  it("falls back to Transactions for an unknown ?tab= value", async () => {
    mockInfo.mockResolvedValue(eoaInfo);
    renderWithProviders(<AddressView address={ADDR} onNavigate={vi.fn()} />, {
      initialEntries: [`/address/${ADDR}?tab=not-a-real-tab`],
    });
    expect(await screen.findByTitle(tx.hash)).toBeInTheDocument();
  });

  it("falls back to Transactions when a contract-only tab is requested for a plain EOA", async () => {
    mockInfo.mockResolvedValue(eoaInfo);
    renderWithProviders(<AddressView address={ADDR} onNavigate={vi.fn()} />, {
      initialEntries: [`/address/${ADDR}?tab=storage`],
    });
    expect(await screen.findByTitle(tx.hash)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Storage" })).not.toBeInTheDocument();
  });

  it("keeps the chain prefix in the path when the tab changes", async () => {
    mockInfo.mockResolvedValue(eoaInfo);
    renderWithProviders(
      <>
        <LocationProbe />
        <AddressView address={ADDR} onNavigate={vi.fn()} />
      </>,
      { initialEntries: [`/eip155/369/address/${ADDR}?tab=transactions`] },
    );
    await screen.findByText(ADDR);

    fireEvent.click(screen.getByRole("button", { name: /Token Balances/ }));
    await screen.findByText("Wrapped Pulse");
    expect(screen.getByTestId("location")).toHaveTextContent(`/eip155/369/address/${ADDR}`);
    expect(screen.getByTestId("location").textContent).toContain("tab=tokens");
  });

  it("shows the contract-only tabs for a contract and composes the existing SourceTab", async () => {
    mockInfo.mockResolvedValue(contractInfo);
    mockContractInfo.mockResolvedValue({
      sourceCode: "contract Foo {}",
    } as unknown as ContractInfo);

    renderWithProviders(<AddressView address={WPLS} onNavigate={vi.fn()} />, {
      initialEntries: [`/address/${WPLS}`],
    });
    await screen.findByText(WPLS);

    expect(screen.getByRole("button", { name: "Storage" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Diff" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Re-verify" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Source" }));
    expect(await screen.findByText("contract Foo {}")).toBeInTheDocument();
  });
});
