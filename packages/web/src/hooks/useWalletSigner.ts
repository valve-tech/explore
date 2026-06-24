import { useMemo } from "react";
import { useAccount, useWalletClient } from "wagmi";
import type { WalletClient } from "viem";

/**
 * Bridge between wagmi's React state and the viem `WalletClient` shape
 * consumed by `@valve-tech/wallet-crypto` and the SIWE sign-in (which signs
 * a `viem/siwe` message directly). Both take a `WalletClient` (with
 * `.account` + `.signMessage`) — wagmi's `useWalletClient` returns the same
 * type, this hook just keeps one calling shape across the app.
 *
 * Returns `null` when no wallet is connected. Callers MUST handle that
 * null path — there's no fallback signer.
 */
export function useWalletSigner(): {
  signer: WalletClient | null;
  address: `0x${string}` | undefined;
  isConnected: boolean;
} {
  const account = useAccount();
  const wallet = useWalletClient();

  return useMemo(
    () => ({
      signer: wallet.data ?? null,
      address: account.address,
      isConnected: account.isConnected,
    }),
    [wallet.data, account.address, account.isConnected],
  );
}
