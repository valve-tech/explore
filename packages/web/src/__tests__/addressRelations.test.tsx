/**
 * Fixture: chain 1 tx 0x7fb3925046709b47703375493d7b64c3401c00199fa59a533e1e130c4dcc63d8
 * https://explore.valve.city/#/eip155/1/tx/0x7fb3925046709b47703375493d7b64c3401c00199fa59a533e1e130c4dcc63d8
 * An Omnibridge safeExecuteSignaturesWithAutoGasLimit, read from production.
 * The validator 0x5ECfE77502317F3677f23C3b8Ab17929ACE3D74E appears only in
 * the trace: call 4 (ecrecover) returns it, calls 5 and 6 pass it to
 * isValidator(address).
 */
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import fixture from "./fixtures/bridgeValidatorTx.json";
import type { TransactionDetails, AddressTransaction } from "../api/explorer";
import { findAddressOccurrences } from "../components/explorer/TxDetail/addressOccurrences";
import { countRelations, filterByRelations } from "../components/explorer/AddressView/relationRows";
import { TransactionsTab } from "../components/explorer/AddressView/TransactionsTab";
import type { AddressRelation } from "../lib/addressRelations";

const VALIDATOR = "0x5ECfE77502317F3677f23C3b8Ab17929ACE3D74E";
const tx = fixture as unknown as TransactionDetails;

describe("findAddressOccurrences", () => {
  it("names the exact calls for a validator seen only in the trace", () => {
    const found = findAddressOccurrences(tx, tx.decodedLogs, VALIDATOR);
    expect(found.map((o) => o.text)).toEqual([
      "Call 4 (CALL, depth 2): ecrecover returns it, so it signed data this transaction checks.",
      "Call 5 (CALL, depth 2): an argument of isValidator(address) on 0x2fa8…c95d.",
      "Call 6 (DELEGATECALL, depth 3): an argument of isValidator(address) on 0x95b3…90ab.",
    ]);
    expect(found.every((o) => o.kind === "trace")).toBe(true);
  });

  it("names the sender's envelope, token and log roles, with the decoded argument", () => {
    const found = findAddressOccurrences(tx, tx.decodedLogs, tx.from);
    const texts = found.map((o) => o.text);
    expect(texts[0]).toBe("Sent this transaction.");
    expect(texts).toContain("The transaction's call data names it.");
    expect(texts).toContain("Log #230 Transfer: it is the `dst` argument.");
    expect(texts).toContain("Log #231: topic 2 names it.");
  });

  it("finds nothing for an address the transaction never touches", () => {
    expect(findAddressOccurrences(tx, tx.decodedLogs, "0x" + "9".repeat(40))).toEqual([]);
  });
});

function row(hash: string, relations?: AddressRelation[]): AddressTransaction {
  return {
    hash,
    relations,
    blockNumber: "1",
    timeStamp: "1700000000",
    from: "0x" + "a".repeat(40),
    to: "0x" + "b".repeat(40),
    value: "0",
    valuePLS: "0",
    gas: "21000",
    gasUsed: "21000",
    gasPrice: "1",
    isError: "0",
    functionName: "",
    methodId: "",
    input: "0x",
    type: "eip1559",
    maxFeePerGas: null,
    maxPriorityFeePerGas: null,
  } as AddressTransaction;
}

describe("relation rows", () => {
  const rows = [row("0x1", ["sender", "token"]), row("0x2", ["trace"]), row("0x3"), row("0x4", [])];

  it("counts each kind once per row", () => {
    const c = countRelations(rows);
    expect(c.sender).toBe(1);
    expect(c.token).toBe(1);
    expect(c.trace).toBe(1);
    expect(c.event).toBe(0);
  });

  it("keeps a row while any of its kinds is on, and always keeps unknown rows", () => {
    expect(filterByRelations(rows, new Set(["trace"])).map((r) => r.hash)).toEqual(["0x1", "0x3", "0x4"]);
    expect(filterByRelations(rows, new Set(["sender"])).map((r) => r.hash)).toEqual([
      "0x1",
      "0x2",
      "0x3",
      "0x4",
    ]);
    expect(filterByRelations(rows, new Set(["sender", "token"])).map((r) => r.hash)).toEqual([
      "0x2",
      "0x3",
      "0x4",
    ]);
  });
});

describe("TransactionsTab relation filter", () => {
  const owner = "0x" + "a".repeat(40);
  const rows = [row("0x" + "1".repeat(64), ["sender"]), row("0x" + "2".repeat(64), ["trace"])];
  const renderTab = () =>
    render(
      <MemoryRouter>
        <TransactionsTab
          ownerAddress={owner}
          txs={rows}
          page={1}
          total={2}
          pageSize={25}
          onLoadPage={() => {}}
          onPageSize={() => {}}
          onNavigate={() => {}}
        />
      </MemoryRouter>,
    );

  it("lights the row's own kinds and dims the rest", () => {
    renderTab();
    const strips = screen.getAllByTestId("relation-icons");
    const lit = (el: HTMLElement) =>
      [...el.querySelectorAll("[data-lit='true']")].map((n) => n.getAttribute("data-kind"));
    expect(strips.map(lit)).toEqual([["sender"], ["trace"]]);
    expect(strips[1]!.getAttribute("href")).toContain(`?for=${owner}`);
  });

  it("prints IN or OUT only when this address is the recipient or the sender", () => {
    render(
      <MemoryRouter>
        <TransactionsTab
          ownerAddress={"0x" + "c".repeat(40)}
          txs={[
            row("0x" + "3".repeat(64), ["trace"]),
            { ...row("0x" + "4".repeat(64), ["sender"]), from: "0x" + "c".repeat(40) },
          ]}
          page={1}
          total={2}
          pageSize={25}
          onLoadPage={() => {}}
          onPageSize={() => {}}
          onNavigate={() => {}}
        />
      </MemoryRouter>,
    );
    expect(screen.queryAllByText("OUT")).toHaveLength(1);
    expect(screen.queryAllByText("IN")).toHaveLength(0);
  });

  it("disables a kind no row carries, and hides rows when a kind is switched off", () => {
    renderTab();
    const bar = screen.getByRole("group", { name: /how this address takes part/i });
    expect(within(bar).getByRole("button", { name: /event log/i })).toBeDisabled();
    fireEvent.click(within(bar).getByRole("button", { name: /trace only/i }));
    expect(screen.getAllByTestId("relation-icons")).toHaveLength(1);
    expect(screen.getByText("Showing 1 of 2 on this page")).toBeInTheDocument();
  });
});
