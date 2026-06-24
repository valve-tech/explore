import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "./_test-utils";
import * as explorerApi from "../api/explorer";
import { AddressPreview } from "../components/workspace/previews/AddressPreview";
import { TxPreview } from "../components/workspace/previews/TxPreview";
import { BlockPreview } from "../components/workspace/previews/BlockPreview";

/**
 * Workspace expand-row previews — small cards that fetch a few live facts for a
 * pinned-chain item. Tested against real PulseChain entities (links below);
 * the api layer is mocked, so these assert the render/branch logic on realistic
 * shapes rather than the network.
 *
 * Known setups (chain 369):
 *   WPLS contract  https://explore.valve.city/address/0xA1077a294dDE1B09bB078844df40758a5D0f9a27?chainid=369
 *   transfer tx    https://explore.valve.city/tx/0xd515ef07d4308c389b05fe13c55ac1ebe3270bd8bbf4470b0a134a1766fe3c81?chainid=369
 *   block 26804492 https://explore.valve.city/block/26804492?chainid=369
 */

const WPLS = "0xA1077a294dDE1B09bB078844df40758a5D0f9a27";
const EOA = "0x155172653e94a7e5f0e04126803dcb6896796fbb";

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("AddressPreview", () => {
  it("shows Contract + verified name for a verified contract (WPLS)", async () => {
    vi.spyOn(explorerApi, "fetchAddressInfo").mockResolvedValue({
      address: WPLS,
      balance: "0",
      balancePLS: "0",
      isContract: true,
    });
    vi.spyOn(explorerApi, "fetchContractInfo").mockResolvedValue({
      contractName: "WPLS",
      isVerified: true,
    } as Awaited<ReturnType<typeof explorerApi.fetchContractInfo>>);

    renderWithProviders(<AddressPreview address={WPLS} chainId={369} />);

    expect(await screen.findByText("Contract")).toBeInTheDocument();
    // Name + Verified depend on the second (contract) query, which fires only
    // after the address query reports isContract — so wait for them.
    expect(await screen.findByText("WPLS")).toBeInTheDocument();
    expect(await screen.findByText("Yes")).toBeInTheDocument();
  });

  it("shows EOA + balance and no contract rows for a plain account", async () => {
    const spy = vi.spyOn(explorerApi, "fetchAddressInfo").mockResolvedValue({
      address: EOA,
      balance: "1500000000000000000",
      balancePLS: "1.5",
      isContract: false,
    });
    const contractSpy = vi.spyOn(explorerApi, "fetchContractInfo");

    renderWithProviders(<AddressPreview address={EOA} chainId={369} />);

    expect(await screen.findByText("EOA")).toBeInTheDocument();
    expect(screen.getByText("1.5")).toBeInTheDocument();
    expect(screen.queryByText("Verified")).not.toBeInTheDocument();
    // The contract-name query is gated on isContract — never fires for an EOA.
    expect(contractSpy).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalledWith(EOA, 369); // pinned chain, not the route's
  });

  it("renders an error state when the lookup fails", async () => {
    vi.spyOn(explorerApi, "fetchAddressInfo").mockRejectedValue(new Error("rpc down"));
    renderWithProviders(<AddressPreview address={EOA} chainId={369} />);
    expect(await screen.findByText(/Couldn't load address preview/)).toBeInTheDocument();
  });
});

describe("TxPreview", () => {
  const TX = "0xd515ef07d4308c389b05fe13c55ac1ebe3270bd8bbf4470b0a134a1766fe3c81";

  function txDetails(over: Partial<explorerApi.TransactionDetails> = {}) {
    return {
      hash: TX,
      blockNumber: "26804224",
      from: EOA,
      to: "0x165c3410fc91ef562c50559f7d2289febed552d9",
      value: "0",
      valuePLS: "0",
      status: "success",
      timestamp: 1781000000,
      decodedInput: { functionName: "transfer", args: [] },
      decodedLogs: [],
      rawLogs: [],
      internalTransactions: [],
      tokenTransfers: [],
      ...over,
    } as unknown as explorerApi.TransactionDetails;
  }

  it("summarizes a successful tx: status, method, from/to, block", async () => {
    vi.spyOn(explorerApi, "fetchTransaction").mockResolvedValue(txDetails());
    renderWithProviders(<TxPreview hash={TX} chainId={369} />);

    expect(await screen.findByText("success")).toBeInTheDocument();
    expect(screen.getByText("transfer")).toBeInTheDocument();
    expect(screen.getByText("26,804,224")).toBeInTheDocument(); // block, localized
    expect(screen.getByText(/mined/)).toBeInTheDocument();
  });

  it("labels a contract-creation tx (no `to`)", async () => {
    vi.spyOn(explorerApi, "fetchTransaction").mockResolvedValue(
      txDetails({ to: null }),
    );
    renderWithProviders(<TxPreview hash={TX} chainId={369} />);
    expect(await screen.findByText("(contract creation)")).toBeInTheDocument();
  });
});

describe("BlockPreview", () => {
  function blockDetails() {
    // Real block 26804492 header facts.
    return {
      number: "26804492",
      hash: "0x",
      parentHash: "0x",
      timestamp: 1781661795,
      miner: "0x5ead01d58067a68d0d700374500580ec5c961d0d",
      gasUsed: "126394",
      gasLimit: "44880000",
      baseFeePerGas: "452626936053887",
      transactionCount: 2,
      size: "0",
      transactions: [],
    } as unknown as explorerApi.BlockDetails;
  }

  it("summarizes a block: number, tx count, miner, gas %", async () => {
    vi.spyOn(explorerApi, "fetchBlock").mockResolvedValue(blockDetails());
    renderWithProviders(<BlockPreview numberOrHash="26804492" chainId={369} />);

    expect(await screen.findByText("26,804,492")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument(); // tx count
    // gasUsed/gasLimit = 126394 / 44_880_000 ≈ 0.3%
    expect(screen.getByText("0.3%")).toBeInTheDocument();
  });
});
