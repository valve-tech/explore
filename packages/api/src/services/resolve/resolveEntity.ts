import type { Hash, PublicClient } from "viem";
import { getRpcClient } from "../chains/clients.js";
import { listChains } from "../chains/registry.js";
import { getChainPresence, hasPresence } from "../multichain/chainPresence.js";

/**
 * Cross-chain entity resolver — "where does this thing live?".
 *
 * A tx hash is chain-specific (the same 32-byte hash realistically exists on
 * exactly one chain), and an address is only *interesting* on the chains where
 * it has code or activity. The search UIs used to default a pasted hash to a
 * single chain, so a tx on another chain read as "not found". This service
 * fans a probe out over every registered chain and reports which one(s) the
 * entity actually exists on, so the caller can route with the right `chainid`.
 *
 * Only tx / address / block are chain-locatable. A 4byte selector is a global
 * lookup (no chain) and unknown input resolves to nothing.
 *
 * Deps are injected so the fan-out is unit-testable without any live RPC.
 */

export type ResolveKind = "tx" | "address" | "block" | "selector" | "unknown";

export interface ResolveMatch {
  chainId: number;
  /** address probes only: whether the address has deployed bytecode here. */
  isContract?: boolean;
}

export interface ResolveResult {
  kind: ResolveKind;
  query: string;
  matches: ResolveMatch[];
}

const HEX_TX = /^0x[0-9a-f]{64}$/;
const HEX_ADDR = /^0x[0-9a-f]{40}$/;
const HEX_SELECTOR = /^0x[0-9a-f]{8}$/;
const DIGITS = /^\d+$/;

/** Classify a normalized (trimmed, lowercased) query by shape. */
export function classify(raw: string): ResolveKind {
  const v = raw.trim().toLowerCase();
  if (HEX_TX.test(v)) return "tx";
  if (HEX_ADDR.test(v)) return "address";
  if (HEX_SELECTOR.test(v)) return "selector";
  if (DIGITS.test(v)) return "block";
  return "unknown";
}

export interface ResolveDeps {
  /** The chain ids to probe, ascending. */
  chainIds: () => number[];
  /** Per-chain viem client (throws on an unconfigured chain — caught below). */
  getClient: (chainId: number) => PublicClient;
  /** Per-chain probe budget; a slow/hung RPC must not stall the whole resolve. */
  timeoutMs: number;
}

const defaultDeps: ResolveDeps = {
  chainIds: () => listChains().map((c) => c.chainId),
  getClient: getRpcClient,
  timeoutMs: 7_000,
};

export async function resolveEntity(
  raw: string,
  deps: ResolveDeps = defaultDeps,
): Promise<ResolveResult> {
  const query = raw.trim().toLowerCase();
  const kind = classify(query);

  // Selectors + unrecognized input aren't chain-locatable — nothing to probe.
  if (kind === "selector" || kind === "unknown") {
    return { kind, query, matches: [] };
  }

  const probe =
    kind === "tx" ? probeTx : kind === "address" ? probeAddress : probeBlock;

  const settled = await Promise.all(
    deps.chainIds().map((chainId) =>
      // A per-chain probe failure (RPC unconfigured/down, tx-not-found, timeout)
      // means "not here", never a whole-request failure.
      withTimeout(probe(deps, chainId, query), deps.timeoutMs).catch(() => null),
    ),
  );

  const matches = settled
    .filter((m): m is ResolveMatch => m !== null)
    .sort((a, b) => a.chainId - b.chainId);
  return { kind, query, matches };
}

/** A tx exists on a chain iff that chain returns it by hash. */
async function probeTx(
  deps: ResolveDeps,
  chainId: number,
  hash: string,
): Promise<ResolveMatch | null> {
  const tx = await deps
    .getClient(chainId)
    .getTransaction({ hash: hash as Hash })
    .catch(() => null);
  return tx ? { chainId } : null;
}

/**
 * An address is valid on every EVM chain, so "existence" alone is useless.
 * Report it only where it has presence: deployed bytecode, a non-zero nonce, or
 * a non-zero balance.
 *
 * This delegates to the presence service rather than re-reading, so a search
 * and the address page it leads to share one probe and one cache instead of
 * paying twice. The behaviour is unchanged — the same three reads decide
 * presence — but the second caller is free.
 */
async function probeAddress(
  deps: ResolveDeps,
  chainId: number,
  addr: string,
): Promise<ResolveMatch | null> {
  const [presence] = await getChainPresence(addr, [chainId], {
    chainIds: deps.chainIds,
    getClient: deps.getClient,
    timeoutMs: deps.timeoutMs,
  });
  if (!presence || !hasPresence(presence)) return null;
  return { chainId, isContract: presence.isContract };
}

/** A block number "exists" on a chain once its head has reached that height. */
async function probeBlock(
  deps: ResolveDeps,
  chainId: number,
  digits: string,
): Promise<ResolveMatch | null> {
  const head = await deps
    .getClient(chainId)
    .getBlockNumber()
    .catch(() => null);
  return head !== null && head >= BigInt(digits) ? { chainId } : null;
}

/** Reject after `ms` unless the probe settles first. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("resolve probe timeout")), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
