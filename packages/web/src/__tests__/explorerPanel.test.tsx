import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route, Link } from "react-router-dom";

/**
 * ExplorerPanel is the URL-driven router shell that picks tx / address / block /
 * contract / home views and renders the breadcrumb trail. We stub every child
 * view so the test focuses on Panel's own routing + breadcrumb logic, and use a
 * real WPLS address for the address/contract paths (chain 369):
 *   https://scan.pulsechain.com/address/0xA1077a294dDE1B09bB078844df40758a5D0f9a27
 */

vi.mock("../components/explorer/TxDetail", () => ({
  default: ({
    hash,
    onNavigate,
  }: {
    hash: string;
    onNavigate: (t: { type: string; value: string }) => void;
  }) => (
    <div>
      tx-view:{hash}
      <button onClick={() => onNavigate({ type: "address", value: "0xAddrFromTx" })}>
        tx-go-addr
      </button>
    </div>
  ),
}));
vi.mock("../components/explorer/AddressView", () => ({
  default: ({
    address,
    onNavigate,
  }: {
    address: string;
    onNavigate: (t: { type: string; value: string }) => void;
  }) => (
    <div>
      address-view:{address}
      <button onClick={() => onNavigate({ type: "tx", value: "0xhash" })}>
        go-tx
      </button>
    </div>
  ),
}));
vi.mock("../components/explorer/BlockView", () => ({
  default: ({ numberOrHash }: { numberOrHash: string }) => (
    <div>block-view:{numberOrHash}</div>
  ),
}));
// A bare block NUMBER is now the all-chain height page, not BlockView — stub it
// the same way as MultiChainAddressView so routing tests can tell them apart.
vi.mock("../components/explorer/BlockHeightView", () => ({
  default: ({ height }: { height: string }) => (
    <div>block-height-view:{height}</div>
  ),
}));
vi.mock("../components/explorer/ContractView", () => ({
  default: ({ address }: { address: string }) => (
    <div>contract-view:{address}</div>
  ),
}));
/*
 * ExplorerHome renders LINKS, not buttons wired to a callback. Its rows are
 * `EntityRow`s with an `href`, so a click navigates the router rather than
 * invoking `handleNavigate`. This mock has to do the same or these tests
 * exercise a component shape that no longer exists.
 *
 * The hrefs are chain-scoped because the real ones are: the home page reads
 * ONE chain's blocks and transactions (a bare /explorer collapses to
 * DEFAULT_CHAIN_ID), so a row it renders is known to live on that chain, and
 * linking it bare would throw away that knowledge and fan out across four.
 */
vi.mock("../components/explorer/ExplorerHome", () => ({
  // Named, and capitalised, so the rules-of-hooks lint can see it is a
  // component and allow the hook call.
  default: function MockExplorerHome() {
    const chainId = useActiveChainId();
    return (
      <div>
        home-view
        <Link to={scanPath("block", "26804492", chainId)}>go-block</Link>
        <Link to={scanPath("address", "0xaddr", chainId)}>go-address</Link>
        <Link to={scanPath("contract", "0xcontract", chainId)}>go-contract</Link>
      </div>
    );
  },
}));

vi.mock("../lib/recentEntities", () => ({
  recordVisit: vi.fn(),
}));

// A bare address/contract page is now the all-chain page, not AddressView or
// ContractView — stub it so routing tests can tell the two apart without
// pulling in the real presence + activity fetches.
vi.mock("../components/explorer/MultiChainAddressView", () => ({
  default: ({ address }: { address: string }) => (
    <div>multi-chain-view:{address}</div>
  ),
}));

// Entity views now mount only after the chain-less deep link has been resolved
// to a chain (see useResolvedChainRedirect). Stub the probe to "no match", which
// is the no-redirect path, so these tests stay about routing + breadcrumbs.
// Mounting is asynchronous as a result — the entity assertions below use
// findBy* rather than getBy*.
const resolveEntity = vi.hoisted(() => vi.fn());
vi.mock("../api/resolve", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/resolve")>();
  return { ...actual, resolveEntity };
});

import ExplorerPanel from "../components/explorer/ExplorerPanel";
import { scanPath } from "../lib/scanRoutes";
import { useActiveChainId } from "../lib/activeChain";
import { recordVisit } from "../lib/recentEntities";

const WPLS = "0xA1077a294dDE1B09bB078844df40758a5D0f9a27";

