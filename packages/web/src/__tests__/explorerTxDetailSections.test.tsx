import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "./_test-utils";
import type { TransactionDetails } from "../api/explorer";
import { EventsSection } from "../components/explorer/TxDetail/EventsSection";
import { DecodedInputSection } from "../components/explorer/TxDetail/DecodedInputSection";
import { InternalTxSection } from "../components/explorer/TxDetail/InternalTxSection";
import { TokenTransfersSection } from "../components/explorer/TxDetail/TokenTransfersSection";
import {
  formatTimestamp,
  formatGwei,
  renderParamValue,
} from "../components/explorer/TxDetail/format";

/**
 * TxDetail section components, driven by the real WPLS Transfer at block
 * 26804224 (value 5456507558918974858760, logIndex 271), chain 369:
 *   https://scan.pulsechain.com/tx/0xd515ef07d4308c389b05fe13c55ac1ebe3270bd8bbf4470b0a134a1766fe3c81
 */

const WPLS = "0xA1077a294dDE1B09bB078844df40758a5D0f9a27";
const FROM = "0x155172653e94a7e5f0e04126803dcb6896796fbb";
const TO = "0x165c3410fc91ef562c50559f7d2289febed552d9";

describe("TxDetail/format", () => {
  it("formatTimestamp renders 'Unknown' for null and a relative span otherwise", () => {
    expect(formatTimestamp(null)).toBe("Unknown");
    expect(formatTimestamp(0)).toBe("Unknown"); // falsy guard
    const recent = Math.floor(Date.now() / 1000) - 10;
    expect(formatTimestamp(recent)).toMatch(/UTC \(\d+s ago\)/);
    const minutes = Math.floor(Date.now() / 1000) - 120;
    expect(formatTimestamp(minutes)).toMatch(/m ago/);
    const hours = Math.floor(Date.now() / 1000) - 7200;
    expect(formatTimestamp(hours)).toMatch(/h ago/);
    const days = Math.floor(Date.now() / 1000) - 200000;
    expect(formatTimestamp(days)).toMatch(/d ago/);
  });

  it("formatGwei converts exact wei→gwei and falls back on garbage", () => {
    expect(formatGwei("1000000000")).toBe("1 Gwei");
    expect(formatGwei("not-a-number")).toBe("not-a-number Gwei");
  });

  it("renderParamValue stringifies primitives, objects, and null", () => {
    expect(renderParamValue(null)).toBe("null");
    expect(renderParamValue(undefined)).toBe("null");
    expect(renderParamValue(123n as unknown)).toBe("123");
    expect(renderParamValue({ a: 1 })).toBe('{"a":1}');
    expect(renderParamValue("hi")).toBe("hi");
  });
});

describe("<EventsSection />", () => {
  it("renders a decoded event with its args", () => {
    const decodedLogs: TransactionDetails["decodedLogs"] = [
      {
        eventName: "Transfer",
        address: WPLS,
        logIndex: 271,
        args: [
          { name: "from", type: "address", value: FROM },
          { name: "to", type: "address", value: TO },
          { name: "value", type: "uint256", value: "5456507558918974858760" },
        ],
      },
    ];
    const rawLogs: TransactionDetails["rawLogs"] = [
      { address: WPLS, topics: ["0xddf2"], data: "0x", logIndex: 271 },
    ];
    renderWithProviders(
      <EventsSection
        decodedLogs={decodedLogs}
        rawLogs={rawLogs}
        onNavigate={vi.fn()}
      />,
    );
    expect(screen.getByText("Transfer")).toBeInTheDocument();
    expect(screen.getByText("#271")).toBeInTheDocument();
    expect(screen.getByText("5456507558918974858760")).toBeInTheDocument();
  });

  it("renders raw topics + data when a log can't be decoded, with an unnamed arg fallback", () => {
    const rawLogs: TransactionDetails["rawLogs"] = [
      {
        address: WPLS,
        topics: ["0xtopic0", "0xtopic1"],
        data: "0xdeadbeef",
        logIndex: 5,
      },
    ];
    renderWithProviders(
      <EventsSection decodedLogs={[]} rawLogs={rawLogs} onNavigate={vi.fn()} />,
    );
    expect(screen.getByText("Topic 0:")).toBeInTheDocument();
    expect(screen.getByText("0xdeadbeef")).toBeInTheDocument();
  });
});

