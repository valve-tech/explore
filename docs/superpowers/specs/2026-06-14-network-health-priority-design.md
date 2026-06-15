# Network Health — transaction prioritization & fee-burn lens

**Status:** Design / spec
**Date:** 2026-06-14
**Route:** `/network-health` (label "Network Health", nav group "Inspect").
`/health` is taken — it's the API health-check, proxied to the backend in dev
and excluded from the SPA fallback in prod, so the page must not use it.
**Scope:** v1 — one chain at a time, driven by the existing ChainSelector.

## Problem

We want to surface *which transactions are being prioritized* in recent blocks
on a given chain, and whether different transaction types are ordered the way a
rational fee market would order them. The long-term framing is a "network
health" / native-token burn watcher (ultrasound-money style); v1 delivers the
ordering-and-burn analysis that the burn view is later built on top of.

The naive question — "do legacy (type 0/1) txns sit near the top of blocks?" —
is **not** meaningful on its own. A legacy tx near the top is *correct* if it
pays more. The question only has meaning relative to a baseline of how blocks
*should* be ordered, and that baseline depends on what the block producer
actually earns.

## The two lenses (core framing)

Every included transaction's per-gas price decomposes at the base-fee line:

```
effectiveGasPrice  =  baseFee        +  tip
  (what user pays)     (burned)          (validator earns)
   └── USER COST ──┘   └────── VALIDATOR REVENUE ──────┘
```

- **User lens (cost):** total paid per gas = `effectiveGasPrice`. The user does
  not care that the base fee is burned — they paid it. Intuition: "I paid more,
  I should be earlier."
- **Validator lens (revenue):** the producer earns only
  `tip = effectiveGasPrice − baseFee` (base fee burned). They order by what they
  pocket.

`effectiveGasPrice` comes from the receipt (all tx types, including legacy where
it equals `gasPrice`). `baseFee` comes from the block header. So the same two
quantities feed both lenses; `tip = effectiveGasPrice − baseFee` is computed
identically for legacy and dynamic-fee txns.

### Why the split matters

The two lenses diverge in **magnitude**, not **ordering**. Within a single block
`baseFee` is constant, so `tip = effectiveGasPrice − baseFee` preserves rank —
tip-order, cost-order and price-order are *identical*. There is therefore **one**
prioritization metric (a priority-inversion rate), not a separate tip- and
cost-inversion pair (an earlier draft wrongly split them; they would always be
equal).

Where the lenses genuinely differ is the decomposition: `paid = burned + tips`.
The **burn share** (`burned / paid`) is the real wedge between what users spend
and what validators earn — the share of user spend destroyed rather than paid to
anyone. That is a first-class number on the page, split by type.

This is where the **legacy vs modern split earns its place**: a legacy tx sets a
single fixed `gasPrice`, so when base fee rises its tip (`gasPrice − baseFee`)
is compressed — the user can pay a high *total* yet deliver a low *tip* and get
deprioritized despite overpaying. Type-2 users set `maxPriorityFee` explicitly,
so their tip is deliberate. "Are legacy users systematically paying more in cost
than their block position reflects?" is the concrete, answerable question.

## Base-fee burn assumption

The tip axis is correct **iff** the validator does not receive the base fee.
PulseChain runs EIP-1559 and is believed to burn the base fee outright. Rather
than hardcode this:

1. **Per-chain config flag** `burnsBaseFee` (default `true` for PulseChain,
   chain 369 / 943; default `true` for Ethereum chain 1). The ordering axis is
   always "validator revenue per gas" — `effectiveGasPrice − baseFee` when
   burning, full `effectiveGasPrice` when not. One flag flips it.
2. **Self-verifying reconciliation guard** (sampled): for a small sample of
   blocks in the window, compare the coinbase balance delta against the tip
   model `Σ(tip × gasUsed)`. If blocks do not reconcile under `burnsBaseFee:
   true`, the assumption is wrong for that chain and the page surfaces a warning
   instead of silently reporting garbage. Runs on a few blocks, not every block,
   so it does not require archive state per block or drag the cold warm. Same
   reconcile-against-on-chain-ground-truth discipline as the substreams verify
   work; doubles as the burn watcher's future accuracy check.
3. **Confirm against go-pulse source during implementation** — a 2-minute check
   once we have a traced block in hand. Not a blocker; the reconciliation guard
   catches it regardless.

## Metrics

Transaction types are bucketed as **legacy** (type 0 + 1) vs **modern**
(type ≥ 2). All money quantities stay as raw bigints internally and are
serialized to strings at the API boundary; ratios/shares are computed for
display and formatted at the edge.

### Per block (`BlockStats`)

From `eth_getBlockReceipts` (tip/gasUsed/type/index per tx) + the block header
(baseFee/timestamp/miner/gasUsed/gasLimit):

- `number`, `timestamp`, `baseFeePerGas`, `gasUsed`, `gasLimit`, `txCount`
- **Composition:** gas-weighted legacy vs modern share = `Σ gasUsed[type<2] / Σ gasUsed`
- **Burn vs tip totals:** `burned = baseFee × gasUsed_block`;
  `tips = Σ(tip × gasUsed)`; both also split by type.
- **Avg normalized position by type:** position `index/(txCount−1)`, 0 = top.
- **Position histogram by type:** fixed buckets (e.g. 10) × {legacy, modern},
  gas-weighted — feeds the window heatmap.
- **Priority-inversions:** share of *adjacent* tx pairs where a later tx
  out-prioritizes an earlier one, **excluding same-sender pairs** (nonce ordering
  legitimately forces those). Normalized to [0,1]. Adjacent (O(n)) rather than
  full Kendall-tau so pathological large blocks stay cheap. One metric only —
  tip- and cost-order are identical within a block (constant base fee).
