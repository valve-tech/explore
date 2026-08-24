import { type Chain } from "viem";

/**
 * Per-chain configuration. The valve launch set lives in `defaults.ts`; a
 * self-hoster can replace it entirely via `CHAINS_JSON` / `CHAINS_CONFIG_PATH`
 * (see `loadConfig.ts`). `registry.ts` is the public face — import the type and
 * the lookups from there.
 */
export interface ChainConfig {
  chainId: number;
  name: string;
  shortName: string;
  nativeSymbol: string;
  nativeDecimals: 18;

  /** TrueBlocks daemon chain slug — passed as `chain=` to the SDK. */
  chifraChain: string;

  rpcUrl: string;
  /** debug_traceTransaction-capable node, when distinct from rpcUrl. */
  debugRpcUrl?: string;
  /** Public Reth snapshot, when one exists for this chain. */
  rethSnapshotUrl?: string;
  /**
   * Substreams (firehose) gRPC endpoint. The planned long-term data layer for
   * holdings + XYK prices. Optional — a self-hoster without substreams omits it.
   */
  substreamsEndpoint?: string;
  /**
   * GraphQL "subset" gateway (Hasura-style) fronting the `balance_changes`
   * archive in ClickHouse — the read source for portfolio holdings. trace POSTs
   * a per-holder query; the gateway enforces the filter + limits and trace never
   * holds DB creds. Optional — unset means holdings aren't indexed for this
   * chain yet, so `getHoldings` degrades to native-only (`indexed: false`).
   */
  holdingsGraphqlUrl?: string;

  /** Blockscout API base; omitted when we don't run/point at one. */
  blockscoutBase?: string;
  sourcifyEnabled: boolean;

  viemChain: Chain;

  /** CAIP-2 identity, mirrored by the web registry's ChainInfo.caip2. */
  caip2: { namespace: string; reference: string };

  /**
   * True when the chain burns the EIP-1559 base fee (validator earns only the
   * tip). Drives the "validator revenue per gas" axis in the network-health
   * analysis: revenue = effectiveGasPrice − baseFee when burning, else the full
   * effectiveGasPrice. Optional — defaults to `true` (standard 1559) when a
   * self-hoster's CHAINS_JSON omits it, since burn is the common case.
   */
  burnsBaseFee?: boolean;

  /** URL path prefix once chainid routing lands on the web side. */
  explorerSlug: string;
  defaultBlockTimeSeconds: number;
  testnet: boolean;
}
