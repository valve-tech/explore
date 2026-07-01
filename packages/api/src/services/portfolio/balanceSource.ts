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
 * Targets the `current_balances` rollup VIEW (argMax over balance_changes) that
 * Hasura tracks — see monorepo deploy/indexer/sql/holdings_<chainId>_current_balances.sql.
 * Hasura/GDC may namespace the tracked root field per chain DB, so the root
 * field name is overridable via HOLDINGS_GRAPHQL_ROOT without a code change.
 * Columns are `contract` + `balance`; `$owner` is 0x-prefixed lowercase hex
 * (matching the balance_changes DDL); the view already filters balance > 0.
 */
export const HOLDINGS_GQL_ROOT = process.env.HOLDINGS_GRAPHQL_ROOT || "current_balances";
// NOTE: the variable type is the LOWERCASE gdc scalar `string!`, not GraphQL's
// `String!` — the Hasura ClickHouse GDC types its String columns as `string`, and
// declaring `String!` fails: "variable 'owner' is declared as 'String!', but used
// where 'string' is expected". Verified against the live 943 gateway 2026-06-30.
export const HOLDINGS_GQL_QUERY = buildHoldingsQuery(HOLDINGS_GQL_ROOT);

/**
 * The GraphQL root field for a chain's holdings. A per-chain override
 * (`HOLDINGS_GRAPHQL_ROOT_<chainId>`) wins — REQUIRED when one Hasura engine
 * tracks multiple chains' `current_balances` under distinct root fields to avoid
 * a field-name collision (e.g. 943 → `current_balances`, 369 →
 * `current_balances_369`). Falls back to the global `HOLDINGS_GRAPHQL_ROOT`, then
 * `current_balances`. So 943 works unchanged; 369 needs
 * `HOLDINGS_GRAPHQL_ROOT_369=current_balances_369`.
 */
export function holdingsRootFor(chainId: number): string {
  return (
    process.env[`HOLDINGS_GRAPHQL_ROOT_${chainId}`] ||
    process.env.HOLDINGS_GRAPHQL_ROOT ||
    "current_balances"
  );
}

/** Build the holdings query for a given root field. */
function buildHoldingsQuery(root: string): string {
  return `
  query Holdings($owner: string!) {
    ${root}(where: { owner: { _eq: $owner } }) {
      contract
      balance
    }
  }`.trim();
}

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
  opts: { secret?: string; fetchImpl?: typeof fetch; root?: string } = {},
): Promise<HeldBalance[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  // The root field to query (per-chain — see holdingsRootFor). Defaults to the
  // global root so existing single-chain callers are unaffected.
  const root = opts.root ?? HOLDINGS_GQL_ROOT;
  const headers: Record<string, string> = { "content-type": "application/json" };
  // Hasura-style admin secret; omitted when the gateway is open / uses another
  // auth handled at the network edge.
  if (opts.secret) headers["x-hasura-admin-secret"] = opts.secret;

  const res = await fetchImpl(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      query: buildHoldingsQuery(root),
      // `owner` is the archive key form — BARE lowercase hex (no 0x), verified
      // against the live balance_changes table. queryBalances supplies it.
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

  const rows = json.data?.[root];
  if (!Array.isArray(rows)) {
    throw new Error(
      `holdings gateway returned an unexpected shape (no '${root}' array)`,
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
 * The archive stores `owner`/`contract` as BARE lowercase hex (no 0x) — verified
 * directly against the live holdings_943.balance_changes table (the DDL's
 * "0x-prefixed" comment is wrong; every row is bare 40-char hex). So the filter
 * value is the bare holder — a 0x-prefixed value would match zero rows.
 */
export async function queryBalances(
  chainId: number,
  holderBare: string,
): Promise<HeldBalance[] | null> {
  const endpoint = getChain(chainId).holdingsGraphqlUrl;
  if (!endpoint) return null;
  return fetchHoldingsViaGraphql(endpoint, holderBare, {
    secret: process.env.HOLDINGS_GRAPHQL_SECRET,
    root: holdingsRootFor(chainId),
  });
}
