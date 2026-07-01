import { erc20Abi, type Address } from "viem";
import { readCache, writeCache } from "../chifra/cache.js";
import { getChain } from "../chains/registry.js";
import { getRpcClient } from "../chains/clients.js";
import { queryBalances } from "./balanceSource.js";
import {
  mapHolding,
  sortHoldings,
  type HeldBalance,
  type Holding,
  type HoldingsResult,
  type NativeHolding,
  type TokenMeta,
} from "./transforms.js";

/**
 * Portfolio holdings: all tokens a wallet holds, no curation.
 *
 * HYBRID — the archive discovers WHICH tokens, the chain says HOW MUCH:
 *   1. DISCOVERY — the SET of tokens a holder has touched comes from the
 *      `balance_changes` archive (`argMax` rollup per `(contract, owner)`),
 *      populated by the monorepo's erc20-balance-changes substreams sink. Its
 *      `balance` is NOT trusted: the Transfer-anchored substream drops the
 *      ~3.3% of changes it can't tie to a Transfer (TYPE_UNKNOWN — incl. WETH
 *      deposit/withdraw), and those drops compound. If the archive isn't
 *      queryable for this chain yet, discovery is null → `indexed: false` and we
 *      still return the native balance.
 *   2. EXACT BALANCES — a bounded `balanceOf` multicall over just the discovered
 *      tokens (not all tokens) gives the authoritative current balance; zero /
 *      fully-exited positions are dropped. This corrects the archive's gaps.
 *   3. METADATA — decimals/symbol/name for the held tokens, read from the chain
 *      (immutable, so cacheable). Decoupled from balance.
 *
 * Native balance is a trivial RPC point query. Results are cached briefly per
 * (chainId, holder).
 */

/** Canonical Multicall3 — same address on every chain via the deterministic deployer. */
const MULTICALL3: Address = "0xcA11bde05977b3631167028862bE2a173976CA11";

/** Deps are injected so the service is unit-testable without a data source or RPC. */
export interface HoldingsDeps {
  /**
   * DISCOVERY ONLY: the set of tokens a holder has ever touched, from the
   * balance_changes archive. `null` when the archive isn't queryable for this
   * chain yet (not indexed); `[]` when it is but the holder has no positions.
   *
   * The archive's `balance` is NOT trusted as the current balance — the
   * Transfer-anchored erc20-balance-changes substream drops the ~3.3% of changes
   * it can't tie to a Transfer (TYPE_UNKNOWN), which notably includes WETH
   * deposit/withdraw (they emit Deposit/Withdrawal, not Transfer). Those drops
   * compound, so we use the archive only to learn WHICH tokens to read, then
   * read exact balances from chain via `readBalances`.
   */
  queryBalances: (chainId: number, holderBare: string) => Promise<HeldBalance[] | null>;
  /**
   * EXACT current balance per token, read from chain via a bounded `balanceOf`
   * multicall over the discovered tokens (not all tokens — only the handful a
   * holder has touched). Authoritative regardless of the archive's gaps. One
   * entry per token that answered; the caller drops zero/exited positions.
   */
  readBalances: (chainId: number, holder: string, tokens: string[]) => Promise<HeldBalance[]>;
  /**
   * Display metadata (decimals/symbol/name) for the held tokens, batched. One
   * entry per token that responded to `decimals`; tokens that don't are simply
   * absent (and dropped downstream when no curated override supplies decimals).
   * Balance does NOT come from here.
   */
  readMetadata: (chainId: number, tokens: string[]) => Promise<TokenMeta[]>;
  /** Native balance (wei) for a holder. */
  nativeBalance: (chainId: number, holder: string) => Promise<bigint>;
}

