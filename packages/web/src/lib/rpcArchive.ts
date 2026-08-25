/**
 * Does an RPC endpoint answer for anything other than `latest`?
 *
 * There is no dataset that can tell you this. `@valve-tech/rpc-collector`
 * carries chainlist's fields — url, protocol, tracking, isOpenSource — and
 * chainlist records nothing about pruning, so `collectRpcs` has no archive
 * option and `RpcEndpoint` has no archive field. Neither does the app. The
 * only way to know is to ask the node.
 *
 * Measured 2026-08-24 across chains 1 and 369: of the nine endpoints the
 * settings page suggested, Valve's was the only one that answered. Three
 * refused historical state, five refused the connection outright. A list
 * offered as "endpoints you can switch to" was offering endpoints that
 * cannot serve this app.
 *
 * WHY IT MATTERS HERE. The browser's own transport is not only used for
 * `latest` reads: `byoTransfers.ts` runs a windowed `eth_getLogs` and
 * `byoNetworkHealth.ts` walks a range of block headers. A node that answers
 * `eth_blockNumber` and nothing else passes a liveness check — which is all
 * `probeEndpoints` measures — and then fails both of those.
 *
 * NEVER CALL THIS ON RENDER. It opens a connection to a third party. It
 * belongs behind a button the user pressed.
 */

/** What an endpoint proved it can do. Not a claim, a measurement. */
export type ArchiveVerdict = "archive" | "recent-only" | "unreachable";

export interface ArchiveProbe {
  verdict: ArchiveVerdict;
  /** Short, human-readable reason. Rendered as-is, so keep it plain. */
  detail: string;
}

/** The label the settings UI shows for each verdict. */
export const VERDICT_LABEL: Record<ArchiveVerdict, string> = {
  archive: "serves history",
  "recent-only": "recent blocks only",
  unreachable: "no answer",
};

/**
 * Block 1 exists on every chain this app serves, and reading state there
 * needs the full history. A pruned node has the header but not the trie, so
 * it answers the same call with an error — which is the discrimination we
 * want. The zero address is used because it exists on every chain from
 * genesis; its balance is usually `0x0`, and any successful answer proves
 * the read, whatever the value.
 */
const ARCHIVE_PROBE_BODY = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "eth_getBalance",
  params: ["0x0000000000000000000000000000000000000000", "0x1"],
});

/** JSON-RPC codes that mean "slow down", not "no history". */
const RATE_LIMIT_CODES = new Set([-32005, 429]);

export async function probeArchive(
  url: string,
  timeoutMs = 8_000,
): Promise<ArchiveProbe> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: ARCHIVE_PROBE_BODY,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    // A browser cannot tell a CORS refusal from a dead host — both arrive as
    // a TypeError with no detail. Either way this endpoint is unusable from
    // a page, which is the answer the user needs.
    const name = err instanceof Error ? err.name : "";
    return {
      verdict: "unreachable",
      detail: name === "TimeoutError" ? "timed out" : "blocked or offline",
    };
  }

  if (!res.ok) {
    return { verdict: "unreachable", detail: `HTTP ${res.status}` };
  }

  let body: { result?: unknown; error?: { code?: number; message?: string } };
  try {
    body = (await res.json()) as typeof body;
  } catch {
    return { verdict: "unreachable", detail: "not JSON-RPC" };
  }

  if (body.error) {
    const { code, message } = body.error;
    if (code != null && RATE_LIMIT_CODES.has(code)) {
      return { verdict: "unreachable", detail: "rate limited" };
    }
    return { verdict: "recent-only", detail: trim(message) };
  }

  if (typeof body.result === "string") {
    return { verdict: "archive", detail: "read state at block 1" };
  }
  return { verdict: "unreachable", detail: "no result" };
}

/** Provider error text runs long and is written for logs, not for a chip. */
function trim(message: string | undefined): string {
  const clean = (message ?? "no history").trim();
  return clean.length > 64 ? `${clean.slice(0, 63)}…` : clean;
}
