import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { TransactionDetails } from "../api/explorer";

/**
 * Component-level tests for TxDetail's pending vs mined branches. TxDetail runs
 * its own useEffect fetch (not TanStack Query), so we mock api/explorer and
 * drive a resolved tx. The behaviour under test: a pending tx shows the mempool
 * banner and the Pending status; a mined tx shows neither.
 */

vi.mock("../api/explorer", () => ({
  fetchTransaction: vi.fn(),
  // TxDetail fetches decode separately via useTxDecode; these tests only care
  // about the core render, so hand back an empty decode.
  fetchTransactionDecode: vi.fn().mockResolvedValue({
    decodedInput: null,
    decodedLogs: [],
  }),
}));

import TxDetail from "../components/explorer/TxDetail";
import { fetchTransaction } from "../api/explorer";

const mockFetch = fetchTransaction as unknown as ReturnType<typeof vi.fn>;

function tx(overrides: Partial<TransactionDetails> = {}): TransactionDetails {
  return {
    hash: "0x" + "ab".repeat(32),
    blockNumber: "12345678",
    blockHash: "0x" + "cd".repeat(32),
    transactionIndex: 0,
    from: "0x" + "11".repeat(20),
    to: "0x" + "22".repeat(20),
    value: "0",
    valuePLS: "0",
    gas: "21000",
    gasPrice: "1000000000",
    gasUsed: "21000",
    effectiveGasPrice: "1000000000",
    nonce: 7,
    input: "0x",
    status: "success",
    timestamp: Math.floor(Date.now() / 1000),
    decodedInput: null,
    decodedLogs: [],
    rawLogs: [],
    internalTransactions: [],
    tokenTransfers: [],
    contractAddress: null,
    cumulativeGasUsed: "21000",
    type: "legacy",
    ...overrides,
  };
}

function renderDetail() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, gcTime: Infinity },
    },
  });
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(<TxDetail hash={tx().hash} onNavigate={vi.fn()} />, {
    wrapper: Wrapper,
  });
}

describe("<TxDetail /> — pending tx", () => {
  beforeEach(() => mockFetch.mockReset());
  afterEach(() => vi.restoreAllMocks());

  it("renders the mempool banner and a Pending status", async () => {
    mockFetch.mockResolvedValue(
      tx({
        status: "pending",
        blockNumber: "pending",
        blockHash: "",
        gasUsed: "0",
        timestamp: null,
      }),
    );
    renderDetail();
    expect(await screen.findByText(/in the mempool/i)).toBeInTheDocument();
    // Pending shows in the status badge (plus block + timestamp rows).
    expect(screen.getAllByText("Pending").length).toBeGreaterThan(0);
  });
});

describe("<TxDetail /> — mined tx", () => {
  beforeEach(() => mockFetch.mockReset());
  afterEach(() => vi.restoreAllMocks());

  it("shows the outcome and no pending banner", async () => {
    mockFetch.mockResolvedValue(tx({ status: "success" }));
    renderDetail();
    expect(await screen.findByText("Success")).toBeInTheDocument();
    expect(screen.queryByText(/in the mempool/i)).not.toBeInTheDocument();
  });
});