function renderAt(path: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/explorer" element={<ExplorerPanel />} />
          <Route path="/tx/:hash" element={<ExplorerPanel />} />
          <Route path="/block/:id" element={<ExplorerPanel />} />
          <Route path="/address/:address" element={<ExplorerPanel />} />
          <Route path="/token/:address" element={<ExplorerPanel />} />
          {/* Mirrors the chain-scoped mount in App.tsx: the same ExplorerPanel
              reached through a /eip155/<ref>/… prefix. Proves view detection
              still picks the entity view, not home, once the prefix is present,
              and that a scoped address/contract page keeps its single-chain
              view instead of the all-chain one. */}
          <Route path="/eip155/:ref/explorer" element={<ExplorerPanel />} />
          <Route path="/eip155/:ref/tx/:hash" element={<ExplorerPanel />} />
          <Route path="/eip155/:ref/block/:id" element={<ExplorerPanel />} />
          <Route path="/eip155/:ref/address/:address" element={<ExplorerPanel />} />
          <Route path="/eip155/:ref/token/:address" element={<ExplorerPanel />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("<ExplorerPanel /> — view routing", () => {
  beforeEach(() => {
    (recordVisit as ReturnType<typeof vi.fn>).mockReset();
    resolveEntity.mockReset();
    resolveEntity.mockResolvedValue({ kind: "tx", query: "", matches: [] });
  });
  afterEach(() => vi.restoreAllMocks());

  it("renders the home view with no breadcrumb at /explorer", () => {
    renderAt("/explorer");
    expect(screen.getByText("home-view")).toBeInTheDocument();
    expect(
      screen.queryByRole("navigation", { name: "Explorer trail" }),
    ).not.toBeInTheDocument();
  });

  it("renders the tx view + breadcrumb at /tx/:hash and records a visit", async () => {
    const hash = "0x" + "ab".repeat(32);
    renderAt(`/tx/${hash}`);
    expect(await screen.findByText(`tx-view:${hash}`)).toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: "Explorer trail" }),
    ).toBeInTheDocument();
    // No chain in the URL yet, so none is recorded — the recents link stays
    // bare and re-resolves, which is the legacy behaviour.
    expect(recordVisit).toHaveBeenCalledWith({
      kind: "tx",
      value: hash,
      chainId: undefined,
    });
  });

  it("records the page's chain, so the recents link can name it", async () => {
    const hash = "0x" + "ef".repeat(32);
    renderAt(`/eip155/369/tx/${hash}`);
    expect(await screen.findByText(`tx-view:${hash}`)).toBeInTheDocument();
    expect(recordVisit).toHaveBeenCalledWith({
      kind: "tx",
      value: hash,
      chainId: 369,
    });
  });

  it("renders the tx view, not home, under a chain-scoped prefix", async () => {
    // Regression test: ExplorerPanel used to pick its view from the FULL
    // location.pathname ("/tx/…"), which never matches once a chain prefix
    // is present ("/eip155/369/tx/…") — it silently fell back to the home
    // view instead of the transaction.
    const hash = "0x" + "cd".repeat(32);
    renderAt(`/eip155/369/tx/${hash}`);
    expect(await screen.findByText(`tx-view:${hash}`)).toBeInTheDocument();
    expect(screen.queryByText("home-view")).not.toBeInTheDocument();
  });

  it("renders the all-chain address view at /address/:address (no chain scope)", async () => {
    renderAt(`/address/${WPLS}`);
    expect(await screen.findByText(`multi-chain-view:${WPLS}`)).toBeInTheDocument();
    // An all-chain page has no one chain to record.
    expect(recordVisit).toHaveBeenCalledWith({
      kind: "address",
      value: WPLS,
      chainId: undefined,
    });
    // An address is valid on every chain — no probe is needed to pick one.
    expect(resolveEntity).not.toHaveBeenCalled();
  });

  it("renders the single-chain address view under a chain-scoped prefix", async () => {
    renderAt(`/eip155/369/address/${WPLS}`);
    expect(await screen.findByText(`address-view:${WPLS}`)).toBeInTheDocument();
  });

  it("renders the all-chain address view at /token/:address (no chain scope)", async () => {
    renderAt(`/token/${WPLS}`);
    expect(await screen.findByText(`multi-chain-view:${WPLS}`)).toBeInTheDocument();
    expect(recordVisit).toHaveBeenCalledWith({ kind: "contract", value: WPLS });
    expect(resolveEntity).not.toHaveBeenCalled();
  });

  it("renders the single-chain contract view under a chain-scoped prefix", async () => {
    renderAt(`/eip155/369/token/${WPLS}`);
    expect(await screen.findByText(`contract-view:${WPLS}`)).toBeInTheDocument();
    expect(recordVisit).toHaveBeenCalledWith({
      kind: "contract",
      value: WPLS,
      chainId: 369,
    });
  });

  it("renders the all-chain block-height view at /block/:id (no chain scope)", async () => {
    renderAt("/block/26804492");
    expect(await screen.findByText("block-height-view:26804492")).toBeInTheDocument();
    expect(recordVisit).toHaveBeenCalledWith({
      kind: "block",
      value: "26804492",
    });
  });

  it("renders the single-chain block view under a chain-scoped prefix", async () => {
    renderAt("/eip155/369/block/26804492");
    expect(await screen.findByText("block-view:26804492")).toBeInTheDocument();
  });
});

