/**
 * UI-side chain registry for Explore. Mirrors the backend registry
 * (packages/api/src/services/chains/defaults.ts), which is authoritative:
 * chains 1 (Ethereum), 369 (PulseChain), 943 (PulseChain Testnet), 11155111
 * (Sepolia). The original launch set is documented in
 * docs/superpowers/specs/2026-05-29-multichain-etherscan-labels-design.md;
 * Sepolia joined once rpc.valve.city began serving it.
 *
 * Today this drives presentational pieces (the chain picker, badges,
 * stats labels). When the backend dispatcher lands `?chainid=N` routing,
 * `chainSlug` flows into the API client and individual route paths.
 *
 * Chain logos come from gib.show (https://gib.show/image/<chainId> — the
 * same service TokenImage uses for token art). One source of truth so a
 * new chain needs only an entry here plus a backend handler.
 */

/**
 * The two halves of a CAIP-2 chain id, kept as separate fields because the URL
 * scheme writes them as separate path segments (/eip155/369/…). The colon form
 * is deliberately unused: docs/GIB_SHOW.md records /image/eip155:369 returning
 * 404 where the dash form returns 200, so the colon does not survive real
 * infrastructure.
 */
export interface Caip2 {
  namespace: string;
  reference: string;
}

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
  /** CAIP-2 identity. Drives the /{namespace}/{reference}/… route prefix. */
  caip2: Caip2;
}

export const CHAINS: ChainInfo[] = [
  {
    id: 1,
    name: "Ethereum",
    slug: "ethereum",
    symbol: "ETH",
    testnet: false,
    burnsBaseFee: true,
    caip2: { namespace: "eip155", reference: "1" },
  },
  {
    id: 369,
    name: "PulseChain",
    slug: "pulsechain",
    symbol: "PLS",
    testnet: false,
    burnsBaseFee: true,
    caip2: { namespace: "eip155", reference: "369" },
  },
  {
    id: 943,
    name: "PulseChain Testnet v4",
    slug: "pulsechain-testnet",
    symbol: "v4PLS",
    testnet: true,
    burnsBaseFee: true,
    caip2: { namespace: "eip155", reference: "943" },
  },
  {
    id: 11155111,
    name: "Sepolia",
    slug: "sepolia",
    symbol: "ETH",
    testnet: true,
    burnsBaseFee: true,
    caip2: { namespace: "eip155", reference: "11155111" },
  },
];

/** Lookup by numeric chain id, or undefined if not registered. */
export function chainById(id: number): ChainInfo | undefined {
  return CHAINS.find((c) => c.id === id);
}

/** The CAIP-2 pair for a registered chain, or undefined if we do not serve it. */
export function chainCaip2(id: number): Caip2 | undefined {
  return chainById(id)?.caip2;
}

/**
 * The chain id for a CAIP-2 pair, or undefined for a namespace we do not serve
 * and for any id outside the registry. The namespace match is case-insensitive
 * because URLs get typed by hand; the reference is compared exactly, so a
 * colon-form string never matches.
 */
export function caip2ToChainId(namespace: string, reference: string): number | undefined {
  const ns = namespace.toLowerCase();
  return CHAINS.find((c) => c.caip2.namespace === ns && c.caip2.reference === reference)?.id;
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
