import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import MultiChainAddressView from "../components/explorer/MultiChainAddressView";

const ADDR = "0x11490e0f8050fa8a3f40c5aa9bb20fb76b010b68";

const presenceMock = vi.hoisted(() => vi.fn());
const activityMock = vi.hoisted(() => vi.fn());
vi.mock("../api/multichain", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/multichain")>()),
  fetchChainPresence: presenceMock,
  fetchMergedActivity: activityMock,
}));

function Wrap({ entry, children }: { entry: string; children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  presenceMock.mockReset();
  activityMock.mockReset();
  presenceMock.mockResolvedValue([
    { chainId: 1, balance: "1", nonce: 5, isContract: false },
    { chainId: 369, balance: "2", nonce: 3, isContract: false },
  ]);
  activityMock.mockResolvedValue({
    rows: [{ chainId: 1, hash: "0xaaa", timeStamp: "1700000300", methodName: "swap" }],
    perChain: [{ chainId: 1, returned: 1 }],
  });
});

describe("MultiChainAddressView", () => {
  it("shows every chain the address lives on", async () => {
    render(
      <Wrap entry={`/address/${ADDR}`}>
        <MultiChainAddressView address={ADDR} />
      </Wrap>,
    );
    await waitFor(() => expect(screen.getByText("Ethereum")).toBeInTheDocument());
    expect(screen.getByText("PulseChain")).toBeInTheDocument();
  });

  it("computes each chain's share from its returned row count", async () => {
    activityMock.mockResolvedValue({
      rows: [
        { chainId: 1, hash: "0xa", timeStamp: "3", methodName: "x" },
        { chainId: 1, hash: "0xb", timeStamp: "2", methodName: "x" },
        { chainId: 369, hash: "0xc", timeStamp: "1", methodName: "x" },
      ],
      perChain: [{ chainId: 1, returned: 2 }, { chainId: 369, returned: 1 }],
    });
    render(
      <Wrap entry={`/address/${ADDR}`}>
        <MultiChainAddressView address={ADDR} />
      </Wrap>,
    );
    await waitFor(() => expect(screen.getByText(/67% of recent/)).toBeInTheDocument());
    expect(screen.getByText(/33% of recent/)).toBeInTheDocument();
  });

  it("surfaces an error instead of rendering an empty page", async () => {
    presenceMock.mockRejectedValue(new Error("upstream down"));
    render(
      <Wrap entry={`/address/${ADDR}`}>
        <MultiChainAddressView address={ADDR} />
      </Wrap>,
    );
    await waitFor(() => expect(screen.getByText(/upstream down/i)).toBeInTheDocument());
  });

  it("surfaces an activity-fetch failure instead of claiming there is no activity", async () => {
    // Presence succeeds (there IS a real answer to "where does this address
    // live"), but the activity fetch fails. Falling through to the empty
    // MergedActivityFeed state would render "No recent activity on any chain
    // we could reach" — a false claim indistinguishable from a real empty
    // result, which is exactly the failure mode this page exists to rule out.
    activityMock.mockRejectedValue(new Error("archive timed out"));
    render(
      <Wrap entry={`/address/${ADDR}`}>
        <MultiChainAddressView address={ADDR} />
      </Wrap>,
    );
    await waitFor(() => expect(screen.getByText(/archive timed out/i)).toBeInTheDocument());
    expect(
      screen.queryByText(/no recent activity on any chain/i),
    ).not.toBeInTheDocument();
    // The presence strip must still have rendered normally — one query
    // failing must not take the other's honest result down with it.
    expect(screen.getByText("Ethereum")).toBeInTheDocument();
  });
});

describe("chain-less address URLs no longer redirect", () => {
  it("leaves /address/0x… on the all-chain page", async () => {
    function Probe() {
      const location = useLocation();
      return <div data-testid="url">{location.pathname + location.search}</div>;
    }
    render(
      <Wrap entry={`/address/${ADDR}`}>
        <Routes>
          <Route
            path="/address/:address"
            element={<><Probe /><MultiChainAddressView address={ADDR} /></>}
          />
        </Routes>
      </Wrap>,
    );
    await waitFor(() => expect(screen.getByText("Ethereum")).toBeInTheDocument());
    expect(screen.getByTestId("url")).toHaveTextContent(`/address/${ADDR}`);
    expect(screen.getByTestId("url")).not.toHaveTextContent("chainid");
    expect(screen.getByTestId("url")).not.toHaveTextContent("eip155");
  });
});
