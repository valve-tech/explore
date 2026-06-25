import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";

/**
 * useWalletSigner — adapts wagmi's useAccount/useWalletClient into the single
 * { signer, address, isConnected } shape the SIWE + crypto layers consume. We
 * mock wagmi and assert the connected/disconnected projections.
 */

const useAccount = vi.fn();
const useWalletClient = vi.fn();

vi.mock("wagmi", () => ({
  useAccount: () => useAccount(),
  useWalletClient: () => useWalletClient(),
}));

import { useWalletSigner } from "../hooks/useWalletSigner";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useWalletSigner", () => {
  it("returns the wallet client as signer when connected", () => {
    const fakeSigner = { account: { address: "0xWALLET" } };
    useAccount.mockReturnValue({
      address: "0x1111111111111111111111111111111111111111",
      isConnected: true,
    });
    useWalletClient.mockReturnValue({ data: fakeSigner });

    const { result } = renderHook(() => useWalletSigner());
    expect(result.current.signer).toBe(fakeSigner);
    expect(result.current.address).toBe(
      "0x1111111111111111111111111111111111111111",
    );
    expect(result.current.isConnected).toBe(true);
  });

  it("returns null signer when no wallet is connected", () => {
    useAccount.mockReturnValue({ address: undefined, isConnected: false });
    useWalletClient.mockReturnValue({ data: undefined });

    const { result } = renderHook(() => useWalletSigner());
    expect(result.current.signer).toBeNull();
    expect(result.current.address).toBeUndefined();
    expect(result.current.isConnected).toBe(false);
  });
});
