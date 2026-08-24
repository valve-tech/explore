import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AlsoOnBar from "../components/explorer/AlsoOnBar";

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
});
