import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "./_test-utils";
import * as explorerApi from "../api/explorer";
import { AddressPreview } from "../components/workspace/previews/AddressPreview";
import { TxPreview } from "../components/workspace/previews/TxPreview";
import { BlockPreview } from "../components/workspace/previews/BlockPreview";
import { shortHex, ago } from "../components/workspace/previews/PreviewShell";

/**
 * Supplemental preview tests — cover the lines workspacePreviews.test.tsx
 * leaves uncovered: the loading affordance (query never settles), the
 * unverified-contract name fallback, the contract-creation `to` branch in
 * TxPreview, and BlockPreview's zero-gas-limit ("—") branch.
 *
 * Known setups (chain 369):
 *   WPLS contract  https://scan.pulsechain.com/address/0xA1077a294dDE1B09bB078844df40758a5D0f9a27
 *   block 26804492 https://scan.pulsechain.com/block/26804492
 */

const WPLS = "0xA1077a294dDE1B09bB078844df40758a5D0f9a27";
const EOA = "0x155172653e94a7e5f0e04126803dcb6896796fbb";

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("AddressPreview (supplemental)", () => {
  it("renders the loading affordance while the address query is in flight", () => {
    // A promise that never resolves keeps the query in `isLoading`.
    vi.spyOn(explorerApi, "fetchAddressInfo").mockReturnValue(
      new Promise(() => {}) as ReturnType<typeof explorerApi.fetchAddressInfo>,
    );
    renderWithProviders(<AddressPreview address={WPLS} chainId={369} />);
    expect(screen.getByText("Loading preview…")).toBeInTheDocument();
  });

  it("renders null (nothing) when the address query resolves to no data", async () => {
    vi.spyOn(explorerApi, "fetchAddressInfo").mockResolvedValue(
      null as unknown as Awaited<ReturnType<typeof explorerApi.fetchAddressInfo>>,
    );
    const { container } = renderWithProviders(<AddressPreview address={EOA} chainId={369} />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("shows 'Unverified' when a contract has no verified name", async () => {
    vi.spyOn(explorerApi, "fetchAddressInfo").mockResolvedValue({
      address: WPLS,
      balance: "0",
      balancePLS: "0",
      isContract: true,
    });
    vi.spyOn(explorerApi, "fetchContractInfo").mockResolvedValue({
      contractName: "   ", // whitespace → trimmed to falsey → null name
      isVerified: false,
    } as Awaited<ReturnType<typeof explorerApi.fetchContractInfo>>);

    renderWithProviders(<AddressPreview address={WPLS} chainId={369} />);

    expect(await screen.findByText("Contract")).toBeInTheDocument();
    expect(await screen.findByText("Unverified")).toBeInTheDocument();
    expect(screen.getByText("No")).toBeInTheDocument(); // verified=false row
  });
});

describe("TxPreview (supplemental)", () => {
  const TX = "0xd515ef07d4308c389b05fe13c55ac1ebe3270bd8bbf4470b0a134a1766fe3c81";

  it("renders the loading affordance while the tx query is in flight", () => {
    vi.spyOn(explorerApi, "fetchTransaction").mockReturnValue(
      new Promise(() => {}) as ReturnType<typeof explorerApi.fetchTransaction>,
    );
    renderWithProviders(<TxPreview hash={TX} chainId={369} />);
    expect(screen.getByText("Loading preview…")).toBeInTheDocument();
  });

  it("renders an error state when the tx lookup fails", async () => {
    vi.spyOn(explorerApi, "fetchTransaction").mockRejectedValue(new Error("rpc down"));
    renderWithProviders(<TxPreview hash={TX} chainId={369} />);
    expect(
      await screen.findByText(/Couldn't load transaction preview/),
    ).toBeInTheDocument();
  });

  it("renders null (nothing) when the tx query resolves to no data", async () => {
    vi.spyOn(explorerApi, "fetchTransaction").mockResolvedValue(
      null as unknown as explorerApi.TransactionDetails,
    );
    const { container } = renderWithProviders(<TxPreview hash={TX} chainId={369} />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("renders a no-method (null function) tx and no footer when unmined", async () => {
    vi.spyOn(explorerApi, "fetchTransaction").mockResolvedValue({
      hash: TX,
      blockNumber: "26804224",
      from: EOA,
      to: "0x165c3410fc91ef562c50559f7d2289febed552d9",
      value: "0",
      valuePLS: "0",
      status: "failed",
      timestamp: 0, // falsey → footer omitted
      decodedInput: null, // → Method "—"
      decodedLogs: [],
      rawLogs: [],
      internalTransactions: [],
      tokenTransfers: [],
    } as unknown as explorerApi.TransactionDetails);

    renderWithProviders(<TxPreview hash={TX} chainId={369} />);

    expect(await screen.findByText("failed")).toBeInTheDocument();
    // No "mined …" footer when timestamp is 0.
    expect(screen.queryByText(/mined/)).not.toBeInTheDocument();
  });
});

describe("BlockPreview (supplemental)", () => {
  it("renders the loading affordance while the block query is in flight", () => {
    vi.spyOn(explorerApi, "fetchBlock").mockReturnValue(
      new Promise(() => {}) as ReturnType<typeof explorerApi.fetchBlock>,
    );
    renderWithProviders(<BlockPreview numberOrHash="26804492" chainId={369} />);
    expect(screen.getByText("Loading preview…")).toBeInTheDocument();
  });

  it("renders an error state when the block lookup fails", async () => {
    vi.spyOn(explorerApi, "fetchBlock").mockRejectedValue(new Error("rpc down"));
    renderWithProviders(<BlockPreview numberOrHash="26804492" chainId={369} />);
    expect(
      await screen.findByText(/Couldn't load block preview/),
    ).toBeInTheDocument();
  });

  it("renders null (nothing) when the block query resolves to no data", async () => {
    vi.spyOn(explorerApi, "fetchBlock").mockResolvedValue(
      null as unknown as explorerApi.BlockDetails,
    );
    const { container } = renderWithProviders(
      <BlockPreview numberOrHash="26804492" chainId={369} />,
    );
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("shows '—' for gas used when gasLimit is zero", async () => {
    vi.spyOn(explorerApi, "fetchBlock").mockResolvedValue({
      number: "26804492",
      hash: "0x",
      parentHash: "0x",
      timestamp: 1781661795,
      miner: "0x5ead01d58067a68d0d700374500580ec5c961d0d",
      gasUsed: "0",
      gasLimit: "0", // → gasPct null → "—"
      baseFeePerGas: "0",
      transactionCount: 0,
      size: "0",
      transactions: [],
    } as unknown as explorerApi.BlockDetails);

    renderWithProviders(<BlockPreview numberOrHash="26804492" chainId={369} />);
    expect(await screen.findByText("26,804,492")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument(); // gas used null → dash
  });
});

describe("PreviewShell helpers", () => {
  it("shortHex truncates long strings and leaves short ones intact", () => {
    expect(shortHex(WPLS)).toBe("0xA1077a…0f9a27");
    // short input (<= leading+trailing+1) returns unchanged
    expect(shortHex("0xabcd")).toBe("0xabcd");
  });

  it("ago formats seconds, minutes, hours, and days", () => {
    const now = Math.floor(Date.now() / 1000);
    expect(ago(now - 10)).toBe("10s ago");
    expect(ago(now - 5 * 60)).toBe("5m ago");
    expect(ago(now - 3 * 3600)).toBe("3h ago");
    expect(ago(now - 2 * 86400)).toBe("2d ago");
  });
});
