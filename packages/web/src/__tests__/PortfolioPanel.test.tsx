import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "./_test-utils";
import { PortfolioPanel } from "../components/workspace/PortfolioPanel";
import type { Workspace } from "../lib/workspace/types";
import type { HoldingsResult } from "../api/portfolio";

/**
 * Tests for the workspace portfolio rollup. fetch is stubbed per-address; the
 * panel aggregates token balances across addresses and renders native
 * balances, with honest states for "not indexed" and "no addresses".
 */

const HEX = "0x2b591e99afe9f32eaa6214f7b7629768c40eeb39";
const WPLS = "0xa1077a294dde1b09bb078844df40758a5d0f9a27";
const A1 = "0x1111111111111111111111111111111111111111";
const A2 = "0x2222222222222222222222222222222222222222";

function workspace(items: { kind: "address" | "tx" | "block"; value: string }[]): Workspace {
  return {
    id: "w1",
    name: "bags",
    createdAt: 1,
    updatedAt: 1,
    items: items.map((it, i) => ({ id: `i${i}`, kind: it.kind, value: it.value, chainId: 369, addedAt: 1 })),
  };
}

function holdings(address: string, over: Partial<HoldingsResult>): HoldingsResult {
  return {
    chainId: 369,
    address,
    native: { symbol: "PLS", balance: "0" },
    holdings: [],
    indexed: true,
    ...over,
  };
}

/** Stub fetch to return a holdings result keyed by the address query param. */
function stubHoldings(byAddress: Record<string, HoldingsResult>) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    const addr = new URL(url, "http://x").searchParams.get("address")!.toLowerCase();
    const result = byAddress[addr];
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, result }),
      text: async () => JSON.stringify({ ok: true, result }),
    } as Response;
  });
}

beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.restoreAllMocks());

describe("<PortfolioPanel />", () => {
  it("renders nothing when the workspace has no address items", () => {
    const { container } = renderWithProviders(
      <PortfolioPanel workspace={workspace([{ kind: "tx", value: "0xabc" }])} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("aggregates a token across addresses and counts holders", async () => {
    stubHoldings({
      [A1]: holdings(A1, {
        native: { symbol: "PLS", balance: "10000000000000000000" },
        holdings: [
          { tokenAddress: HEX, symbol: "HEX", name: "HEXcoin", decimals: 8, balance: "100000000" },
        ],
      }),
      [A2]: holdings(A2, {
        native: { symbol: "PLS", balance: "5000000000000000000" },
        holdings: [
          { tokenAddress: HEX, symbol: "HEX", name: "HEXcoin", decimals: 8, balance: "300000000" },
          { tokenAddress: WPLS, symbol: "WPLS", name: "Wrapped Pulse", decimals: 18, balance: "2000000000000000000" },
        ],
      }),
    });

    renderWithProviders(
      <PortfolioPanel workspace={workspace([{ kind: "address", value: A1 }, { kind: "address", value: A2 }])} />,
    );

    // HEX summed across A1 (1) + A2 (3) = 4, held by 2 addresses.
    await waitFor(() => expect(screen.getByText("HEX")).toBeInTheDocument());
    const hexRow = screen.getByText("HEX").closest("tr")!;
    expect(hexRow).toHaveTextContent("4");
    expect(hexRow).toHaveTextContent("2"); // holder count
    // WPLS only in A2.
    expect(screen.getByText("WPLS").closest("tr")!).toHaveTextContent("1");
    // header reflects 2 addresses
    expect(screen.getByText(/2 addresses/)).toBeInTheDocument();
  });

  it("falls back to a searchable MiddleTruncate when a token has no symbol", async () => {
    // Regression for the bug fixed in 7319c53: a symbol-less token used to
    // have its address pre-truncated via truncateAddr() and stored INTO the
    // symbol field, so the full address appeared nowhere in the DOM. The fix
    // keeps `symbol` empty and lets HoldingsTable fall back to a searchable
    // MiddleTruncate of the address at render time.
    const NO_SYMBOL = "0x3333333333333333333333333333333333333333";
    stubHoldings({
      [A1]: holdings(A1, {
        holdings: [
          { tokenAddress: NO_SYMBOL, symbol: "", name: "", decimals: 18, balance: "1000000000000000000" },
        ],
      }),
    });

    renderWithProviders(
      <PortfolioPanel workspace={workspace([{ kind: "address", value: A1 }])} />,
    );

    // MiddleTruncate keeps the full value in the DOM via its `title` attr —
    // proves the fallback fired and the full address is searchable.
    await waitFor(() => expect(screen.getByTitle(NO_SYMBOL)).toBeInTheDocument());
    // The old bug rendered a JS-sliced "0x3333...3333" string INTO the symbol
    // slot (scoped to this token's row — the NativeList below legitimately
    // truncates the wallet address the same way, which isn't the bug here).
    const row = screen.getByTitle(NO_SYMBOL).closest("tr")!;
    expect(row).not.toHaveTextContent("0x3333...3333");
  });

  it("queries the passed chain and labels it (Ethereum = chain 1)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          result: holdings(A1, { chainId: 1, native: { symbol: "ETH", balance: "0" } }),
        }),
        text: async () => "",
        // expose the url for the assertion below
        _url: url,
      } as unknown as Response;
    });

    renderWithProviders(
      <PortfolioPanel workspace={workspace([{ kind: "address", value: A1 }])} chainId={1} />,
    );

    await waitFor(() => expect(screen.getByText(/· Ethereum/)).toBeInTheDocument());
    // non-default chain → the request carries chainid=1
    expect(String(fetchSpy.mock.calls[0]![0])).toContain("chainid=1");
  });

  it("shows the not-indexed note when every result is indexed:false", async () => {
    stubHoldings({
      [A1]: holdings(A1, { indexed: false, native: { symbol: "PLS", balance: "7000000000000000000" } }),
    });
    renderWithProviders(
      <PortfolioPanel workspace={workspace([{ kind: "address", value: A1 }])} />,
    );
    await waitFor(() =>
      expect(screen.getByText(/aren't indexed for this chain yet/i)).toBeInTheDocument(),
    );
    // native still shown
    expect(screen.getByText(/7 PLS/)).toBeInTheDocument();
  });
});
