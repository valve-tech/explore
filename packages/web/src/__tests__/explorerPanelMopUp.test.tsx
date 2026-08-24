import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";

/**
 * ExplorerPanel coverage mop-up — the breadcrumb/navigation arms the base
 * explorerPanel.test.tsx leaves uncovered:
 *   - goBack()  (the Back button → navigate(-1))
 *   - jumpTo(index>=0)  (clicking an intermediate history crumb)
 *   - the collapsed-trail "…" expander (long trail collapses, then expands)
 *
 * Child views are stubbed (each exposes a nav button) so the test exercises
 * Panel's own routing + breadcrumb logic. The tx stub navigates to a fresh
 * address each time so the trail can grow past CRUMB_VISIBLE.
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
      <button onClick={() => onNavigate({ type: "address", value: "0xafterTx" })}>
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
      <button
        onClick={() =>
          onNavigate({ type: "tx", value: "0x" + address.slice(2, 6) })
        }
      >
        addr-go-tx
      </button>
    </div>
  ),
}));
vi.mock("../components/explorer/BlockView", () => ({
  default: ({
    numberOrHash,
    onNavigate,
  }: {
    numberOrHash: string;
    onNavigate: (t: { type: string; value: string }) => void;
  }) => (
    <div>
      block-view:{numberOrHash}
      <button onClick={() => onNavigate({ type: "address", value: "0xfromblock" })}>
        block-go-addr
      </button>
    </div>
  ),
}));
vi.mock("../components/explorer/ContractView", () => ({
  default: ({ address }: { address: string }) => <div>contract-view:{address}</div>,
}));
vi.mock("../components/explorer/ExplorerHome", () => ({
  default: ({
    onNavigate,
  }: {
    onNavigate: (t: { type: string; value: string }) => void;
  }) => (
    <div>
      home-view
      <button onClick={() => onNavigate({ type: "block", value: "100" })}>
        home-go-block
      </button>
    </div>
  ),
}));
vi.mock("../lib/recentEntities", () => ({ recordVisit: vi.fn() }));

// Entity views mount only after a chain-less deep link resolves to a chain
// (useResolvedChainRedirect). Stub the probe to "no match" — the no-redirect
// path — so these stay about breadcrumbs. Mounting is async as a result, hence
// findBy* below.
const resolveEntity = vi.hoisted(() => vi.fn());
vi.mock("../api/resolve", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/resolve")>();
  return { ...actual, resolveEntity };
});

import ExplorerPanel from "../components/explorer/ExplorerPanel";

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
          {/* A bare /address/:address is now the all-chain page, which the
              mocked AddressView never renders — these breadcrumb tests need a
              chain-scoped start so an address link stays on AddressView. */}
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

describe("<ExplorerPanel /> — breadcrumb navigation arms", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveEntity.mockResolvedValue({ kind: "tx", query: "", matches: [] });
  });
  afterEach(() => vi.restoreAllMocks());

  it("goes back via the Back button (navigate(-1))", async () => {
    renderAt("/eip155/369/explorer");
    fireEvent.click(screen.getByText("home-go-block"));
    await screen.findByText(/block-view:/);
    fireEvent.click(screen.getByText("block-go-addr"));
    await screen.findByText(/address-view:/);
    expect(await screen.findByText("address-view:0xfromblock")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByText("block-view:100")).toBeInTheDocument();
  });

  it("jumps to an intermediate history crumb (jumpTo index>=0)", async () => {
    renderAt("/eip155/369/explorer");
    fireEvent.click(screen.getByText("home-go-block"));
    await screen.findByText(/block-view:/); // trail: [] → block
    fireEvent.click(screen.getByText("block-go-addr"));
    await screen.findByText(/address-view:/); // trail: [block] → address
    expect(await screen.findByText("address-view:0xfromblock")).toBeInTheDocument();

    // The block crumb (history index 0) is a clickable button → jumpTo(0).
    const nav = screen.getByRole("navigation", { name: "Explorer trail" });
    fireEvent.click(within(nav).getByText("#100"));
    expect(await screen.findByText("block-view:100")).toBeInTheDocument();
  });

  it("collapses a long trail and expands it with the '…' button", async () => {
    renderAt("/eip155/369/explorer");
    // Grow the trail past CRUMB_VISIBLE (4): each hop pushes the prior view.
    fireEvent.click(screen.getByText("home-go-block"));
    await screen.findByText(/block-view:/); // cur block, trail []
    fireEvent.click(screen.getByText("block-go-addr"));
    await screen.findByText(/address-view:/); // cur address, trail [block]
    fireEvent.click(screen.getByText("addr-go-tx"));
    await screen.findByText(/tx-view:/); // cur tx, trail [block, address]
    fireEvent.click(screen.getByText("tx-go-addr"));
    await screen.findByText(/address-view:/); // cur address, trail [block, address, tx]
    fireEvent.click(screen.getByText("addr-go-tx"));
    await screen.findByText(/tx-view:/); // cur tx, trail [block, address, tx, address]
    // Now nodes = Home + 4 history + current = 6 > CRUMB_VISIBLE+1 → collapses.

    const nav = screen.getByRole("navigation", { name: "Explorer trail" });
    // The collapse expander renders its label as a "…" button.
    const expander = within(nav).getByText("…");
    expect(expander).toBeInTheDocument();

    fireEvent.click(expander);
    // After expanding, the "…" expander is gone (full trail shown).
    expect(within(nav).queryByText("…")).not.toBeInTheDocument();
  });
});
