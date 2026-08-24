import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import ChainPresenceStrip from "../components/explorer/MultiChainAddressView/ChainPresenceStrip";
import type { ChainPresence } from "../api/multichain";

const ADDR = "0x11490e0f8050fa8a3f40c5aa9bb20fb76b010b68";

const rows: ChainPresence[] = [
  { chainId: 1, balance: "12401000000000000000", nonce: 1204, isContract: false },
  { chainId: 369, balance: "8201113000000000000000000", nonce: 94, isContract: false },
  { chainId: 943, balance: "0", nonce: 0, isContract: false },
  { chainId: 11155111, balance: "0", nonce: 0, isContract: false, error: true },
];

function renderStrip(input = rows) {
  return render(
    <MemoryRouter>
      <ChainPresenceStrip address={ADDR} rows={input} shares={{ 1: 0.68, 369: 0.32 }} />
    </MemoryRouter>,
  );
}

describe("ChainPresenceStrip", () => {
  it("renders one row per chain with presence", () => {
    renderStrip();
    expect(screen.getByText("Ethereum")).toBeInTheDocument();
    expect(screen.getByText("PulseChain")).toBeInTheDocument();
  });

  it("links each present chain to its chain-scoped address page", () => {
    renderStrip();
    const link = screen.getByRole("link", { name: /Ethereum/ });
    expect(link).toHaveAttribute("href", `/eip155/1/address/${ADDR}`);
  });

  it("collapses every absent chain into a single line", () => {
    renderStrip();
    expect(screen.getByText(/not here/i)).toBeInTheDocument();
    // 943 is absent, so it must NOT get its own row link.
    expect(screen.queryByRole("link", { name: /PulseChain Testnet v4/ })).toBeNull();
  });

  it("shows an errored chain as unavailable, never as absent", () => {
    renderStrip();
    expect(screen.getByText(/unavailable/i)).toBeInTheDocument();
    const notHere = screen.getByText(/not here/i).closest("div")!;
    expect(notHere.textContent).not.toMatch(/Sepolia/);
  });

  it("renders an empty-state line when the address is on no chain at all", () => {
    renderStrip(rows.map((r) => ({ ...r, balance: "0", nonce: 0, isContract: false, error: undefined })));
    expect(screen.getByText(/no activity on any chain/i)).toBeInTheDocument();
  });

  it("labels the nonce as sent, not as a transaction total", () => {
    renderStrip();
    // The nonce counts transactions SENT. Calling it a tx count would be a lie:
    // a real total needs the archive.
    expect(screen.getByText(/1,204 sent/)).toBeInTheDocument();
    expect(screen.queryByText(/1,204 txs?$/)).toBeNull();
  });
});
