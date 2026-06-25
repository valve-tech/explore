import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";

/**
 * ExplorerPanel is the URL-driven router shell that picks tx / address / block /
 * contract / home views and renders the breadcrumb trail. We stub every child
 * view so the test focuses on Panel's own routing + breadcrumb logic, and use a
 * real WPLS address for the address/contract paths (chain 369):
 *   https://scan.pulsechain.com/address/0xA1077a294dDE1B09bB078844df40758a5D0f9a27
 */

vi.mock("../components/explorer/TxDetail", () => ({
  default: ({ hash }: { hash: string }) => <div>tx-view:{hash}</div>,
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
vi.mock("../components/explorer/ContractView", () => ({
  default: ({ address }: { address: string }) => (
    <div>contract-view:{address}</div>
  ),
}));
vi.mock("../components/explorer/ExplorerHome", () => ({
  default: ({
    onNavigate,
  }: {
    onNavigate: (t: { type: string; value: string }) => void;
  }) => (
    <div>
      home-view
      <button
        onClick={() =>
          onNavigate({ type: "block", value: "26804492" })
        }
      >
        go-block
      </button>
      <button
        onClick={() =>
          onNavigate({ type: "address", value: "0xaddr" })
        }
      >
        go-address
      </button>
      <button
        onClick={() =>
          onNavigate({ type: "contract", value: "0xcontract" })
        }
      >
        go-contract
      </button>
    </div>
  ),
}));
vi.mock("../lib/recentEntities", () => ({
  recordVisit: vi.fn(),
}));

import ExplorerPanel from "../components/explorer/ExplorerPanel";
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
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("<ExplorerPanel /> — view routing", () => {
  beforeEach(() => (recordVisit as ReturnType<typeof vi.fn>).mockReset());
  afterEach(() => vi.restoreAllMocks());

  it("renders the home view with no breadcrumb at /explorer", () => {
    renderAt("/explorer");
    expect(screen.getByText("home-view")).toBeInTheDocument();
    expect(
      screen.queryByRole("navigation", { name: "Explorer trail" }),
    ).not.toBeInTheDocument();
  });

  it("renders the tx view + breadcrumb at /tx/:hash and records a visit", () => {
    const hash = "0x" + "ab".repeat(32);
    renderAt(`/tx/${hash}`);
    expect(screen.getByText(`tx-view:${hash}`)).toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: "Explorer trail" }),
    ).toBeInTheDocument();
    expect(recordVisit).toHaveBeenCalledWith({ kind: "tx", value: hash });
  });

  it("renders the address view at /address/:address", () => {
    renderAt(`/address/${WPLS}`);
    expect(screen.getByText(`address-view:${WPLS}`)).toBeInTheDocument();
    expect(recordVisit).toHaveBeenCalledWith({ kind: "address", value: WPLS });
  });

  it("renders the contract view at /token/:address", () => {
    renderAt(`/token/${WPLS}`);
    expect(screen.getByText(`contract-view:${WPLS}`)).toBeInTheDocument();
    expect(recordVisit).toHaveBeenCalledWith({ kind: "contract", value: WPLS });
  });

  it("renders the block view at /block/:id", () => {
    renderAt("/block/26804492");
    expect(screen.getByText("block-view:26804492")).toBeInTheDocument();
    expect(recordVisit).toHaveBeenCalledWith({
      kind: "block",
      value: "26804492",
    });
  });
});

describe("<ExplorerPanel /> — navigation + breadcrumb", () => {
  beforeEach(() => (recordVisit as ReturnType<typeof vi.fn>).mockReset());
  afterEach(() => vi.restoreAllMocks());

  it("navigates home → block and builds a breadcrumb trail (Home + current)", () => {
    renderAt("/explorer");
    fireEvent.click(screen.getByText("go-block"));

    expect(screen.getByText("block-view:26804492")).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Explorer trail" });
    // Home crumb is clickable; current crumb is aria-current.
    expect(nav).toHaveTextContent("Home");
    expect(screen.getByText("#26804492")).toBeInTheDocument();
  });

  it("navigates home → address and across to a tx, growing the trail", () => {
    renderAt("/explorer");
    fireEvent.click(screen.getByText("go-address"));
    expect(screen.getByText("address-view:0xaddr")).toBeInTheDocument();

    // From the address view, jump to a tx — trail now has Home + address.
    fireEvent.click(screen.getByText("go-tx"));
    expect(screen.getByText("tx-view:0xhash")).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Explorer trail" });
    expect(nav).toHaveTextContent("Home");
    // Back button appears once there's history behind the current view.
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
  });

  it("jumps back to Home from the breadcrumb", () => {
    renderAt("/explorer");
    fireEvent.click(screen.getByText("go-contract"));
    expect(screen.getByText("contract-view:0xcontract")).toBeInTheDocument();

    // Click the Home crumb button.
    fireEvent.click(screen.getByRole("button", { name: "Home" }));
    expect(screen.getByText("home-view")).toBeInTheDocument();
  });
});
