import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "./_test-utils";
import {
  subscriptSmallString,
  formatPLS,
} from "../components/explorer/format";
import { TxGasInfo } from "../components/explorer/TxGasInfo";
import { WriteFunction } from "../components/explorer/ContractView/WriteFunction";
import { SubTabBar } from "../components/explorer/ContractView/SubTabBar";
import { AbiTab, SourceTab } from "../components/explorer/ContractView/SourceCodeTab";
import type { AbiItem } from "../components/explorer/ContractView/types";
import { SubTabBar as AddressSubTabBar } from "../components/explorer/AddressView/SubTabBar";
import { TransactionsTab } from "../components/explorer/AddressView/TransactionsTab";
import type { AddressTransaction } from "../api/explorer";

/**
 * Edge-branch coverage for explorer leaf components + the value formatter's
 * negative / all-zero-fraction paths. No network — pure presentational props.
 */

describe("explorer/format — subscript edges", () => {
  it("renders negative dust with a subscript and minus sign", () => {
    // negative branch through toSubscript + leadingZeros.
    expect(subscriptSmallString("-0.00000000123")).toBe("-0.0₈123");
    expect(formatPLS("-0.00000000123", "WPLS")).toBe("-0.0₈123 WPLS");
  });

  it("collapses an all-zero significant fraction to a single zero", () => {
    // 6 leading zeros then only zeros → digits fallback "|| 0".
    expect(subscriptSmallString("0.000000")).toBe("0.0₆0");
  });
});

describe("<TxGasInfo /> — tip-only and cap-only branches", () => {
  it("shows only the tip when cap is absent", () => {
    renderWithProviders(
      <TxGasInfo
        type="eip1559"
        gasPrice={null}
        maxFeePerGas={null}
        maxPriorityFeePerGas="1000000000"
      />,
    );
    expect(screen.getByText(/tip/)).toBeInTheDocument();
    expect(screen.queryByText(/cap/)).not.toBeInTheDocument();
  });

  it("shows only the cap when tip is absent", () => {
    renderWithProviders(
      <TxGasInfo
        type="eip1559"
        gasPrice={null}
        maxFeePerGas="2000000000"
        maxPriorityFeePerGas={null}
      />,
    );
    expect(screen.getByText(/cap/)).toBeInTheDocument();
    expect(screen.queryByText(/tip/)).not.toBeInTheDocument();
  });

  it("labels blob and 7702 tx-types and falls through for unknown", () => {
    const { rerender } = renderWithProviders(
      <TxGasInfo type="eip4844" gasPrice={null} maxFeePerGas={null} maxPriorityFeePerGas={null} />,
    );
    expect(screen.getByText("Blob (4844)")).toBeInTheDocument();
    rerender(
      <TxGasInfo type="eip7702" gasPrice={null} maxFeePerGas={null} maxPriorityFeePerGas={null} />,
    );
    expect(screen.getByText("EIP-7702")).toBeInTheDocument();
    rerender(
      <TxGasInfo type="weird" gasPrice={null} maxFeePerGas={null} maxPriorityFeePerGas={null} />,
    );
    expect(screen.getByText("weird")).toBeInTheDocument();
  });
});