describe("<DecodedInputSection />", () => {
  it("renders the function signature and an arg table (named + fallback)", () => {
    renderWithProviders(
      <DecodedInputSection
        decoded={{
          functionName: "transfer",
          args: [
            { name: "to", type: "address", value: TO },
            { name: "", type: "uint256", value: "5456507558918974858760" },
          ],
        }}
      />,
    );
    expect(screen.getByText(/transfer\(/)).toBeInTheDocument();
    expect(screen.getByText("to")).toBeInTheDocument();
    expect(screen.getByText("param1")).toBeInTheDocument(); // unnamed arg fallback

    // Address-typed value: rendered via MiddleTruncate, so the FULL address
    // stays searchable (as the `title` attribute) rather than JS-sliced.
    expect(screen.getByTitle(TO)).toBeInTheDocument();

    // uint256-typed value: rendered exact and unformatted — no thousands
    // separators, no ellipsis, no truncation.
    expect(screen.getByText("5456507558918974858760")).toBeInTheDocument();
  });

  it("omits the arg table for a no-arg call", () => {
    renderWithProviders(
      <DecodedInputSection decoded={{ functionName: "pause", args: [] }} />,
    );
    expect(screen.getByText(/pause\(/)).toBeInTheDocument();
    expect(screen.queryByText("Name")).not.toBeInTheDocument();
  });
});

describe("<InternalTxSection />", () => {
  it("renders internal-call rows (section is collapsed by default)", () => {
    const internal: TransactionDetails["internalTransactions"] = [
      {
        from: FROM,
        to: TO,
        value: "0",
        valuePLS: "1.5",
        type: "CALL",
        gas: "21000",
        gasUsed: "12345",
        input: "0x",
        errCode: "",
        isError: "0",
      },
    ];
    renderWithProviders(
      <InternalTxSection
        internalTransactions={internal}
        onNavigate={vi.fn()}
      />,
    );
    // defaultOpen=false → expand it.
    fireEvent.click(screen.getByText("Internal Transactions"));
    expect(screen.getByText("CALL")).toBeInTheDocument();
    expect(screen.getByText("12,345")).toBeInTheDocument();
  });

  it("says 'no internal transactions' when the trace came back empty", () => {
    renderWithProviders(
      <InternalTxSection internalTransactions={[]} onNavigate={vi.fn()} />,
    );
    fireEvent.click(screen.getByText("Internal Transactions"));
    expect(screen.getByText("No internal transactions")).toBeInTheDocument();
  });

  /**
   * The distinguishing case. The row list is empty either way; only
   * `available` says whether that empty is a fact about the chain. Claiming
   * "no internal transactions" for a chain with no `debug_*` namespace is the
   * bug this pins.
   */
  it("refuses to claim 'none' when no trace source answered", () => {
    renderWithProviders(
      <InternalTxSection
        internalTransactions={[]}
        available={false}
        onNavigate={vi.fn()}
      />,
    );
    expect(
      screen.getByText(/Could not load internal transactions/),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("No internal transactions"),
    ).not.toBeInTheDocument();
  });
});

describe("<TokenTransfersSection />", () => {
  it("renders a token transfer row with a scaled amount", () => {
    const transfers: TransactionDetails["tokenTransfers"] = [
      {
        from: FROM,
        to: TO,
        value: "5456507558918974858760",
        tokenName: "Wrapped Pulse",
        tokenSymbol: "WPLS",
        tokenDecimal: "18",
        contractAddress: WPLS,
        hash: "0xd515",
      },
    ];
    renderWithProviders(
      <TokenTransfersSection tokenTransfers={transfers} onNavigate={vi.fn()} />,
    );
    fireEvent.click(screen.getByText("Token Transfers"));
    expect(screen.getByText("Wrapped Pulse")).toBeInTheDocument();
    expect(screen.getByText("WPLS")).toBeInTheDocument();
  });

  it("falls back to 'Unknown' for a nameless token + garbage decimals", () => {
    const transfers: TransactionDetails["tokenTransfers"] = [
      {
        from: FROM,
        to: TO,
        value: "1000",
        tokenName: "",
        tokenSymbol: "???",
        tokenDecimal: "n/a",
        contractAddress: WPLS,
        hash: "0xabc",
      },
    ];
    renderWithProviders(
      <TokenTransfersSection tokenTransfers={transfers} onNavigate={vi.fn()} />,
    );
    fireEvent.click(screen.getByText("Token Transfers"));
    expect(screen.getByText("Unknown")).toBeInTheDocument();
  });

  it("says 'no token transfers' when the receipt held none", () => {
    renderWithProviders(
      <TokenTransfersSection tokenTransfers={[]} onNavigate={vi.fn()} />,
    );
    fireEvent.click(screen.getByText("Token Transfers"));
    expect(screen.getByText("No token transfers")).toBeInTheDocument();
  });

  /** Same distinguishing case as the internal-call section above. */
  it("refuses to claim 'none' when the node did not answer", () => {
    renderWithProviders(
      <TokenTransfersSection
        tokenTransfers={[]}
        available={false}
        onNavigate={vi.fn()}
      />,
    );
    expect(
      screen.getByText(/Could not load token transfers/),
    ).toBeInTheDocument();
    expect(screen.queryByText("No token transfers")).not.toBeInTheDocument();
  });
});
