import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import BlockHeightView from "../components/explorer/BlockHeightView";

const heightMock = vi.hoisted(() => vi.fn());
vi.mock("../api/multichain", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/multichain")>()),
  fetchBlockAtHeight: heightMock,
}));

function renderView(height = "26923553") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <BlockHeightView height={height} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  heightMock.mockReset();
  heightMock.mockResolvedValue([
    { chainId: 1, reached: false, head: 21402118 },
    { chainId: 369, reached: true, hash: "0x8f21", txCount: 142, gasUsed: "22200000", gasLimit: "30000000", timestamp: 1700000000 },
    { chainId: 943, reached: true, hash: "0x21ab", txCount: 3, gasUsed: "1200000", gasLimit: "30000000", timestamp: 1699400000 },
    { chainId: 11155111, reached: false, head: 7118904 },
  ]);
});

describe("BlockHeightView", () => {
  it("links every chain that has reached the height", async () => {
    renderView();
    await waitFor(() =>
      expect(screen.getByRole("link", { name: /PulseChain$/ })).toHaveAttribute(
        "href",
        "/eip155/369/block/26923553",
      ),
    );
  });

  it("collapses chains that have not reached the height, naming their head", async () => {
    renderView();
    await waitFor(() => expect(screen.getByText(/not reached/i)).toBeInTheDocument());
    expect(screen.getByText(/21,402,118/)).toBeInTheDocument();
  });

  it("fills each row by gas used", async () => {
    const { container } = renderView();
    await waitFor(() => expect(screen.getByText(/142/)).toBeInTheDocument());
    const fills = container.querySelectorAll("[data-testid='row-fill']");
    expect((fills[0] as HTMLElement).style.width).toBe("74%");
    expect((fills[1] as HTMLElement).style.width).toBe("4%");
  });
});
