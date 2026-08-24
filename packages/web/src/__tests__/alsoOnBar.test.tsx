import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AlsoOnBar from "../components/explorer/AlsoOnBar";
import { setShowTestnets } from "../lib/settings/testnets";

const ADDR = "0x11490e0f8050fa8a3f40c5aa9bb20fb76b010b68";

const presenceMock = vi.hoisted(() => vi.fn());
vi.mock("../api/multichain", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/multichain")>()),
  fetchChainPresence: presenceMock,
}));

function renderBar(activeChainId = 1) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AlsoOnBar address={ADDR} activeChainId={activeChainId} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  presenceMock.mockReset();
  presenceMock.mockResolvedValue([
    { chainId: 1, balance: "1", nonce: 1, isContract: false },
    { chainId: 369, balance: "1", nonce: 1, isContract: false },
    { chainId: 943, balance: "0", nonce: 0, isContract: false },
  ]);
  // The testnet store is module-level, so `localStorage.clear()` alone does
  // not reset it (see testnetToggle.test.tsx). Reset it explicitly so a case
  // that flips the toggle cannot leak into the next one.
  localStorage.clear();
  setShowTestnets(true);
});

describe("AlsoOnBar", () => {
  it("links every other chain with presence", async () => {
    renderBar(1);
    await waitFor(() =>
      expect(screen.getByRole("link", { name: /PulseChain/ })).toHaveAttribute(
        "href",
        `/eip155/369/address/${ADDR}`,
      ),
    );
  });

  it("marks the active chain and does not link it", async () => {
    renderBar(1);
    await waitFor(() => expect(screen.getByText("Ethereum")).toBeInTheDocument());
    expect(screen.queryByRole("link", { name: /Ethereum/ })).toBeNull();
  });

  it("offers a link to the all-chain page", async () => {
    renderBar(1);
    await waitFor(() =>
      expect(screen.getByRole("link", { name: /all/i })).toHaveAttribute(
        "href",
        `/address/${ADDR}`,
      ),
    );
  });

  it("renders nothing while the probe is in flight", () => {
    presenceMock.mockReturnValue(new Promise(() => {}));
    const { container } = renderBar(1);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the address is on one chain only", async () => {
    presenceMock.mockResolvedValue([
      { chainId: 1, balance: "1", nonce: 1, isContract: false },
      { chainId: 369, balance: "0", nonce: 0, isContract: false },
    ]);
    const { container } = renderBar(1);
    await waitFor(() => expect(presenceMock).toHaveBeenCalled());
    // A bar advertising no alternatives is noise.
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("updates its chain set when the testnet toggle flips, without remounting", async () => {
    // The mock must honour the requested chain set — a blanket
    // mockResolvedValue would hide the bug this test exists to catch, since
    // the component would show the same rows no matter which chains it asked
    // for.
    presenceMock.mockImplementation((_address: string, chainIds: number[]) =>
      Promise.resolve(
        [
          { chainId: 1, balance: "1", nonce: 1, isContract: false },
          { chainId: 369, balance: "1", nonce: 1, isContract: false },
          { chainId: 943, balance: "1", nonce: 1, isContract: false },
        ].filter((row) => chainIds.includes(row.chainId)),
      ),
    );
    renderBar(1);
    // Testnets start visible, so chain 943 is in the probe and in the bar.
    await waitFor(() =>
      expect(screen.getByRole("link", { name: /PulseChain Testnet v4/ })).toBeInTheDocument(),
    );

    await act(async () => {
      setShowTestnets(false);
    });

    // The toggle now excludes 943 from the probe entirely. A bar that kept
    // showing it would be serving a stale answer instead of tracking the
    // setting it shares a cache key with.
    await waitFor(() =>
      expect(screen.queryByRole("link", { name: /PulseChain Testnet v4/ })).toBeNull(),
    );
  });
});
