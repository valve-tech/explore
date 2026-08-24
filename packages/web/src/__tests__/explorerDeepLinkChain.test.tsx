import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import ExplorerPanel from "../components/explorer/ExplorerPanel";

/**
 * The EIP-3091 explorer routes have the same chain-less deep-link defect the
 * debugger had, reported separately against
 * https://explore.valve.city/tx/0xa3e41b90…d36c — chain 943, block 25058074.
 * Without `?chainid` the API answered `404 {"error":"Transaction not found"}`;
 * with `?chainid=943` the same request returns the full transaction.
 *
 * These paths are the shareable surface of the app (that's the point of
 * EIP-3091), so they are exactly the URLs that get pasted with no chain on them.
 */

const resolveEntity = vi.hoisted(() => vi.fn());
vi.mock("../api/resolve", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/resolve")>();
  return { ...actual, resolveEntity };
});

// The entity views each fetch on their own; stub them down to a marker that
// reports the chain they'd have used, so the assertions are about routing.
vi.mock("../components/explorer/TxDetail", () => ({
  default: ({ hash }: { hash: string }) => <div data-testid="tx-detail">{hash}</div>,
}));
vi.mock("../components/explorer/AddressView", () => ({
  default: ({ address }: { address: string }) => (
    <div data-testid="address-view">{address}</div>
  ),
}));
vi.mock("../components/explorer/BlockView", () => ({
  default: ({ numberOrHash }: { numberOrHash: string }) => (
    <div data-testid="block-view">{numberOrHash}</div>
  ),
}));
// A bare block NUMBER renders every chain now, not a single one — stub it so
// these tests stay about the resolve+redirect behaviour of the OTHER routes.
vi.mock("../components/explorer/BlockHeightView", () => ({
  default: ({ height }: { height: string }) => (
    <div data-testid="block-height-view">{height}</div>
  ),
}));
vi.mock("../components/explorer/ContractView", () => ({
  default: ({ address }: { address: string }) => (
    <div data-testid="contract-view">{address}</div>
  ),
}));
vi.mock("../components/explorer/ExplorerHome", () => ({
  default: () => <div data-testid="explorer-home" />,
}));
// A bare address/contract page renders every chain now, not a single one —
// stub it so these tests stay about the resolve+redirect behaviour of the
// OTHER routes, without pulling in real presence/activity fetches.
vi.mock("../components/explorer/MultiChainAddressView", () => ({
  default: ({ address }: { address: string }) => (
    <div data-testid="multi-chain-address-view">{address}</div>
  ),
}));
vi.mock("../lib/recentEntities", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/recentEntities")>();
  return { ...actual, recordVisit: vi.fn() };
});

/** The transaction from the report — mined on chain 943, not 369. */
const TX_943 =
  "0xa3e41b9066546c37bb84dc7bdf39b1277a589ba4b874cd2f75b0c3aea589d36c";
const ADDR = "0xb81513eee23fca64e86772ec0c3b541a70ae72d5";
const PULSECHAIN_TESTNET = 943;
const PULSECHAIN = 369;

beforeEach(() => {
  resolveEntity.mockReset();
  resolveEntity.mockResolvedValue({ kind: "tx", query: TX_943, matches: [] });
});

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="search">{location.search}</div>;
}

