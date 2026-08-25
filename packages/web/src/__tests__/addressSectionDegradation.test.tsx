import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "./_test-utils";
import type { AddressInfo, AddressTransaction, AddressToken } from "../api/explorer";

/**
 * The address workspace degrades per section.
 *
 * The bug these tests hold shut: one `Promise.all` over four reads meant a
 * single slow or dead upstream showed a bare spinner for 15–30s — and forever
 * if it never answered — then blanked the whole page. Every section now loads
 * on its own deadline and renders its own state, and a failed section says so
 * instead of rendering as an empty list.
 */

vi.mock("../api/explorer", () => ({
  fetchAddressInfo: vi.fn(),
  fetchAddressTransactions: vi.fn(),
  fetchAddressTokens: vi.fn(),
  fetchContractInfo: vi.fn(),
}));
vi.mock("../api/portfolio", () => ({ fetchHoldings: vi.fn() }));

import AddressView from "../components/explorer/AddressView";
import {
  fetchAddressInfo,
  fetchAddressTransactions,
  fetchAddressTokens,
} from "../api/explorer";
import { fetchHoldings } from "../api/portfolio";
import { ADDRESS_SECTION_TIMEOUT_SECONDS } from "../components/explorer/AddressView/deadline";

const mockInfo = fetchAddressInfo as unknown as ReturnType<typeof vi.fn>;
const mockTxs = fetchAddressTransactions as unknown as ReturnType<typeof vi.fn>;
const mockTokens = fetchAddressTokens as unknown as ReturnType<typeof vi.fn>;
const mockHoldings = fetchHoldings as unknown as ReturnType<typeof vi.fn>;

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

const notIndexed = {
  chainId: 369,
  address: ADDR,
  native: { symbol: "PLS", balance: "0" },
  holdings: [],
  indexed: false,
};

/** A read that never answers — the "spinner forever" case. */
function never() {
  return new Promise(() => {});
}

describe("address workspace — per-section degradation", () => {
  beforeEach(() => {
    mockInfo.mockReset();
    mockTxs.mockReset();
    mockTokens.mockReset();
    mockHoldings.mockReset();
    mockHoldings.mockResolvedValue(notIndexed);
  });
  afterEach(() => vi.restoreAllMocks());

  it("renders a failed section's reason while its siblings render their data", async () => {
    mockInfo.mockResolvedValue(eoaInfo);
    mockTxs.mockRejectedValue(new Error("chifra exited 1"));
    mockTokens.mockResolvedValue([token]);

    renderWithProviders(<AddressView address={ADDR} onNavigate={vi.fn()} />);

    // The failed section names itself and its reason, and offers a retry.
    expect(await screen.findByText("Could not load transactions")).toBeInTheDocument();
    expect(screen.getByText("chifra exited 1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry transactions" })).toBeInTheDocument();

    // The header (a sibling section) still has its data.
    expect(screen.getByText(ADDR)).toBeInTheDocument();
    expect(screen.queryByText("Unavailable")).not.toBeInTheDocument();

    // And so does the tokens tab.
    fireEvent.click(screen.getByRole("button", { name: /Token Balances/ }));
    expect(await screen.findByText("Wrapped Pulse")).toBeInTheDocument();
  });

  it("says the token read FAILED rather than showing an empty token table", async () => {
    mockInfo.mockResolvedValue(eoaInfo);
    mockTxs.mockResolvedValue({ transactions: [tx], total: 1 });
    mockTokens.mockRejectedValue(new Error("tokens upstream 502"));
    mockHoldings.mockRejectedValue(new Error("gateway 502"));

    renderWithProviders(<AddressView address={ADDR} onNavigate={vi.fn()} />, {
      initialEntries: [`/address/${ADDR}?tab=tokens`],
    });

    expect(await screen.findByText("Could not load token balances")).toBeInTheDocument();
    expect(screen.getByText("tokens upstream 502")).toBeInTheDocument();
    // "No tokens found" would be a lie — the read failed, the address was
    // never asked.
    expect(screen.queryByText("No tokens found")).not.toBeInTheDocument();
  });

  it("names our own deadline when a read times out", async () => {
    mockInfo.mockResolvedValue(eoaInfo);
    mockTxs.mockRejectedValue(new DOMException("signal timed out", "TimeoutError"));
    mockTokens.mockResolvedValue([]);

    renderWithProviders(<AddressView address={ADDR} onNavigate={vi.fn()} />);

    expect(
      await screen.findByText(
        new RegExp(`No answer within ${ADDRESS_SECTION_TIMEOUT_SECONDS} seconds`),
      ),
    ).toBeInTheDocument();
  });

  it("retries ONLY the section the user retried", async () => {
    mockInfo.mockResolvedValue(eoaInfo);
    mockTokens.mockResolvedValue([]);
    mockTxs.mockRejectedValueOnce(new Error("chifra exited 1"));
    mockTxs.mockResolvedValue({ transactions: [tx], total: 1 });

    renderWithProviders(<AddressView address={ADDR} onNavigate={vi.fn()} />);
    await screen.findByText("Could not load transactions");
    expect(mockInfo).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Retry transactions" }));

    expect(await screen.findByTitle(tx.hash)).toBeInTheDocument();
    expect(mockTxs).toHaveBeenCalledTimes(2);
    // The healthy sections were not re-read.
    expect(mockInfo).toHaveBeenCalledTimes(1);
    expect(mockTokens).toHaveBeenCalledTimes(1);
  });

  it("says the balance is unavailable when the overview read fails", async () => {
    mockInfo.mockRejectedValue(new Error("balance: rate limited"));
    mockTxs.mockResolvedValue({ transactions: [tx], total: 1 });
    mockTokens.mockResolvedValue([]);

    renderWithProviders(<AddressView address={ADDR} onNavigate={vi.fn()} />);

    // "..." reads as "still coming" — a failed balance has to say otherwise.
    expect(await screen.findByText("Unavailable")).toBeInTheDocument();
    expect(screen.getByText("Could not load the address overview")).toBeInTheDocument();
    // The transactions sibling still painted.
    expect(screen.getByTitle(tx.hash)).toBeInTheDocument();
  });
});

