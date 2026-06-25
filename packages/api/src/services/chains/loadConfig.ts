import { readFileSync } from "node:fs";
import { defineChain } from "viem";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { type ChainConfig } from "./types.js";
import { VALVE_DEFAULT_CHAINS } from "./defaults.js";

/**
 * Self-hosting: build the chain registry from a user-supplied config so an
 * operator can run Explore for ANY EVM chain — not just the valve launch set —
 * without editing code or rebuilding.
 *
 * The config is YAML **or** JSON (JSON is valid YAML, so one parser accepts
 * both). YAML is the friendlier authoring format for non-developers; a
 * `chains.yml` file is the recommended path.
 *
 * Sources (checked in order; first wins):
 *   - `CHAINS_JSON`         — the config inline (YAML or JSON string).
 *   - `CHAINS_CONFIG_PATH`  — a path to a `chains.yml` / `.json` file.
 *   - neither               — the built-in valve set (1/369/943) is used, so
 *                             the hosted deployment is unchanged.
 *
 * When a config is present it REPLACES the default set entirely (the operator
 * declares exactly the chains their instance serves). Only `rpcUrl` is required
 * per chain; everything else has a sensible default and viem `Chain` objects are
 * synthesized for ids viem doesn't ship.
 */

/** The user-facing config shape — a thin, friendly subset of ChainConfig. */
const ChainInputSchema = z
  .object({
    chainId: z.number().int().positive(),
    name: z.string().min(1),
    rpcUrl: z.string().url(),
    shortName: z.string().min(1).optional(),
    nativeSymbol: z.string().min(1).default("ETH"),
    debugRpcUrl: z.string().url().optional(),
    blockscoutBase: z.string().url().optional(),
    sourcifyEnabled: z.boolean().default(true),
    /** TrueBlocks daemon slug; defaults to a slug of the name when omitted. */
    chifraChain: z.string().min(1).optional(),
    rethSnapshotUrl: z.string().url().optional(),
    substreamsEndpoint: z.string().min(1).optional(),
    holdingsGraphqlUrl: z.string().url().optional(),
    explorerSlug: z.string().min(1).optional(),
    defaultBlockTimeSeconds: z.number().int().positive().default(12),
    testnet: z.boolean().default(false),
    /** Marks the chain a request falls back to when `?chainid` is omitted. */
    default: z.boolean().optional(),
  })
  .strict();

export type ChainInput = z.infer<typeof ChainInputSchema>;

const ChainsConfigSchema = z.array(ChainInputSchema).min(1);

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Build a full ChainConfig from a user input, synthesizing the viem chain. */
export function buildChainConfig(input: ChainInput): ChainConfig {
  const viemChain = defineChain({
    id: input.chainId,
    name: input.name,
    nativeCurrency: {
      name: input.nativeSymbol,
      symbol: input.nativeSymbol,
      decimals: 18,
    },
    rpcUrls: { default: { http: [input.rpcUrl] } },
    testnet: input.testnet,
  });

  return {
    chainId: input.chainId,
    name: input.name,
    shortName: input.shortName ?? slugify(input.name),
    nativeSymbol: input.nativeSymbol,
    nativeDecimals: 18,
    chifraChain: input.chifraChain ?? slugify(input.name),
    rpcUrl: input.rpcUrl,
    debugRpcUrl: input.debugRpcUrl,
    rethSnapshotUrl: input.rethSnapshotUrl,
    substreamsEndpoint: input.substreamsEndpoint,
    holdingsGraphqlUrl: input.holdingsGraphqlUrl,
    blockscoutBase: input.blockscoutBase,
    sourcifyEnabled: input.sourcifyEnabled,
    viemChain,
    explorerSlug: input.explorerSlug ?? slugify(input.name),
    defaultBlockTimeSeconds: input.defaultBlockTimeSeconds,
    testnet: input.testnet,
  };
}

export interface LoadedChains {
  chains: Record<number, ChainConfig>;
  defaultChainId: number;
}

/**
 * Parse + validate a chains JSON string into ChainConfigs. Throws with a
 * readable message (not a raw ZodError) on any problem — a self-hoster sees
 * exactly what's wrong at startup rather than a stack trace.
 */
export function parseChainsConfig(text: string): {
  chains: ChainConfig[];
  flaggedDefault?: number;
} {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (err) {
    throw new Error(
      `CHAINS config is not valid YAML/JSON: ${(err as Error).message}`,
    );
  }

  const parsed = ChainsConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first?.path.length ? ` at ${first.path.join(".")}` : "";
    throw new Error(`CHAINS config invalid${where}: ${first?.message}`);
  }

  const inputs = parsed.data;
  const seen = new Set<number>();
  for (const i of inputs) {
    if (seen.has(i.chainId)) {
      throw new Error(`Duplicate chainId in CHAINS config: ${i.chainId}`);
    }
    seen.add(i.chainId);
  }

  const flagged = inputs.filter((i) => i.default);
  if (flagged.length > 1) {
    throw new Error("CHAINS config: only one chain may set \"default\": true");
  }

  return {
    chains: inputs.map(buildChainConfig),
    flaggedDefault: flagged[0]?.chainId,
  };
}

/**
 * Resolve the default chain id:
 *   1. `DEFAULT_CHAIN_ID` env (if it names a configured chain)
 *   2. a chain flagged `"default": true` in the config
 *   3. 369 if present (valve's historical default)
 *   4. the lowest configured chain id
 */
function resolveDefaultChainId(
  chains: Record<number, ChainConfig>,
  flagged: number | undefined,
): number {
  const envRaw = process.env.DEFAULT_CHAIN_ID;
  const env = envRaw ? Number(envRaw) : undefined;
  if (env && chains[env]) return env;
  if (flagged && chains[flagged]) return flagged;
  if (chains[369]) return 369;
  return Math.min(...Object.keys(chains).map(Number));
}

/** Load the chain registry from env, or fall back to the valve default set. */
export function loadChains(): LoadedChains {
  const inline = process.env.CHAINS_JSON;
  const path = process.env.CHAINS_CONFIG_PATH;

  let text: string | undefined;
  if (inline && inline.trim()) {
    text = inline;
  } else if (path && path.trim()) {
    try {
      text = readFileSync(path, "utf8");
    } catch (err) {
      throw new Error(
        `CHAINS_CONFIG_PATH could not be read (${path}): ${(err as Error).message}`,
      );
    }
  }

  if (!text) {
    return {
      chains: VALVE_DEFAULT_CHAINS,
      defaultChainId: resolveDefaultChainId(VALVE_DEFAULT_CHAINS, undefined),
    };
  }

  const { chains, flaggedDefault } = parseChainsConfig(text);
  const record: Record<number, ChainConfig> = {};
  for (const c of chains) record[c.chainId] = c;
  return {
    chains: record,
    defaultChainId: resolveDefaultChainId(record, flaggedDefault),
  };
}
