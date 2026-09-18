# Cutover: swap the admin RPC key for scoped `no-writes` keys

**Status: staged, not executed.** Waiting on valve to mint the keys (their
owner's approval, and their 1Password write path) and on the user to approve the
production cutover.

## Why

One over-privileged admin key (`vk_Et-…`, 35 chars) sits in every component's
RPC URL and **cannot be rotated** — too many apps hold it. It caused every key
exposure in the 2026-09-16 incident (see `docs/incidents/2026-09-16-empty-block-502.md`
and `progress.txt`). Giving the indexer and the explorer their own **`no-writes`**
keys removes the transaction-sending capability from the credential that keeps
leaking, so a future leak is a non-event rather than an incident.

`no-writes` is deny-only (eight `-` rules: `eth_sendRawTransaction`,
`eth_sendTransaction`, `eth_sign`, `eth_signTransaction`, `eth_submitHashrate`,
`eth_submitWork`, `personal_*`, `miner_*`). Every read method keeps working,
including ones nobody enumerated. **Do NOT ask for a tight allowlist** — the
relay's `isMethodAllowed` turns any non-empty allow list into an *exhaustive*
one, so a single `+method` silently refuses everything unlisted (measured: the
`read-only` preset refuses `ots_*` and `trace_*`, and explore is an Otterscan
surface).

Chain scope: `enabledNetworks` = **1, 369, 943, 11155111**, the complete set
from `packages/api/src/services/chains/defaults.ts`. A fifth chain later is a
deliberate edit to that registry AND the key together. Chain scope began
enforcing on HTTP (not just WebSocket) on 2026-09-16, so this scope now bites.

## What changes

Two keys, each `no-writes`, four chains.

| Component | Where the key lives | Variables |
|---|---|---|
| Indexer scraper | `/valve/docker` env on the indexer box | `INDEXER_RPC_KEY` (in the rendered `rpc-proxy.Caddyfile`) |
| Explorer API | `.env` in this repo, on the API host | `PULSECHAIN_RPC_URL`, `ETH_RPC_URL`, `DEBUG_RPC_URL` |

The explorer derives `PULSECHAIN_V4_RPC_URL` and `SEPOLIA_RPC_URL` from
`PULSECHAIN_RPC_URL` via `valveRpcUrl`, so only the three named URLs change; the
key inside each is swapped, the host and path shape stay.

## Cutover steps

1. Receive from valve, per key: the `op://` item path, six characters + a length.
   **Never the raw value, never in a chat channel.**
2. Read each into a variable at cutover time, never echo it:
   `KEY=$(op read "op://<vault>/<item>/<field>")`.
3. **Explorer:** rewrite the three `*_RPC_URL` values with the new key in the
   path, keeping host and `/v1/<key>/evm/<n>` shape. Restart the API. Confirm
   `${KEY:0:6}… (${#KEY} chars)` matches what valve gave.
4. **Indexer:** set `INDEXER_RPC_KEY` to the new key, re-render
   `rpc-proxy.Caddyfile` (the render step is mandatory — `indexer-sync-stack`
   ships only the template), reload the `rpc-proxy` service.
5. Verify (below) BEFORE calling it done.

## Verify

- **Explorer:** `curl .../api/address/0x1c2f39e7be71217a6807ce3c22ec1475a4cfd530/txs?chainid=1`
  returns 3 rows. A read endpoint on each of the four chains answers 200.
- **Indexer:** the scraper advances (a new `ripe/` file appears within a minute)
  and `docker logs valve-scraper-eth` shows no error burst.
- **Grep the proxy log** for the old key prefix — it must not reappear.

## Rollback — one step, no valve needed

The current admin key is still valid (it cannot be rotated), so rollback is:
restore the previous `*_RPC_URL` / `INDEXER_RPC_KEY` values and restart. Keep a
copy of the pre-cutover values in a `op://` scratch item or the operator's own
secret store — NOT in this repo, NOT in a terminal.

### What a `no-writes` refusal looks like (so you don't mistake it for an outage)

A capability refusal and an upstream failure read alike in most logs. They are
not the same, and the fix differs — a refusal means the key's policy is wrong,
not that the endpoint is down.

A denied method returns, from the relay:

```
HTTP 403
{"jsonrpc":"2.0","id":<n>,"error":{"code":-32000,
  "message":"Method not allowed for this API key: <method>. The key is valid;
             its method policy denies this method. Use a key whose policy
             permits it, or change the policy for this key."}}
```

Tells:
- **HTTP 403** with JSON-RPC **-32000**, and the message names *the key*, not the
  chain or the node. An upstream outage is a 502/timeout with no such body.
- At the explorer, viem raises `HttpRequestError` carrying that 403 and message.
- At the indexer, chifra treats the 403 as a hard error and stalls on the block.

If this appears after cutover, a read method our components call was caught by
the deny rules — which should not happen with `no-writes`, since it denies only
send/sign/mining. If it does, roll back and tell valve exactly which method the
message names; do not widen the key blindly.
