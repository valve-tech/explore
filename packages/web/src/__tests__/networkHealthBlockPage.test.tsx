import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { Routes, Route } from "react-router-dom";
import { renderWithProviders } from "./_test-utils";

/**
 * The standalone, shareable single-block network-health page
 * (/network-health/block/:number). It renders a header for the block plus the
 * FeeLadder (data hook mocked), and rejects a non-numeric block id.
 */

const useBlockLadder = vi.fn();
vi.mock("../hooks/useNetworkHealth", () => ({
  useBlockLadder: (n: string) => useBlockLadder(n),
}));

import NetworkHealthBlockPage from "../pages/NetworkHealthBlockPage";

function renderAt(path: string) {
  return renderWithProviders(
    <Routes>
      <Route
        path="/network-health/block/:number"
        element={<NetworkHealthBlockPage />}
      />
    </Routes>,
    { initialEntries: [path] },
  );
}

describe("<NetworkHealthBlockPage />", () => {
  beforeEach(() => useBlockLadder.mockReset());

  it("shows the block header, a back link, and renders the fee ladder", () => {
    useBlockLadder.mockReturnValue({
      isPending: false,
      isError: false,
      data: {
        number: "26804492",
        timestamp: 1781661795,
        baseFeePerGas: "452626936053887",
        txCount: 0, // empty ladder → FeeLadder shows its "no transactions" note
        burnsBaseFee: true,
        priorityInversionRate: null,
        txs: [],
      },
    });
    renderAt("/network-health/block/26804492");
    expect(
      screen.getByRole("heading", { name: /Block #26804492/ }),
    ).toBeInTheDocument();
    // back link points at the window view
    const back = screen.getByRole("link", { name: /All blocks/i });
    expect(back.getAttribute("href")).toBe("/network-health");
    // the FeeLadder mounted and consumed the block number
    expect(useBlockLadder).toHaveBeenCalledWith("26804492");
  });

  it("rejects a non-numeric block id without calling the data hook", () => {
    renderAt("/network-health/block/not-a-block");
    expect(screen.getByText(/isn't a valid block number/i)).toBeInTheDocument();
    expect(useBlockLadder).not.toHaveBeenCalled();
  });
});