describe("<ExplorerPanel /> — navigation + breadcrumb", () => {
  beforeEach(() => {
    (recordVisit as ReturnType<typeof vi.fn>).mockReset();
    resolveEntity.mockReset();
    resolveEntity.mockResolvedValue({ kind: "tx", query: "", matches: [] });
  });
  afterEach(() => vi.restoreAllMocks());

  it("navigates home → block and builds a breadcrumb trail (Home + current)", async () => {
    // Chain-scoped for the same reason as the address/contract cases below: a
    // bare block-number link lands on the terminal all-chain height page,
    // which renders no breadcrumb at all.
    renderAt("/eip155/369/explorer");
    fireEvent.click(screen.getByText("go-block"));

    expect(await screen.findByText("block-view:26804492")).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Explorer trail" });
    // Home crumb is clickable; current crumb is aria-current.
    expect(nav).toHaveTextContent("Home");
    expect(screen.getByText("#26804492")).toBeInTheDocument();
  });

  it("navigates home → address and across to a tx, growing the trail", async () => {
    // Started chain-scoped: from a bare, all-chain page an address link would
    // land on the terminal all-chain view instead, which has no "go-tx" arm.
    renderAt("/eip155/369/explorer");
    fireEvent.click(screen.getByText("go-address"));
    expect(await screen.findByText("address-view:0xaddr")).toBeInTheDocument();

    // From the address view, jump to a tx — trail now has Home + address.
    fireEvent.click(screen.getByText("go-tx"));
    expect(await screen.findByText("tx-view:0xhash")).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Explorer trail" });
    expect(nav).toHaveTextContent("Home");
    // Back button appears once there's history behind the current view.
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
  });

  it("jumps back to Home from the breadcrumb", async () => {
    // Chain-scoped for the same reason as above: a bare contract link lands
    // on the all-chain page, which the mocked ContractView never renders.
    renderAt("/eip155/369/explorer");
    fireEvent.click(screen.getByText("go-contract"));
    expect(await screen.findByText("contract-view:0xcontract")).toBeInTheDocument();

    // Click the Home crumb button.
    fireEvent.click(screen.getByRole("button", { name: "Home" }));
    expect(screen.getByText("home-view")).toBeInTheDocument();
  });
});

describe("<ExplorerPanel /> — pathForView keeps the active chain", () => {
  beforeEach(() => {
    (recordVisit as ReturnType<typeof vi.fn>).mockReset();
    resolveEntity.mockReset();
    resolveEntity.mockResolvedValue({ kind: "tx", query: "", matches: [] });
  });
  afterEach(() => vi.restoreAllMocks());

  it("keeps the chain scope when navigating from a scoped page", async () => {
    // A click from /eip155/369/tx/<hash> must build /eip155/369/address/<addr>,
    // not the bare /address/<addr> — a bare path lands on the all-chain page
    // instead of AddressView, and costs a needless four-chain resolve fan-out.
    const hash = "0x" + "ef".repeat(32);
    renderAt(`/eip155/369/tx/${hash}`);
    fireEvent.click(await screen.findByText("tx-go-addr"));
    expect(await screen.findByText("address-view:0xAddrFromTx")).toBeInTheDocument();
  });

  it("stays bare when navigating from an all-chain page", async () => {
    // Launched from a bare tx page rather than from home. `handleNavigate` is
    // what this test is about, and home no longer calls it: its rows are
    // links, and they are chain-scoped because the home page reads exactly
    // one chain's blocks and transactions. TxDetail still takes onNavigate,
    // and a bare /tx/<hash> is genuinely un-scoped, so it is the honest
    // launcher for the bare case.
    const hash = "0x" + "ef".repeat(32);
    renderAt(`/tx/${hash}`);
    fireEvent.click(await screen.findByText("tx-go-addr"));
    // Bare page → bare address path → the all-chain view, not AddressView.
    expect(
      await screen.findByText("multi-chain-view:0xAddrFromTx"),
    ).toBeInTheDocument();
  });
});
