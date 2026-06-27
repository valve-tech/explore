import type { HeldBalance } from "./transforms.js";
import { getChain } from "../chains/registry.js";

/**
 * The read-time holdings source: current balances per token for a holder, from
 * the `erc20-balance-changes` archive (storage-diff truth) that the monorepo's
 * substreams sink populates into ClickHouse. trace is a *client* here — it
 * queries the final dataset; it does not build, aggregate, or deploy it.
 *
 * THE CONTRACT (per monorepo handoff
 * `docs/superpowers/specs/2026-06-04-erc20-balance-changes-holdings-handoff.md`):
 * the latest storage-diff balance per `(contract, owner)`, positive only —
 *
 *   SELECT contract, argMax(new_balance, (block_num, call_index)) AS bal
 *   FROM balance_changes
 *   WHERE owner = :holder
 *   GROUP BY contract
 *   HAVING bal > 0
 *
 * `contract`/`owner` are bare lowercase hex (no 0x), matching the substreams key
 * form. The result maps 1:1 to `HeldBalance[]` (token = contract, balance = bal).
 *
 * TRANSPORT: a GraphQL "subset" gateway (Hasura-style) fronts ClickHouse — trace
 * never holds DB creds; the gateway runs the argMax view and enforces the
 * per-holder filter. The per-chain gateway URL comes from the registry
 * (`holdingsGraphqlUrl`, set via `HOLDINGS_GRAPHQL_URL[_<chainId>]`). When a
 * chain has no gateway configured this returns `null` ("not indexed"), so
 * `getHoldings` degrades to native-only (`indexed: false`).
 */

/** The canonical archive query, as documentation of the gateway's view. */
export const BALANCE_CHANGES_QUERY = `
  SELECT contract, argMax(new_balance, (block_num, call_index)) AS bal
  FROM balance_changes
  WHERE owner = :holder
  GROUP BY contract
  HAVING bal > 0
`.trim();

/**
 * The GraphQL query sent to the gateway. It reads a Hasura-tracked view that
 * already collapses `balance_changes` to the current positive balance per
 * `(owner, contract)` (Hasura can't express `argMax` itself — the view does it).
 *
 * ⚠️ The root field (`erc20_balances`) and column names (`contract`, `balance`)
 * MUST MATCH the deployed gateway metadata. If the monorepo tracks the view
 * under different names, change them here (and only here). `$owner` is bare
 * lowercase hex (no 0x); the gateway filters by it and `balance > 0`.
 */
export const HOLDINGS_GQL_ROOT = "erc20_balances";
export const HOLDINGS_GQL_QUERY = `
  query Holdings($owner: String!) {
    ${HOLDINGS_GQL_ROOT}(where: { owner: { _eq: $owner }, balance: { _gt: "0" } }) {
      contract
      balance
    }
  }
`.trim();

/** Bare lowercase hex (no 0x) — the archive/metadata key form. */
function bareHex(hex: string): string {
  return hex.toLowerCase().replace(/^0x/, "");
}

interface GraphqlResponse {
  data?: Record<string, Array<{ contract?: unknown; balance?: unknown }>>;
  errors?: Array<{ message?: string }>;
}

/**
 * POST the holdings query to a GraphQL gateway and map the rows to
 * `HeldBalance[]`. Throws on a transport error, a non-2xx status, GraphQL
 * `errors`, or an unexpected response shape — a configured-but-failing gateway
 * must surface, not masquerade as "not indexed" (that signal is reserved for an
 * *absent* gateway, handled by `queryBalances`).
 *
 * `endpoint` and `fetchImpl` are explicit so this is unit-testable without the
 * registry or a live gateway.
 */
export async function fetchHoldingsViaGraphql(
  endpoint: string,
  owner: string,
  opts: { secret?: string; fetchImpl?: typeof fetch } = {},
): Promise<HeldBalance[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const headers: Record<string, string> = { "content-type": "application/json" };
  // Hasura-style admin secret; omitted when the gateway is open / uses another
  // auth handled at the network edge.
  if (opts.secret) headers["x-hasura-admin-secret"] = opts.secret;

  const res = await fetchImpl(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      query: HOLDINGS_GQL_QUERY,
      // `owner` is the archive key form — 0x-prefixed lowercase hex, per the
      // holdings_<chainId>.balance_changes DDL (NOT bare hex). queryBalances
      // supplies it pre-formatted.
      variables: { owner },
    }),
  });

  if (!res.ok) {
    throw new Error(`holdings gateway responded ${res.status} ${res.statusText}`);
  }

  const json = (await res.json()) as GraphqlResponse;
  if (json.errors && json.errors.length > 0) {
    throw new Error(
      `holdings gateway GraphQL error: ${json.errors.map((e) => e.message ?? "?").join("; ")}`,
    );
  }

  const rows = json.data?.[HOLDINGS_GQL_ROOT];
  if (!Array.isArray(rows)) {
    throw new Error(
      `holdings gateway returned an unexpected shape (no '${HOLDINGS_GQL_ROOT}' array)`,
    );
  }

  const held: HeldBalance[] = [];
  for (const row of rows) {
    if (row.contract == null || row.balance == null) continue;
    const balance = BigInt(String(row.balance));
    if (balance <= 0n) continue; // defensive — the view already filters > 0
    held.push({ token: bareHex(String(row.contract)), balance });
  }
  return held;
}

/**
 * Query held balances for `holderBare` (bare lowercase hex, no 0x) on `chainId`.
 * Returns `null` when no gateway is configured for the chain (→ not indexed),
 * `[]` when configured but the holder has no positive balances.
 *
 * The archive stores `owner` as 0x-prefixed lowercase hex (per the
 * holdings_<chainId>.balance_changes DDL), so we re-add the prefix the caller
 * stripped before filtering — a bare value would match zero rows.
 */
export async function queryBalances(
  chainId: number,
  holderBare: string,
): Promise<HeldBalance[] | null> {
  const endpoint = getChain(chainId).holdingsGraphqlUrl;
  if (!endpoint) return null;
  return fetchHoldingsViaGraphql(endpoint, `0x${holderBare}`, {
    secret: process.env.HOLDINGS_GRAPHQL_SECRET,
  });
}