function renderAt(path: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={client}>
        <LocationProbe />
        <Routes>
          <Route path="/explorer" element={<ExplorerPanel />} />
          <Route path="/tx/:hash" element={<ExplorerPanel />} />
          <Route path="/block/:id" element={<ExplorerPanel />} />
          <Route path="/address/:address" element={<ExplorerPanel />} />
          <Route path="/token/:address" element={<ExplorerPanel />} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("/tx/:hash deep link", () => {
  it("rewrites the URL to the chain the tx lives on", async () => {
    resolveEntity.mockResolvedValue({
      kind: "tx",
      query: TX_943,
      matches: [{ chainId: PULSECHAIN_TESTNET }],
    });

    renderAt(`/tx/${TX_943}`);

    await waitFor(() =>
      expect(screen.getByTestId("search").textContent).toBe("?chainid=943"),
    );
    expect(resolveEntity).toHaveBeenCalledWith(TX_943);
  });

  it("does not render the tx view against the wrong chain first", async () => {
    let release: (v: unknown) => void = () => {};
    resolveEntity.mockReturnValue(
      new Promise((res) => {
        release = res;
      }),
    );

    renderAt(`/tx/${TX_943}`);

    // Resolve in flight — TxDetail must not have mounted and fetched on 369.
    await waitFor(() => expect(resolveEntity).toHaveBeenCalled());
    expect(screen.queryByTestId("tx-detail")).not.toBeInTheDocument();
    expect(screen.getByText("Finding chain...")).toBeInTheDocument();

    release({ kind: "tx", query: TX_943, matches: [{ chainId: PULSECHAIN_TESTNET }] });
    await waitFor(() =>
      expect(screen.getByTestId("tx-detail")).toBeInTheDocument(),
    );
  });

  it("leaves an explicit ?chainid alone and never probes", async () => {
    renderAt(`/tx/${TX_943}?chainid=943`);

    await waitFor(() =>
      expect(screen.getByTestId("tx-detail")).toBeInTheDocument(),
    );
    expect(resolveEntity).not.toHaveBeenCalled();
    expect(screen.getByTestId("search").textContent).toBe("?chainid=943");
  });

  it("keeps the URL param-free for a default-chain tx", async () => {
    resolveEntity.mockResolvedValue({
      kind: "tx",
      query: TX_943,
      matches: [{ chainId: PULSECHAIN }],
    });

    renderAt(`/tx/${TX_943}`);

    await waitFor(() =>
      expect(screen.getByTestId("tx-detail")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("search").textContent).toBe("");
  });

  it("still renders when the tx resolves to no chain at all", async () => {
    resolveEntity.mockResolvedValue({ kind: "tx", query: TX_943, matches: [] });

    renderAt(`/tx/${TX_943}`);

    await waitFor(() =>
      expect(screen.getByTestId("tx-detail")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("search").textContent).toBe("");
  });
});

describe("the other EIP-3091 routes", () => {
  it("/address/:address no longer resolves or redirects — it renders every chain", async () => {
    // An address is valid on every chain, so "which one?" has no correct
    // answer. The old behaviour (redirect to the first chain with presence)
    // is gone; the all-chain view answers the real question instead.
    renderAt(`/address/${ADDR}`);

    await waitFor(() =>
      expect(screen.getByTestId("multi-chain-address-view")).toBeInTheDocument(),
    );
    expect(resolveEntity).not.toHaveBeenCalled();
    expect(screen.getByTestId("search").textContent).toBe("");
  });

  it("/token/:address renders every chain too, with no resolve", async () => {
    renderAt(`/token/${ADDR}`);

    await waitFor(() =>
      expect(screen.getByTestId("multi-chain-address-view")).toBeInTheDocument(),
    );
    expect(resolveEntity).not.toHaveBeenCalled();
  });

  it("/block/<number> stays on the default chain — a height is not chain-specific", async () => {
    // Every chain past that height "has" the block, so resolveEntity matches
    // 369 among others and the hook must leave the URL alone. Redirecting a
    // bare block number to a testnet because it sorted first would be wrong.
    resolveEntity.mockResolvedValue({
      kind: "block",
      query: "25058074",
      matches: [{ chainId: PULSECHAIN }, { chainId: PULSECHAIN_TESTNET }],
    });

    renderAt("/block/25058074");

    // A bare block number is chain-less by design — it renders every chain,
    // not one BlockView.
    await waitFor(() =>
      expect(screen.getByTestId("block-height-view")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("search").textContent).toBe("");
    // BlockHeightView fans this number out across every chain on its own.
    // Resolving it here first would fan out twice for one page load — the
    // resolve must never fire for this case, matching the address/token
    // cases above.
    expect(resolveEntity).not.toHaveBeenCalled();
  });
});

describe("the explorer home", () => {
  it("has no entity to resolve, so it never probes or blocks", async () => {
    renderAt("/explorer");

    await waitFor(() =>
      expect(screen.getByTestId("explorer-home")).toBeInTheDocument(),
    );
    expect(resolveEntity).not.toHaveBeenCalled();
    expect(screen.queryByText("Finding chain...")).not.toBeInTheDocument();
  });
});
