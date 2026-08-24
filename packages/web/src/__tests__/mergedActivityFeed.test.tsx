import { describe, it, expect } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import MergedActivityFeed from "../components/explorer/MultiChainAddressView/MergedActivityFeed";
import type { MergedActivity } from "../api/multichain";

const ADDR = "0x11490e0f8050fa8a3f40c5aa9bb20fb76b010b68";

const activity: MergedActivity = {
  rows: [
    { chainId: 1, hash: "0xaaa", timeStamp: "1700000300", methodName: "swap" },
    { chainId: 369, hash: "0xbbb", timeStamp: "1700000200", methodName: "transfer" },
  ],
  perChain: [
    { chainId: 1, returned: 1 },
    { chainId: 369, returned: 1 },
    { chainId: 11155111, returned: 0, error: true },
  ],
};

function renderFeed(input = activity) {
  return render(
    <MemoryRouter>
      <MergedActivityFeed address={ADDR} activity={input} />
    </MemoryRouter>,
  );
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

/**
 * Renders the feed on a real route, with a second route standing in for the
 * page a footer jump lands on. A router `Link` updates the app's location
 * in place; a plain `<a href>` would instead trigger a full page navigation,
 * which jsdom cannot perform and the in-app location would never change.
 */
function renderFeedRouted(input = activity) {
  return render(
    <MemoryRouter initialEntries={["/eip155/369/address/" + ADDR]}>
      <LocationProbe />
      <Routes>
        <Route
          path="/eip155/:chainId/address/:address"
          element={<MergedActivityFeed address={ADDR} activity={input} />}
        />
        <Route
          path="/eip155/:chainId/tx/:hash"
          element={<div data-testid="dest">tx page</div>}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("MergedActivityFeed", () => {
  it("renders one row per transaction, newest first", () => {
    renderFeed();
    const links = screen.getAllByRole("link");
    expect(links[0]).toHaveAttribute("href", "/eip155/1/tx/0xaaa");
    expect(links[1]).toHaveAttribute("href", "/eip155/369/tx/0xbbb");
  });

  it("names the chain on every row", () => {
    renderFeed();
    // Scope to the row links themselves: the footer names the same two
    // chains, so a page-wide text query can't tell a row from a footer link.
    const links = screen.getAllByRole("link");
    expect(links[0]).toHaveTextContent(/Ethereum/);
    expect(links[1]).toHaveTextContent(/PulseChain/);
  });

  it("reports an excluded chain instead of dropping it silently", () => {
    renderFeed();
    expect(screen.getByText(/Sepolia/)).toBeInTheDocument();
    expect(screen.getByText(/excluded/i)).toBeInTheDocument();
  });

  it("offers a per-chain jump instead of pretending to page across chains", () => {
    renderFeed();
    expect(screen.getByText(/page deeper on one chain/i)).toBeInTheDocument();
    const footer = screen.getByRole("navigation", { name: /page deeper on one chain/i });
    expect(within(footer).getByRole("link", { name: /Ethereum/ })).toHaveAttribute(
      "href",
      `/eip155/1/address/${ADDR}`,
    );
  });

  it("renders an empty state rather than a bare footer", () => {
    renderFeed({ rows: [], perChain: [] });
    expect(screen.getByText(/no recent activity/i)).toBeInTheDocument();
  });

  it("navigates the footer's reachable-chain jumps via the router, not a full page load", () => {
    renderFeedRouted();
    const footer = screen.getByRole("navigation", { name: /page deeper on one chain/i });
    const link = within(footer).getByRole("link", { name: /Ethereum/ });
    fireEvent.click(link);
    // A router `Link` updates the in-app location in place. A plain `<a href>`
    // would instead hand the click to jsdom's unimplemented full navigation,
    // and this location would never move off the page the test started on.
    expect(screen.getByTestId("location")).toHaveTextContent(`/eip155/1/address/${ADDR}`);
  });
});