- **Burn share:** `burned / paid` — the cost-vs-revenue wedge.
- **Over-prioritized gas by type:** gas of txns placed earlier than their
  tip-rank justifies, attributed legacy/modern — the literal "who jumped the
  queue" number.

### Aggregate (over the loaded window)

Window-level rollups of all of the above: overall composition, total burned vs
tipped (split by type), the burn share (burned / paid), the priority-inversion
rate, the position heatmap, blocks analyzed, and time span.

## Honesty caveats (surfaced in UI)

Validators can legitimately order on non-fee criteria: MEV bundles, private
orderflow, same-sender nonce constraints, zero-tip txns paid out-of-band.
Tip-inversion is therefore a **signal to investigate, not proof of misbehavior**,
and is labeled as such. There may be nothing anomalous to find on a given chain
— a healthy fee market is a valid, useful result.

## Architecture

### Backend

- **Endpoint:** `GET /api/network-health?chainid=N&before=<blockNum>&limit=256`
  → `{ aggregate, blocks: BlockStats[] }`. `before` powers load-more (older
  blocks); omitted = latest window. Zod-validated at the boundary; `asyncRoute` /
  `respond` envelope; bigints serialized to strings (repo convention).
- **Pure compute module** `services/networkHealth/compute.ts`:
  `(receipts, header, { burnsBaseFee }) → BlockStats`. No RPC, no clock — fully
  unit-testable, keeps raw bigints internal. (Matches the codebase's pure-helper
  / raw-ints conventions.)
- **Cache shell** `services/networkHealth/cache.ts`: `Map<chainId,
  RingBuffer<BlockStats>>`. Lazy-warm the latest `INITIAL_WINDOW` blocks on first
  request for a chain; later requests top up only the gap since the last head
  (cheap); load-more extends backward in `LOAD_CHUNK` blocks up to `CACHE_CAP`,
  evicting the oldest as new head blocks arrive. Concurrent warm-ups collapsed
  via the existing `dedupePromise`. **Only computed aggregates are cached** — raw
  receipts are discarded after compute (≈ <1KB/block → 2560 × 3 chains ≈ a few
  MB).
- **Refresh:** *request-driven* — top up the head when a request arrives and the
  head is stale. No constant background poller (costs nothing for chains nobody
  is viewing; staleness window is fine for ~10s blocks). A gasOracle-style poller
  is the documented alternative if a always-warm dashboard is wanted later.
- **RPC per block:** 2 calls — `eth_getBlockReceipts` + `getBlock` header.
  Cold warm of 256 ≈ 512 calls, concurrency-limited. `eth_getBlockReceipts` is
  supported by reth (the valve fleet) and geth-family nodes; if a chain's
  endpoint rejects it, the service degrades to a clear "unsupported on this
  chain" rather than fanning out N per-tx receipt calls.
- **Per-chain config:** `burnsBaseFee` flag lives with the chain registry /
  service config alongside the RPC client lookup (`chainClient()` /
  `getRpcClient(chainId)`).

### Tunable constants

```
INITIAL_WINDOW = 256   // cold fetch + default page window
LOAD_CHUNK     = 256   // load-more increment (backward)
CACHE_CAP      = 2560  // per-chain ring-buffer ceiling
```

### Frontend

- **Route** `/network-health`, lazy-loaded, registered in `App.tsx` + a `navGroups.ts`
  entry under **Inspect**, label "Network Health".
- **Chain-aware:** reads the active chain like other pages; switching the
  ChainSelector refetches for that chain.
- **Data:** a `useNetworkHealth` TanStack Query hook hitting the endpoint via the
  standard `apiUrl` + `scoped` client; load-more appends the next older 256
  (infinite-query style).
- **Layout (top → bottom):**
  - Summary cards: gas-weighted legacy vs modern %, burn share (burned / paid),
    priority-inversion rate, blocks analyzed + time span.
  - **Two lenses paired side-by-side** — User cost vs Validator revenue — each
    gas-weighted and split legacy/modern. (Paired, not toggled: the contrast is
    the point.)
  - Composition-over-blocks chart + position heatmap (readable through either
    lens).
  - Per-block table: block #, time, tx count, gas used, legacy gas %, burned vs
    tip, priority-inversion, over-prioritized gas — with **Load more**.

## Testing

- **`compute.ts` unit tests** (the correctness core): known receipts + header →
  expected composition, positions, priority-inversions, burn/tip totals,
  over-prioritized attribution. Include same-sender nonce-exclusion cases and the
  `burnsBaseFee: false` path.
- **Cache shell test:** warm / head-topup / load-more / eviction with a faked
  fetch.
- **One API integration smoke check** against the live server, consistent with
  the existing API test style.

## Out of scope for v1 (YAGNI)

- Full burn/ultrasound accounting UI (the per-tx burn/tip decomposition is
  computed and stored, so the view is a later presentation layer only).
- Side-by-side multi-chain comparison (one chain at a time via ChainSelector).
- MEV-bundle / private-orderflow classification.
- Persistence — in-memory only, by request.

## Future hooks (set up for free)

- **Burn watcher:** `burned = baseFee × gasUsed` per block is already computed
  and cached; the ultrasound-money view is a presentation layer over existing
  data.
- **Background poller** for an always-warm public dashboard.
- **Multi-chain comparison** — the per-chain cache + per-chain aggregate shape
  already supports rendering more than one chain at once later.
