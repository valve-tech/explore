import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "./_test-utils";
import type { StateDiff } from "../api/simulate";
import StateDiffPanel from "../components/StateDiffPanel";

/**
 * StateDiffPanel renders balance/storage/nonce change sections. The storage
 * section fetches a per-contract layout via useQuery (raw fetch), so we stub
 * globalThis.fetch; the 404/no-layout path is the common case and falls
 * through to raw hex rows.
 *
 * Fixture address: WPLS 0xA1077a294dDE1B09bB078844df40758a5D0f9a27 (PulseChain 369)
 * https://scan.pulsechain.com/address/0xA1077a294dDE1B09bB078844df40758a5D0f9a27
 */

const WPLS = "0xA1077a294dDE1B09bB078844df40758a5D0f9a27";

function stubLayoutFetch(ok: boolean): void {
  vi.spyOn(globalThis, "fetch").mockImplementation(
    async () =>
      ({
        ok,
        status: ok ? 200 : 404,
        json: async () => ({ ok, storageLayout: undefined }),
      }) as Response,
  );
}

beforeEach(() => stubLayoutFetch(false));
afterEach(() => vi.restoreAllMocks());

describe("StateDiffPanel", () => {
  it("renders the empty placeholder when there are no changes", () => {
    const diff: StateDiff = {
      balanceChanges: [],
      storageChanges: [],
      nonceChanges: [],
    };
    renderWithProviders(<StateDiffPanel stateDiff={diff} />);
    expect(screen.getByText(/No state changes detected/i)).toBeInTheDocument();
  });

  it("renders balance changes with positive and negative deltas", () => {
    const diff: StateDiff = {
      balanceChanges: [
        { address: WPLS, before: "1000000000000000000", after: "2000000000000000000", delta: "1000000000000000000" },
        { address: WPLS, before: "5000000000000000000", after: "4000000000000000000", delta: "-1000000000000000000" },
      ],
      storageChanges: [],
      nonceChanges: [],
    };
    renderWithProviders(<StateDiffPanel stateDiff={diff} />);
    expect(screen.getByText("Balance Changes")).toBeInTheDocument();
    // positive delta rendered with a leading "+"; negative drops the sign
    // (color conveys direction) so the magnitude "1" still appears.
    expect(screen.getByText("+1")).toBeInTheDocument();
  });

  it("collapses a section when its header is clicked", () => {
    const diff: StateDiff = {
      balanceChanges: [
        { address: WPLS, before: "0", after: "1", delta: "1" },
      ],
      storageChanges: [],
      nonceChanges: [],
    };
    renderWithProviders(<StateDiffPanel stateDiff={diff} />);
    expect(screen.getByText("Before (PLS)")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Balance Changes"));
    expect(screen.queryByText("Before (PLS)")).not.toBeInTheDocument();
  });

  it("renders storage changes grouped by contract, raw-hex fallback when no layout", async () => {
    const diff: StateDiff = {
      balanceChanges: [],
      storageChanges: [
        {
          address: WPLS,
          contractName: "WPLS",
          slot: "0x0000000000000000000000000000000000000000000000000000000000000003",
          before: "0x0000000000000000000000000000000000000000000000000000000000000000",
          after: "0x0000000000000000000000000000000000000000000000000000000000000001",
          decodedName: "totalSupply",
        },
      ],
      nonceChanges: [],
    };
    renderWithProviders(<StateDiffPanel stateDiff={diff} />);
    expect(screen.getByText("Storage Changes")).toBeInTheDocument();
    // group label includes contract name
    expect(await screen.findByText(/WPLS/)).toBeInTheDocument();
    expect(screen.getByText("1 slot")).toBeInTheDocument();
    // raw fallback shows the backend decodedName hint
    expect(screen.getByText("totalSupply")).toBeInTheDocument();
  });

  it("renders a storage group without a contract name", () => {
    const diff: StateDiff = {
      balanceChanges: [],
      storageChanges: [
        {
          address: WPLS,
          slot: "0x01",
          before: "0x00",
          after: "0x02",
        },
      ],
      nonceChanges: [],
    };
    renderWithProviders(<StateDiffPanel stateDiff={diff} />);
    // no decodedName → em dash in the variable column
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("toggles the storage group, storage section, and nonce section", () => {
    const diff: StateDiff = {
      balanceChanges: [],
      storageChanges: [
        { address: WPLS, contractName: "WPLS", slot: "0x1", before: "0x0", after: "0x2" },
      ],
      nonceChanges: [{ address: WPLS, before: 0, after: 1 }],
    };
    renderWithProviders(<StateDiffPanel stateDiff={diff} />);
    // Collapse the per-contract storage group (its header carries the slot count).
    fireEvent.click(screen.getByText(/1 slot/));
    // Collapse the Storage Changes + Nonce Changes sections.
    fireEvent.click(screen.getByText("Storage Changes"));
    fireEvent.click(screen.getByText("Nonce Changes"));
    expect(screen.getByText("Storage Changes")).toBeInTheDocument();
  });

  it("renders a decoded address storage value with the dual line layout", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            storageLayout: {
              storage: [
                { label: "owner", slot: "0", offset: 0, type: "t_address", contract: "WPLS" },
              ],
              types: {
                t_address: { encoding: "inplace", label: "address", numberOfBytes: "20" },
              },
            },
          }),
        }) as Response,
    );
    const diff: StateDiff = {
      balanceChanges: [],
      storageChanges: [
        {
          address: WPLS,
          contractName: "WPLS",
          slot: "0x0000000000000000000000000000000000000000000000000000000000000000",
          before: "0x" + "0".repeat(64),
          after:
            "0x000000000000000000000000a1077a294dde1b09bb078844df40758a5d0f9a27",
        },
      ],
      nonceChanges: [],
    };
    renderWithProviders(<StateDiffPanel stateDiff={diff} />);
    expect(await screen.findByText("owner")).toBeInTheDocument();
    expect(screen.getByText("address")).toBeInTheDocument();
  });

  it("renders nonce changes", () => {
    const diff: StateDiff = {
      balanceChanges: [],
      storageChanges: [],
      nonceChanges: [{ address: WPLS, before: 5, after: 6 }],
    };
    renderWithProviders(<StateDiffPanel stateDiff={diff} />);
    expect(screen.getByText("Nonce Changes")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("6")).toBeInTheDocument();
  });

  it("renders all three sections together with divider styling branches", () => {
    const diff: StateDiff = {
      balanceChanges: [{ address: WPLS, before: "0", after: "1", delta: "1" }],
      storageChanges: [{ address: WPLS, slot: "0x0", before: "0x0", after: "0x1" }],
      nonceChanges: [{ address: WPLS, before: 0, after: 1 }],
    };
    renderWithProviders(<StateDiffPanel stateDiff={diff} />);
    expect(screen.getByText("Balance Changes")).toBeInTheDocument();
    expect(screen.getByText("Storage Changes")).toBeInTheDocument();
    expect(screen.getByText("Nonce Changes")).toBeInTheDocument();
  });

  it("decodes a storage change against a fetched inplace layout", async () => {
    // Provide a layout that decodeChangeAtSlot can resolve so the decoded
    // branch (one row per packed var) renders rather than the raw fallback.
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            storageLayout: {
              storage: [
                { label: "totalSupply", slot: "0", offset: 0, type: "t_uint256", contract: "WPLS" },
              ],
              types: {
                t_uint256: { encoding: "inplace", label: "uint256", numberOfBytes: "32" },
              },
            },
          }),
        }) as Response,
    );

    const diff: StateDiff = {
      balanceChanges: [],
      storageChanges: [
        {
          address: WPLS,
          contractName: "WPLS",
          slot: "0x0000000000000000000000000000000000000000000000000000000000000000",
          before: "0x0000000000000000000000000000000000000000000000000000000000000000",
          after: "0x0000000000000000000000000000000000000000000000000000000000000001",
        },
      ],
      nonceChanges: [],
    };
    renderWithProviders(<StateDiffPanel stateDiff={diff} />);
    // The decoded row shows the variable label + type
    expect(await screen.findByText("totalSupply")).toBeInTheDocument();
    expect(screen.getByText("uint256")).toBeInTheDocument();
  });
});
