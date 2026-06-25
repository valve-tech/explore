import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "./_test-utils";
import type { ContractInfo } from "../api/explorer";

/**
 * ContractView is a useEffect fetch shell that picks an initial sub-tab and
 * renders Read/Write/ABI/Source/Chart panels. Mock api/explorer + the transfer
 * hook (chart) and assert tab wiring against a real verified token, WPLS on
 * chain 369 (decimals 18, symbol WPLS):
 *   https://scan.pulsechain.com/address/0xA1077a294dDE1B09bB078844df40758a5D0f9a27
 */

vi.mock("../api/explorer", () => ({
  fetchContractInfo: vi.fn(),
}));

vi.mock("../hooks/useTokenTransfers", () => ({
  useTokenTransfers: vi.fn(),
}));

// Read functions auto-call on render in some setups — stub the call path so a
// rendered ReadFunction doesn't hit the network.
vi.mock("../components/explorer/ContractView/callReadFunction", () => ({
  callReadFunction: vi.fn().mockResolvedValue({ ok: true, values: [] }),
}));

import ContractView from "../components/explorer/ContractView";
import { fetchContractInfo } from "../api/explorer";
import { useTokenTransfers } from "../hooks/useTokenTransfers";

const mockContract = fetchContractInfo as unknown as ReturnType<typeof vi.fn>;
const mockTransfers = useTokenTransfers as unknown as ReturnType<typeof vi.fn>;

const WPLS = "0xA1077a294dDE1B09bB078844df40758a5D0f9a27";

const tokenAbi = [
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
    ],
  },
];

function info(overrides: Partial<ContractInfo> = {}): ContractInfo {
  return {
    address: WPLS,
    isVerified: true,
    contractName: "WPLS",
    compilerVersion: "v0.5.0",
    optimizationUsed: true,
    sourceCode: "contract WPLS {}",
    abi: tokenAbi,
    constructorArguments: "",
    evmVersion: "",
    library: "",
    licenseType: "",
    proxy: "",
    implementation: "",
    swarmSource: "",
    ...overrides,
  };
}

const emptyTransfers = {
  records: [],
  status: "success" as const,
  error: null,
  fromBlock: null,
  headBlock: null,
  window: "24h" as const,
  loadingMore: false,
  loadMore: vi.fn(),
  canLoadMore: false,
};

describe("<ContractView />", () => {
  beforeEach(() => {
    mockContract.mockReset();
    mockTransfers.mockReset();
    mockTransfers.mockReturnValue(emptyTransfers);
  });
  afterEach(() => vi.restoreAllMocks());

  it("shows loading copy before the contract resolves", () => {
    mockContract.mockReturnValue(new Promise(() => {}));
    renderWithProviders(<ContractView address={WPLS} onNavigate={vi.fn()} />);
    expect(screen.getByText("Loading contract...")).toBeInTheDocument();
  });

  it("renders the error message on failure", async () => {
    mockContract.mockRejectedValue(new Error("not found"));
    renderWithProviders(<ContractView address={WPLS} onNavigate={vi.fn()} />);
    expect(await screen.findByText("not found")).toBeInTheDocument();
  });

  it("opens on the read tab with read function count and switches across tabs", async () => {
    mockContract.mockResolvedValue(info());
    renderWithProviders(<ContractView address={WPLS} onNavigate={vi.fn()} />);

    // Read (1) tab is the initial pick for a function-bearing ABI.
    expect(await screen.findByRole("button", { name: "Read (1)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Write (1)" })).toBeInTheDocument();

    // Write tab → shows the write function name + payable-less signature.
    fireEvent.click(screen.getByRole("button", { name: "Write (1)" }));
    expect(await screen.findByText("transfer")).toBeInTheDocument();

    // ABI tab → JSON dump.
    fireEvent.click(screen.getByRole("button", { name: "ABI" }));
    expect(await screen.findByText(/"type": "function"/)).toBeInTheDocument();

    // Source tab → source text.
    fireEvent.click(screen.getByRole("button", { name: "Source" }));
    expect(await screen.findByText("contract WPLS {}")).toBeInTheDocument();

    // Chart tab is shown because the ABI has a Transfer event (token).
    fireEvent.click(screen.getByRole("button", { name: "Chart" }));
    expect(await screen.findByText("Transfers")).toBeInTheDocument();
  });

  it("navigates to the address view from the header", async () => {
    mockContract.mockResolvedValue(info());
    const onNavigate = vi.fn();
    renderWithProviders(<ContractView address={WPLS} onNavigate={onNavigate} />);
    fireEvent.click(await screen.findByText("View Address"));
    expect(onNavigate).toHaveBeenCalledWith({ type: "address", value: WPLS });
  });

  it("falls back to the source tab when there are no functions", async () => {
    mockContract.mockResolvedValue(
      info({ abi: [], sourceCode: "// just source" }),
    );
    renderWithProviders(<ContractView address={WPLS} onNavigate={vi.fn()} />);
    expect(await screen.findByText("// just source")).toBeInTheDocument();
    // No read/write functions → empty messages reachable.
    fireEvent.click(screen.getByRole("button", { name: "Read (0)" }));
    expect(
      await screen.findByText("No read functions available"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Write (0)" }));
    expect(
      await screen.findByText("No write functions available"),
    ).toBeInTheDocument();
  });

  it("falls back to the ABI tab when unverified with no source or functions", async () => {
    mockContract.mockResolvedValue(
      info({ abi: null, sourceCode: "", isVerified: false, contractName: "" }),
    );
    renderWithProviders(<ContractView address={WPLS} onNavigate={vi.fn()} />);
    expect(
      await screen.findByText("ABI not available (contract not verified)"),
    ).toBeInTheDocument();
    expect(screen.getByText("Unverified")).toBeInTheDocument();
  });
});

describe("<ContractView /> — chart states", () => {
  beforeEach(() => {
    mockContract.mockReset();
    mockTransfers.mockReset();
    mockContract.mockResolvedValue(info());
  });
  afterEach(() => vi.restoreAllMocks());

  it("renders the transfer chart loading/error/empty/populated branches", async () => {
    // Populated chart with two records spanning a block window.
    mockTransfers.mockReturnValue({
      ...emptyTransfers,
      records: [
        { blockNumber: 26804224 },
        { blockNumber: 26804492 },
      ] as never,
      fromBlock: 26804000,
      headBlock: 26804492,
      canLoadMore: true,
    });
    renderWithProviders(<ContractView address={WPLS} onNavigate={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Chart" }));
    expect(await screen.findByText("2 transfers")).toBeInTheDocument();
    expect(screen.getByText("Widen window")).toBeInTheDocument();
  });

  it("shows the chart loading state", async () => {
    mockTransfers.mockReturnValue({ ...emptyTransfers, status: "loading" });
    renderWithProviders(<ContractView address={WPLS} onNavigate={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Chart" }));
    expect(await screen.findByText("Loading transfers…")).toBeInTheDocument();
  });

  it("shows the chart error state", async () => {
    mockTransfers.mockReturnValue({
      ...emptyTransfers,
      status: "error",
      error: "rpc down",
    });
    renderWithProviders(<ContractView address={WPLS} onNavigate={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Chart" }));
    expect(await screen.findByText("rpc down")).toBeInTheDocument();
  });

  it("shows the chart empty state", async () => {
    mockTransfers.mockReturnValue({ ...emptyTransfers, status: "success" });
    renderWithProviders(<ContractView address={WPLS} onNavigate={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Chart" }));
    expect(
      await screen.findByText("No transfers in this window."),
    ).toBeInTheDocument();
  });
});
