import { createConfig, http } from "wagmi";
import { mainnet, pulsechain, pulsechainV4, sepolia } from "wagmi/chains";
import { injected } from "wagmi/connectors";
import { effectiveRpcUrl } from "./rpcDefaults";

/**
 * Wagmi configuration for Explore.
 *
 * Chains match the multichain launch set documented in
 * docs/superpowers/specs/2026-05-29-multichain-etherscan-labels-design.md
 * and the UI chain registry in lib/chains.ts: 1 (Ethereum),
 * 369 (PulseChain), 943 (PulseChain Testnet V4), 11155111 (Sepolia).
 * Sepolia was served by the app but missing here, so a wallet on it had no
 * transport at all.
 *
 * Connector strategy is `injected()` only for v0 — covers MetaMask, Rabby,
 * Frame, Brave Wallet, and any other EIP-1193 provider that injects into
 * `window.ethereum`. WalletConnect / Coinbase Wallet / mobile wallets can
 * be added later by appending to the `connectors` array — no other code
 * changes needed.
 *
 * Transports are HTTP-only (no WebSocket) because we use the wallet
 * exclusively for signing — never for reads. Explore's enriched reads go
 * through its own backend, not the connected wallet's provider, which keeps
 * the wallet's view of "what chain we're on" decoupled from Explore's chain
 * selector UI.
 *
 * Each transport is given an EXPLICIT url. A bare `http()` is not "no
 * endpoint" — viem falls back to the endpoint compiled into its chain
 * definition, which for Ethereum is `https://eth.merkle.io`, a third party
 * nobody here chose. Any wagmi read added later (a balance, a receipt wait)
 * would have started leaking the user's IP and query there, on a page that
 * promises the browser makes no direct node calls. `effectiveRpcUrl` returns
 * the user's own override when they have set one, and Valve's public archive
 * endpoint otherwise. See `rpcDefaults.ts`.
 *
 * Read ONCE at module load, like the backend-origin override — changing an
 * endpoint needs a reload to take effect, and the settings UI says so.
 */
export const wagmiConfig = createConfig({
  chains: [mainnet, pulsechain, pulsechainV4, sepolia],
  connectors: [injected()],
  transports: {
    [mainnet.id]: http(effectiveRpcUrl(mainnet.id)),
    [pulsechain.id]: http(effectiveRpcUrl(pulsechain.id)),
    [pulsechainV4.id]: http(effectiveRpcUrl(pulsechainV4.id)),
    [sepolia.id]: http(effectiveRpcUrl(sepolia.id)),
  },
  // SSR is off — Vite SPA renders entirely client-side. wagmi v2 still
  // requires the field; `false` is the no-op default.
  ssr: false,
});

/**
 * Re-export the wagmi config's inferred Register type so the rest of the
 * app can `declare module 'wagmi' { interface Register { config: typeof wagmiConfig } }`
 * for chain-id literal narrowing. See main.tsx where this is registered.
 */
export type WagmiConfig = typeof wagmiConfig;
