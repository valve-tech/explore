import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { Providers } from "./_test-utils";

/**
 * usePortfolioHoldings — TanStack Query over /api/portfolio/holdings. We mock
 * the api/portfolio data layer and assert the query keys on chainId + lowercased
 * address, passes through results, and honours the `enabled` gate.
 *
 * Fixture: WPLS on PulseChain 369 (decimals 18, symbol WPLS).
 *   https://scan.pulsechain.com/address/0xA1077a294dDE1B09bB078844df40758a5D0f9a27
 */

const fetchHoldings = vi.fn();
vi.mock("../api/portfolio", () => ({
  fetchHoldings: (...a: unknown[]) => fetchHoldings(...a),
}));

import { usePortfolioHoldings } from "../hooks/usePortfolioHoldings";

const ADDR = "0xAAAA000000000000000000000000000000000001";
const RESULT = {
  chainId: 369,
  address: ADDR.toLowerCase(),
  native: { symbol: "PLS", balance: "1000000000000000000" },
  holdings: [
    {
      tokenAddress: "0xA1077a294dDE1B09bB078844df40758a5D0f9a27",
      symbol: "WPLS",
      name: "Wrapped Pulse",
      decimals: 18,
      balance: "5456507558918974858760",
    },
  ],
  indexed: true,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("usePortfolioHoldings", () => {
  it("fetches holdings with lowercased address + chainId", async () => {
    fetchHoldings.mockResolvedValue(RESULT);
    const { result } = renderHook(() => usePortfolioHoldings(ADDR, 369), {
      wrapper: Providers,
    });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(fetchHoldings).toHaveBeenCalledWith(ADDR, 369);
    expect(result.current.data?.holdings[0]?.symbol).toBe("WPLS");
  });

  it("does not fetch when disabled", () => {
    fetchHoldings.mockResolvedValue(RESULT);
    const { result } = renderHook(() => usePortfolioHoldings(ADDR, 369, false), {
      wrapper: Providers,
    });
    expect(result.current.fetchStatus).toBe("idle");
    expect(fetchHoldings).not.toHaveBeenCalled();
  });
});