describe("address workspace — progressive feedback", () => {
  beforeEach(() => {
    mockInfo.mockReset();
    mockTxs.mockReset();
    mockTokens.mockReset();
    mockHoldings.mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  it("paints the address and names every outstanding section immediately", () => {
    mockInfo.mockReturnValue(never());
    mockTxs.mockReturnValue(never());
    mockTokens.mockReturnValue(never());
    mockHoldings.mockReturnValue(never());

    renderWithProviders(<AddressView address={ADDR} onNavigate={vi.fn()} />);

    // The page paints — no full-page spinner standing in for the whole view.
    expect(screen.getByText(ADDR)).toBeInTheDocument();

    const progress = screen.getByRole("status", { name: "Address load progress" });
    expect(progress).toHaveTextContent("0/3 sections ready");
    expect(progress).toHaveTextContent(
      "still loading Overview, Transactions, Token balances",
    );

    // The open tab shows its own loading state, with the deadline stated.
    expect(screen.getByText("Loading transactions…")).toBeInTheDocument();
  });

  it("counts the landed sections up while the slow one is still out", async () => {
    mockInfo.mockResolvedValue(eoaInfo);
    mockTxs.mockResolvedValue({ transactions: [tx], total: 1 });
    // The token reads are the slow pair — the page must not wait on them.
    mockTokens.mockReturnValue(never());
    mockHoldings.mockReturnValue(never());

    renderWithProviders(<AddressView address={ADDR} onNavigate={vi.fn()} />);

    // Transactions painted while the token reads are still in flight.
    expect(await screen.findByTitle(tx.hash)).toBeInTheDocument();
    const progress = screen.getByRole("status", { name: "Address load progress" });
    expect(progress).toHaveTextContent("2/3 sections ready");
    expect(progress).toHaveTextContent("still loading Token balances");
  });

  it("puts the progress bar away once every section is ready", async () => {
    mockInfo.mockResolvedValue(eoaInfo);
    mockTxs.mockResolvedValue({ transactions: [tx], total: 1 });
    mockTokens.mockResolvedValue([token]);
    mockHoldings.mockResolvedValue(notIndexed);

    renderWithProviders(<AddressView address={ADDR} onNavigate={vi.fn()} />);
    await screen.findByTitle(tx.hash);

    // A finished page carries no chrome.
    await waitFor(() =>
      expect(
        screen.queryByRole("status", { name: "Address load progress" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("gives every read its own abort signal", () => {
    mockInfo.mockReturnValue(never());
    mockTxs.mockReturnValue(never());
    mockTokens.mockReturnValue(never());
    mockHoldings.mockReturnValue(never());

    renderWithProviders(<AddressView address={ADDR} onNavigate={vi.fn()} />);

    const signals = [
      mockInfo.mock.calls[0]![2].signal,
      mockTxs.mock.calls[0]![4].signal,
      mockTokens.mock.calls[0]![2].signal,
      mockHoldings.mock.calls[0]![2].signal,
    ];
    for (const signal of signals) {
      expect(signal).toBeInstanceOf(AbortSignal);
      expect(signal.aborted).toBe(false);
    }
    // Four distinct signals: one section's deadline must never abort another's
    // healthy read.
    expect(new Set(signals).size).toBe(4);
  });
});