describe("<WriteFunction />", () => {
  const payableFn: AbiItem = {
    type: "function",
    name: "deposit",
    stateMutability: "payable",
    inputs: [{ name: "amount", type: "uint256" }],
  };

  it("expands to reveal inputs, the payable badge and the wallet notice", () => {
    renderWithProviders(<WriteFunction fn={payableFn} />);
    // Collapsed: name visible, notice not yet.
    expect(screen.getByText("deposit")).toBeInTheDocument();
    expect(screen.getByText("payable")).toBeInTheDocument();
    expect(screen.queryByText(/require a connected wallet/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("deposit"));
    expect(screen.getByText(/require a connected wallet/)).toBeInTheDocument();
    expect(screen.getByText("amount")).toBeInTheDocument();
  });

  it("expands a no-input, non-payable function without an inputs block", () => {
    renderWithProviders(
      <WriteFunction fn={{ type: "function", name: "pause", stateMutability: "nonpayable" }} />,
    );
    fireEvent.click(screen.getByText("pause"));
    expect(screen.getByText(/require a connected wallet/)).toBeInTheDocument();
    expect(screen.queryByText("payable")).not.toBeInTheDocument();
  });
});

describe("<ContractView/SubTabBar />", () => {
  it("omits the chart tab for non-token contracts", () => {
    renderWithProviders(
      <SubTabBar
        active="read"
        onSelect={vi.fn()}
        readCount={2}
        writeCount={1}
        showChart={false}
      />,
    );
    expect(screen.getByRole("button", { name: "Read (2)" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Chart" })).not.toBeInTheDocument();
  });

  it("fires onSelect when a tab is clicked", () => {
    const onSelect = vi.fn();
    renderWithProviders(
      <SubTabBar active="read" onSelect={onSelect} readCount={0} writeCount={0} showChart />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Chart" }));
    expect(onSelect).toHaveBeenCalledWith("chart");
  });
});

describe("<AddressView/SubTabBar />", () => {
  it("renders count badges and fires onSelect for each tab", () => {
    const onSelect = vi.fn();
    renderWithProviders(
      <AddressSubTabBar
        active="transactions"
        onSelect={onSelect}
        txCount={25}
        tokenCount={3}
      />,
    );
    // Count badges (count > 0 branch).
    expect(screen.getByText("25")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Token Balances/ }));
    expect(onSelect).toHaveBeenCalledWith("tokens");
    fireEvent.click(screen.getByRole("button", { name: /Transactions/ }));
    expect(onSelect).toHaveBeenCalledWith("transactions");
  });

  it("omits the badge when a count is zero", () => {
    renderWithProviders(
      <AddressSubTabBar active="transactions" onSelect={vi.fn()} txCount={0} tokenCount={0} />,
    );
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });
});

describe("<TransactionsTab /> — pagination + empty", () => {
  const tx: AddressTransaction = {
    hash: "0x" + "ab".repeat(32),
    blockNumber: "26804224",
    timeStamp: "1781000000",
    from: "0x" + "11".repeat(20),
    to: "0x" + "22".repeat(20),
    value: "0",
    valuePLS: "0",
    gas: "21000",
    gasUsed: "21000",
    gasPrice: "1000000000",
    isError: "0",
    functionName: "transfer(address,uint256)",
    methodId: "0xa9059cbb",
    input: "0x",
    type: "legacy",
    maxFeePerGas: null,
    maxPriorityFeePerGas: null,
  };

  it("renders an empty state with no txs", () => {
    renderWithProviders(
      <TransactionsTab
        ownerAddress={tx.from}
        txs={[]}
        page={1}
        onLoadPage={vi.fn()}
        onNavigate={vi.fn()}
      />,
    );
    expect(screen.getByText("No transactions found")).toBeInTheDocument();
  });

  it("enables Previous on page 2 and pages backward", () => {
    const onLoadPage = vi.fn();
    renderWithProviders(
      <TransactionsTab
        ownerAddress={tx.from}
        txs={[tx]}
        page={2}
        onLoadPage={onLoadPage}
        onNavigate={vi.fn()}
      />,
    );
    expect(screen.getByText("Page 2")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(onLoadPage).toHaveBeenCalledWith(1);
  });
});

describe("<SourceCodeTab /> — empty states", () => {
  it("shows the not-verified message when ABI/source are missing", () => {
    renderWithProviders(<AbiTab abi={null} />);
    expect(
      screen.getByText("ABI not available (contract not verified)"),
    ).toBeInTheDocument();
  });

  it("shows the source not-available message when source is null", () => {
    renderWithProviders(<SourceTab sourceCode={null} />);
    expect(
      screen.getByText("Source code not available (contract not verified)"),
    ).toBeInTheDocument();
  });
});
