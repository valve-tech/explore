#!/usr/bin/env node
/**
 * Re-checks every endpoint in src/lib/rpcCurated.json. An endpoint passes when
 * it answers with the right chain id, sits within 20 blocks of the best head
 * seen for its chain, and allows browser requests (CORS) from Explore's origin.
 * It also reports whether the endpoint serves history (state at block 1).
 * Exits 1 when any endpoint fails. Drop or replace that endpoint, then update
 * "checked" in the JSON.
 */
import { readFileSync } from "node:fs";

const list = JSON.parse(readFileSync(new URL("../src/lib/rpcCurated.json", import.meta.url), "utf8"));
const ORIGIN = "https://explore.valve.city";
const MAX_LAG = 20;

async function call(url, init) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 8000);
  try {
    return await fetch(url, { ...init, signal: ac.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function rpc(url, method, params = []) {
  const res = await call(url, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res) return { error: "no answer" };
  const acao = res.headers.get("access-control-allow-origin");
  try {
    const body = await res.json();
    return { result: body.result, error: body.error?.message, acao };
  } catch {
    return { error: `HTTP ${res.status}`, acao };
  }
}

async function corsAllowed(url) {
  const res = await call(url, {
    method: "OPTIONS",
    headers: { origin: ORIGIN, "access-control-request-method": "POST", "access-control-request-headers": "content-type" },
  });
  const acao = res?.headers.get("access-control-allow-origin");
  return acao === "*" || acao === ORIGIN;
}

let failed = 0;
async function probe(url, chain) {
  const [id, head, cors, old] = await Promise.all([
    rpc(url, "eth_chainId"),
    rpc(url, "eth_blockNumber"),
    corsAllowed(url),
    rpc(url, "eth_getBalance", ["0x0000000000000000000000000000000000000000", "0x1"]),
  ]);
  return {
    url,
    chainOk: id.result !== undefined && Number(id.result) === Number(chain),
    block: head.result ? Number(head.result) : null,
    cors: cors && Boolean(head.acao),
    archive: old.result !== undefined,
    error: head.error ?? id.error,
  };
}

/** One retry: a single dropped request is not a dead endpoint. */
async function probeTwice(url, chain) {
  const first = await probe(url, chain);
  return first.chainOk && first.block !== null && first.cors ? first : probe(url, chain);
}

for (const [chain, urls] of Object.entries(list.endpoints)) {
  const rows = await Promise.all(urls.map((url) => probeTwice(url, chain)));
  const best = Math.max(0, ...rows.map((r) => r.block ?? 0));
  console.log(`chain ${chain} (head ${best})`);
  for (const r of rows) {
    const lag = r.block === null ? null : best - r.block;
    const ok = r.chainOk && lag !== null && lag <= MAX_LAG && r.cors;
    if (!ok) failed++;
    const why = ok ? "" : ` [${!r.chainOk ? "wrong chain or no answer" : lag === null || lag > MAX_LAG ? `lag ${lag}` : "no CORS"}${r.error ? ": " + r.error : ""}]`;
    console.log(`  ${ok ? "PASS" : "FAIL"} ${r.archive ? "history" : "recent "} ${r.url}${why}`);
  }
}
console.log(failed ? `${failed} endpoint(s) failed.` : `All endpoints pass. Last recorded check: ${list.checked}.`);
process.exit(failed ? 1 : 0);
