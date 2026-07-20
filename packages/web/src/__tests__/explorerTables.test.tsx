import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "./_test-utils";
import type { AddressTransaction, AddressToken } from "../api/explorer";
import { TxTable } from "../components/explorer/AddressView/TxTable";
import { TokensTab } from "../components/explorer/AddressView/TokensTab";
import { TxGasInfo } from "../components/explorer/TxGasInfo";
import { truncateAddr } from "../components/explorer/format";

/**
 * Explorer address tables, driven by a real WPLS transfer + holding (chain 369):
 *   tx https://explore.valve.city/tx/0xd515ef07d4308c389b05fe13c55ac1ebe3270bd8bbf4470b0a134a1766fe3c81?chainid=369
 *   token https://explore.valve.city/address/0xA1077a294dDE1B09bB078844df40758a5D0f9a27?chainid=369
 */

const FROM = "0x155172653e94a7e5f0e04126803dcb6896796fbb";
const TO = "0x165c3410fc91ef562c50559f7d2289febed552d9";
const WPLS = "0xA1077a294dDE1B09bB078844df40758a5D0f9a27";
const HASH = "0xd515ef07d4308c389b05fe13c55ac1ebe3270bd8bbf4470b0a134a1766fe3c81";

const tx: AddressTransaction = {
  hash: HASH,
  blockNumber: "26804224",
  timeStamp: "1781000000",
  from: FROM,
  to: TO,
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

describe("explorer/format — truncateAddr", () => {
  it("truncates long hex and leaves short strings", () => {
    expect(truncateAddr(WPLS)).toBe("0xA107...9a27");
    expect(truncateAddr("0x1234")).toBe("0x1234");
    expect(truncateAddr("")).toBe("");
  });
});

describe("TxTable", () => {
  it("renders a transaction row with searchable hash/from/to, block, and gas type", () => {
    renderWithProviders(
      <TxTable txs={[tx]} ownerAddress={FROM} onNavigate={vi.fn()} />,
    );
    expect(screen.getByTitle(HASH)).toBeInTheDocument(); // hash, full value searchable
    expect(screen.getByText("26,804,224")).toBeInTheDocument(); // block, localized
    expect(screen.getByTitle(FROM)).toBeInTheDocument(); // from, full value searchable
    expect(screen.getByTitle(TO)).toBeInTheDocument(); // to, full value searchable
    expect(screen.getByText("OUT")).toBeInTheDocument(); // owner is the sender
    expect(screen.getByText("EIP-1559")).toBeInTheDocument(); // tx-type label
  });

  it("labels a contract-creation row (no `to`)", () => {
    renderWithProviders(
      <TxTable txs={[{ ...tx, to: "" }]} ownerAddress={FROM} onNavigate={vi.fn()} />,
    );
    expect(screen.getByText("Contract Creation")).toBeInTheDocument();
  });
});

describe("TokensTab", () => {
  const token: AddressToken = {
    balance: "5456507558918974858760",
    formattedBalance: "5,456.51",
    contractAddress: WPLS,
    name: "Wrapped Pulse",
    symbol: "WPLS",
    decimals: "18",
    type: "ERC-20",
  };

  it("renders a token holding row", () => {
    renderWithProviders(<TokensTab tokens={[token]} onNavigate={vi.fn()} />);
    expect(screen.getByText("Wrapped Pulse")).toBeInTheDocument();
    expect(screen.getByText("WPLS")).toBeInTheDocument();
    expect(screen.getByText("5,456.51")).toBeInTheDocument();
    expect(screen.getByText("0xA107...9a27")).toBeInTheDocument();
    expect(screen.getByText("ERC-20")).toBeInTheDocument();
  });

  it("shows an empty state when there are no tokens", () => {
    renderWithProviders(<TokensTab tokens={[]} onNavigate={vi.fn()} />);
    expect(screen.getByText("No tokens found")).toBeInTheDocument();
  });
});

describe("TxGasInfo", () => {
  it("shows tip/cap in gwei for EIP-1559", () => {
    renderWithProviders(
      <TxGasInfo
        type="eip1559"
        gasPrice={null}
        maxFeePerGas="3000000000000"
        maxPriorityFeePerGas="1000000000000"
      />,
    );
    expect(screen.getByText("EIP-1559")).toBeInTheDocument();
    expect(screen.getByText(/gwei/)).toBeInTheDocument();
    expect(screen.getByText(/tip/)).toBeInTheDocument();
    expect(screen.getByText(/cap/)).toBeInTheDocument();
  });

  it("shows a single gas price for legacy txs", () => {
    renderWithProviders(
      <TxGasInfo
        type="legacy"
        gasPrice="2000000000000"
        maxFeePerGas={null}
        maxPriorityFeePerGas={null}
      />,
    );
    expect(screen.getByText("Legacy")).toBeInTheDocument();
    expect(screen.getByText(/gwei/)).toBeInTheDocument();
  });

  it("shows just the type label when no fee fields are present", () => {
    renderWithProviders(
      <TxGasInfo type="eip2930" gasPrice={null} maxFeePerGas={null} maxPriorityFeePerGas={null} />,
    );
    expect(screen.getByText("EIP-2930")).toBeInTheDocument();
    expect(screen.queryByText(/gwei/)).not.toBeInTheDocument();
  });
});
