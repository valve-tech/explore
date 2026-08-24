import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import TxDetail from "../TxDetail";
import * as api from "../../../api/explorer";

// TxDetail reads the active chain from the router (useActiveChainId) and its
// action-bar children touch TanStack Query, so the page needs both providers —
// the assertions below are the point of the test, not the wrapper.
function renderTx() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <TxDetail hash="0xabc" onNavigate={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const CORE = {
  hash: "0xabc", blockNumber: "1", blockHash: "0x0", transactionIndex: 0,
  from: "0xfrom0000000000000000000000000000000000aa",
  to: "0xto000000000000000000000000000000000000bb",
  value: "0", valuePLS: "0", gas: "100000", gasPrice: "1", gasUsed: "50000",
  effectiveGasPrice: "1", nonce: 0, input: "0x38ed1739", status: "success",
  timestamp: 1, decodedInput: null, decodedLogs: [],
  rawLogs: [{ address: "0xemit", topics: ["0xddf252ad"], data: "0x", logIndex: 0 }],
  internalTransactions: [], tokenTransfers: [],
} as unknown as api.TransactionDetails;

describe("TxDetail progressive decode", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("renders core facts while decode is still pending", async () => {
    vi.spyOn(api, "fetchTransaction").mockResolvedValue(CORE);
    let resolveDecode!: (d: api.TransactionDecode) => void;
    vi.spyOn(api, "fetchTransactionDecode").mockReturnValue(
      new Promise((r) => { resolveDecode = r; }),
    );

    renderTx();

    // Core is on screen before decode resolves.
    await waitFor(() => expect(screen.getByText(/50000|50,000/)).toBeInTheDocument());
    expect(api.fetchTransaction).toHaveBeenCalledWith("0xabc", expect.any(Number), { decode: false });

    // Decode swaps in. Matched on "swap(" (the rendered function signature)
    // rather than bare "swap" — the next-steps rail's own swap suggestion
    // also renders the word "swap" once decode resolves, in copy like "Wire
    // a Web3 Action to react to swaps like this".
    resolveDecode({ decodedInput: { functionName: "swap", args: [] }, decodedLogs: [] });
    await waitFor(() => expect(screen.getByText(/swap\(/)).toBeInTheDocument());
  });

  it("keeps the page usable when decode is unavailable", async () => {
    vi.spyOn(api, "fetchTransaction").mockResolvedValue(CORE);
    vi.spyOn(api, "fetchTransactionDecode").mockRejectedValue(new Error("504"));

    renderTx();
    await waitFor(() => expect(screen.getByText(/decoding unavailable/i)).toBeInTheDocument());
    // Raw log still shown.
    expect(screen.getByText(/0xddf252ad/)).toBeInTheDocument();
  });
});
