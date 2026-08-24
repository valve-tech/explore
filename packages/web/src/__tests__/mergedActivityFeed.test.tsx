import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
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

describe("MergedActivityFeed", () => {
  it("renders one row per transaction, newest first", () => {
    renderFeed();
    const links = screen.getAllByRole("link");
    expect(links[0]).toHaveAttribute("href", "/eip155/1/tx/0xaaa");
    expect(links[1]).toHaveAttribute("href", "/eip155/369/tx/0xbbb");
  });

  it("names the chain on every row", () => {
    renderFeed();
    expect(screen.getByText(/Ethereum/)).toBeInTheDocument();
    expect(screen.getByText(/PulseChain/)).toBeInTheDocument();
  });

  it("reports an excluded chain instead of dropping it silently", () => {
    renderFeed();
    expect(screen.getByText(/Sepolia/)).toBeInTheDocument();
    expect(screen.getByText(/excluded/i)).toBeInTheDocument();
  });

  it("offers a per-chain jump instead of pretending to page across chains", () => {
    renderFeed();
    expect(screen.getByText(/page deeper on one chain/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Ethereum →/ })).toHaveAttribute(
      "href",
      `/eip155/1/address/${ADDR}`,
    );
  });

  it("renders an empty state rather than a bare footer", () => {
    renderFeed({ rows: [], perChain: [] });
    expect(screen.getByText(/no recent activity/i)).toBeInTheDocument();
  });
});
