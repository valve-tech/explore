import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "./_test-utils";
import { PortfolioPanel } from "../components/workspace/PortfolioPanel";
import type { Workspace } from "../lib/workspace/types";
import type { HoldingsResult } from "../api/portfolio";

/**
 * Supplemental PortfolioPanel test for the `safeBig` catch path — a malformed
 * (non-numeric) on-chain balance must degrade to 0 rather than throw, so one
 * bad row never blanks the whole rollup. The existing PortfolioPanel.test.tsx
 * covers the happy aggregation; this isolates the defensive branch.
 *
 * Real on-chain fixture (chain 369):
 *   WPLS https://scan.pulsechain.com/address/0xa1077a294dde1b09bb078844df40758a5d0f9a27
 */

const WPLS = "0xa1077a294dde1b09bb078844df40758a5d0f9a27";
const A1 = "0x1111111111111111111111111111111111111111";

function workspace(): Workspace {
  return {
    id: "w1",
    name: "bags",
    createdAt: 1,
    updatedAt: 1,
    items: [{ id: "i0", kind: "address", value: A1, chainId: 369, addedAt: 1 }],
  };
}

function stubHoldings(result: HoldingsResult) {
  vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ ok: true, result }),
    text: async () => JSON.stringify({ ok: true, result }),
  } as Response);
}

beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.restoreAllMocks());

describe("<PortfolioPanel /> (safeBig)", () => {
  it("treats a malformed token balance as zero instead of throwing", async () => {
    stubHoldings({
      chainId: 369,
      address: A1,
      native: { symbol: "PLS", balance: "1000000000000000000" }, // valid native
      // Malformed token balance → safeBig catch → aggregated as 0n (bigint),
      // which formatTokenAmount renders without throwing.
      holdings: [
        { tokenAddress: WPLS, symbol: "WPLS", name: "Wrapped Pulse", decimals: 18, balance: "garbage" },
      ],
      indexed: true,
    });

    renderWithProviders(<PortfolioPanel workspace={workspace()} />);
    // The row still renders (no crash); the malformed amount scales to 0.
    await waitFor(() => expect(screen.getByText("WPLS")).toBeInTheDocument());
  });
});