const defaultDeps: HoldingsDeps = {
  queryBalances,
  async readBalances(chainId, holder, tokens) {
    if (tokens.length === 0) return [];
    const client = getRpcClient(chainId);
    const holderAddr = `0x${holder.replace(/^0x/, "")}` as Address;
    const contracts = tokens.map((t) => ({
      address: `0x${t.replace(/^0x/, "")}` as Address,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [holderAddr],
    }) as const);

    const results = await client.multicall({
      contracts,
      allowFailure: true,
      multicallAddress: MULTICALL3,
    });

    const out: HeldBalance[] = [];
    tokens.forEach((token, i) => {
      const r = results[i];
      if (r?.status === "success") out.push({ token, balance: r.result as bigint });
    });
    return out;
  },
  async readMetadata(chainId, tokens) {
    if (tokens.length === 0) return [];
    const client = getRpcClient(chainId);
    const contracts = tokens.flatMap((t) => {
      const address = `0x${t.replace(/^0x/, "")}` as Address;
      return [
        { address, abi: erc20Abi, functionName: "decimals" } as const,
        { address, abi: erc20Abi, functionName: "symbol" } as const,
        { address, abi: erc20Abi, functionName: "name" } as const,
      ];
    });

    const results = await client.multicall({
      contracts,
      allowFailure: true,
      multicallAddress: MULTICALL3,
    });

    const metas: TokenMeta[] = [];
    tokens.forEach((token, i) => {
      const base = i * 3;
      const dec = results[base];
      const sym = results[base + 1];
      const nam = results[base + 2];
      // decimals is required to format; a token that can't answer it is dropped
      // (unless a curated override supplies decimals in mapHolding).
      if (dec?.status !== "success") return;
      metas.push({
        token,
        decimals: Number(dec.result),
        symbol: sym?.status === "success" ? String(sym.result) : "",
        name: nam?.status === "success" ? String(nam.result) : "",
      });
    });
    return metas;
  },
  async nativeBalance(chainId, holder) {
    return getRpcClient(chainId).getBalance({ address: holder as Address });
  },
};

export async function getHoldings(
  holder: string,
  chainId: number,
  deps: HoldingsDeps = defaultDeps,
): Promise<HoldingsResult> {
  const addr = holder.toLowerCase();
  const bare = addr.replace(/^0x/, "");

  const cacheKey = `holdings:${chainId}:${addr}`;
  const cached = readCache<HoldingsResult>(cacheKey);
  if (cached) return cached;

  // Touch the registry so an unsupported chain throws before any work.
  const { nativeSymbol } = getChain(chainId);

  // Stage 1 — DISCOVERY: which tokens has this holder ever touched? (archive)
  const discovered = await deps.queryBalances(chainId, bare);
  const indexed = discovered !== null;
  const discoveredTokens = [
    ...new Set((discovered ?? []).map((b) => bareHex(b.token))),
  ];

  // Stage 2 — EXACT BALANCES: read balanceOf on-chain for just those tokens.
  // The archive's own balances are NOT trusted (its Transfer-anchored source
  // drops ~3.3% of changes — incl. WETH wrap/unwrap — which compounds). A
  // bounded multicall over the discovered set is authoritative and corrects
  // stale-positive rows for tokens the holder has since fully exited.
  const balances =
    discoveredTokens.length > 0
      ? await deps.readBalances(chainId, addr, discoveredTokens)
      : [];
  const held = balances.filter((b) => b.balance > 0n);
  const metas = held.length > 0 ? await deps.readMetadata(chainId, held.map((b) => b.token)) : [];
  const metaByToken = new Map(metas.map((m) => [bareHex(m.token), m]));

  const holdings: Holding[] = sortHoldings(
    held
      .map((b) => mapHolding(b, metaByToken.get(bareHex(b.token)), chainId))
      .filter((h): h is Holding => h !== null),
  );

  const native = await resolveNative(deps, chainId, addr, nativeSymbol);

  const result: HoldingsResult = { chainId, address: addr, native, holdings, indexed };
  writeCache(cacheKey, result);
  return result;
}

/** Bare lowercase hex (no 0x) — the archive/metadata key form for joins. */
function bareHex(token: string): string {
  return token.toLowerCase().replace(/^0x/, "");
}

async function resolveNative(
  deps: HoldingsDeps,
  chainId: number,
  holder: string,
  symbol: string,
): Promise<NativeHolding> {
  let balance = "0";
  try {
    balance = (await deps.nativeBalance(chainId, holder)).toString();
    BigInt(balance); // validate it's an integer; the UI scales it (native = 18)
  } catch {
    // native is non-fatal, and a non-integer is unusable — degrade to zero
    balance = "0";
  }
  return { symbol, balance };
}
