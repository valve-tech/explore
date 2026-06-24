/**
 * UI-side chain registry for Explore. Mirrors the launch set documented
 * in docs/superpowers/specs/2026-05-29-multichain-etherscan-labels-design.md:
 * chains 1 (Ethereum), 369 (PulseChain), 943 (PulseChain Testnet).
 *
 * Today this drives presentational pieces (the chain picker, badges,
 * stats labels). When the backend dispatcher lands `?chainid=N` routing,
 * `chainSlug` flows into the API client and individual route paths.
 *
 * Chain logos come from gib.show (https://gib.show/image/<chainId> — the
 * same service TokenImage uses for token art). One source of truth so a
 * new chain needs only an entry here plus a backend handler.
 */

export interface ChainInfo {
  /** EIP-155 numeric chain id. The canonical key everywhere. */
  id: number;
  /** Short label shown in pills / picker rows. */
  name: string;
  /** URL-safe slug for route prefixes (when chainid routing lands). */
  slug: string;
  /** Native asset ticker shown alongside values. */
  symbol: string;
  /** True when the chain is a testnet — UI dims testnets in pickers. */
  testnet: boolean;
  /**
   * True when the chain burns the EIP-1559 base fee (so validator revenue per
   * gas is the tip). Mirrors the backend's per-chain ChainConfig.burnsBaseFee;
   * used by the BYO-RPC network-health path, which computes locally and has no
   * backend response to read the flag from. Defaults true (see
   * `chainBurnsBaseFee`) for any chain that omits it.
   */
  burnsBaseFee?: boolean;
}

export const CHAINS: ChainInfo[] = [
  { id: 1, name: "Ethereum", slug: "ethereum", symbol: "ETH", testnet: false, burnsBaseFee: true },
  { id: 369, name: "PulseChain", slug: "pulsechain", symbol: "PLS", testnet: false, burnsBaseFee: true },
  {
    id: 943,
    name: "PulseChain Testnet v4",
    slug: "pulsechain-testnet",
    symbol: "v4PLS",
    testnet: true,
    burnsBaseFee: true,
  },
];

/** Lookup by numeric chain id, or undefined if not registered. */
export function chainById(id: number): ChainInfo | undefined {
  return CHAINS.find((c) => c.id === id);
}

/**
 * The native-asset ticker for a chain, falling back to the default chain's
 * symbol for unregistered ids (matches the API's default-chain fallback).
 */
export function chainSymbol(id: number): string {
  return chainById(id)?.symbol ?? chainById(DEFAULT_CHAIN_ID)?.symbol ?? "PLS";
}

/**
 * Whether a chain burns the EIP-1559 base fee — defaults true (matching the
 * backend's `burnsBaseFee ?? true`) for unregistered ids or entries that omit
 * the flag. Drives the BYO-RPC network-health computation.
 */
export function chainBurnsBaseFee(id: number): boolean {
  return chainById(id)?.burnsBaseFee ?? true;
}

/**
 * Logo URL for a chain via gib.show. The service serves chain logos at
 * `/image/<chainId>` (and token art at `/image/<chainId>/<address>`); we
 * wrap that here so call sites don't need to know the URL scheme.
 */
export function chainLogoUrl(chainId: number): string {
  return `https://gib.show/image/${chainId}`;
}

/**
 * The sentinel value that means "search across every registered chain"
 * in the chain picker. Distinct from any real numeric chain id.
 */
export const ALL_CHAINS = -1;
export type ChainSelection = number | typeof ALL_CHAINS;

/**
 * Default chain when none is specified in the URL — PulseChain mainnet, the
 * live data source until the backend `?chainid=N` dispatcher lands. The API
 * layer omits `chainid` for this id so default requests stay byte-identical.
 */
export const DEFAULT_CHAIN_ID = 369;
