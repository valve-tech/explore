# Explorer API spec — Otterscan-equivalent surface

Goal: expand `/api/explorer` (and adjacent routes) so the Explorer view can be
a real PulseChain block explorer — latest activity, block/tx/address/contract
pages, gas insights — not just the tx-detail viewer it is today.

This doc is a **spec for sign-off**, not implementation. Each new endpoint
lists path, method, params, response shape, caching policy, and which Explorer
UI consumes it.

---

## 0. What we already have

Backing existing Explorer views and unchanged by this spec.

### `/api/explorer` (mounted at `/api`)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/tx/:hash` | Full decoded tx (inputs, events, internal txs, token transfers) — via Blockscout + RPC |
| `GET` | `/address/:address` | Address summary (balance, code hint) |
| `GET` | `/address/:address/txs?page&limit` | Tx list for address (Blockscout) |
| `GET` | `/address/:address/tokens` | Token balances for address |
| `GET` | `/contract/:address` | Contract metadata (verified flag, name) |
| `GET` | `/block/:numberOrHash` | Block header + shallow per-tx list |

### `/api/debug`

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/tx/:hash/trace` | Call tree |
| `GET` | `/tx/:hash/opcodes?limit` | Opcode steps |
| `GET` | `/tx/:hash/gas-profile` | Gas-per-call flat profile |
| `POST` | `/trace` | Ad-hoc trace of a calldata payload |

### `/api/source`, `/api/signatures`, `/api/diff` — already complete for their use cases.

---

## 1. Feature → endpoint map (Otterscan parity)

| Otterscan feature | Status | New endpoints |
|---|---|---|
| Latest activity home (latest block, latest finalized, recent blocks/txs) | **MISSING** | `GET /latest/summary`, `GET /blocks`, `GET /txs/recent` |
| Block page (header, txs, gas leaderboard) | partial — block exists, no gas leaderboard | extend response with `gasLeaderboard?` or add `GET /block/:n/gas-leaderboard` |
| Tx page (decoded, events, internal txs, transfers, trace) | **complete** | — |
| Address page — basic | complete | — |
| Address page — internal txs across all interactions | **MISSING** | `GET /address/:address/internal-txs` |
| Address page — token transfers (in/out) | **MISSING** | `GET /address/:address/transfers?type=erc20|erc721|erc1155` |
| Token page (metadata + top holders) | **MISSING** | `GET /token/:address`, `GET /token/:address/holders` |
| Search (parse any input → route) | client-side today | optional: `GET /search?q=` |
| Gas oracle (current base fee + priority percentiles) | **MISSING** | `GET /gas/oracle` |
| Contract verify UI | out of scope MVP | — |
| Mempool watching | out of scope MVP | — |
| Network stats (total tx count, etc.) | out of scope MVP | — |

---

## 2. New endpoint specs

All new endpoints sit under `/api` and use the existing
`ApiError` / `respond.ok` envelope. Responses are envelope-wrapped:
`{ ok: true, result: <T> }` on success, `{ ok: false, error: string }`
on error — same shape every other route uses.

BigInt fields are serialized to decimal strings (existing convention in
`packages/api/src/services/explorer/client.ts`).

### 2.1 `GET /api/latest/summary`

Home view's hero stats. One round trip → one render.

**Params:** none.

**Response:**
```ts
type LatestSummary = {
  latestBlock: {
    number: string;        // "21908443"
    hash: string;
    timestamp: number;     // unix seconds
    transactionCount: number;
    gasUsed: string;
    gasLimit: string;
    baseFeePerGas: string | null;
  };
  finalizedBlock: {
    number: string;
    hash: string;
    timestamp: number;
    lagBlocks: number;     // latest.number - finalized.number
  };
  gasPrice: {
    baseFeePerGas: string;          // wei
    suggestedPriorityFee: string;   // wei, derived from eth_maxPriorityFeePerGas
  };
  network: {
    chainId: 369;
    name: "PulseChain";
  };
};
```

**Caching:** 3s server-side memoization (latest block changes every ~10s on
PulseChain). Cache key is constant; refresh on any miss past TTL.

**Consumer:** Explorer home view, top "stats" row.

**Reth `ots_` usage:** `ots_getBlockDetails("latest")` returns a trimmed
header (no tx list, no logsBloom) plus issuance and totalFees in a single
call — strictly better than `eth_getBlockByNumber` for this view.

---

### 2.2 `GET /api/blocks?limit&before`

Recent N blocks, newest first. Powers the "recent blocks" panel and
infinite-scroll older.

**Params:**
- `limit` (1–50, default 10) — number of blocks to return.
- `before` (optional) — block number; returns blocks strictly **older than**
  this. Omitted ⇒ start from the latest block.

**Response:**
```ts
type RecentBlocks = {
  blocks: Array<{
    number: string;
    hash: string;
    timestamp: number;
    miner: string;
    transactionCount: number;
    gasUsed: string;
    gasLimit: string;
    baseFeePerGas: string | null;
  }>;
  cursor: { before: string } | null;  // null when at genesis
};
```

**Caching:** none — we want the freshest block to appear immediately. RPC
already caches block-by-number internally.

**Consumer:** Explorer home — "Latest blocks" list with link to each.

**Implementation note:** parallelized `ots_getBlockDetails` calls for
`limit` blocks. Each returns a tx count + gas/fee totals without the
transaction list, which is exactly the shape this view needs. Falls back
to `eth_getBlockByNumber({ includeTransactions: false })` if the node
doesn't expose `ots_`.

---

### 2.3 `GET /api/txs/recent?limit`

Most recent N transactions across the chain. Sourced from the latest blocks
top-down until we have N.

**Params:**
- `limit` (1–50, default 10).

**Response:**
```ts
type RecentTxs = {
  transactions: Array<{
    hash: string;
    blockNumber: string;
    timestamp: number;
    from: string;
    to: string | null;
    value: string;       // wei
    valuePLS: string;    // formatted
    gasUsed: string | null;
    methodId: string;    // first 4 bytes of input, or ""
    methodName: string | null;  // 4byte lookup, optional
  }>;
};
```

**Caching:** 3s.

**Consumer:** Explorer home — "Latest transactions" panel.

**Open question:** do we resolve `methodName` server-side (one extra
signatures cache hit per tx) or leave it to the client? Recommend
server-side because we already cache 4byte; consumer doesn't need to N+1.

---

### 2.4 `GET /api/block/:numberOrHash/gas-leaderboard?limit`

Top gas consumers within a single block. The "interesting tx" finder.

**Params:**
- `limit` (1–10, default 3).

**Response:**
```ts
type BlockGasLeaderboard = {
  blockNumber: string;
  totalGasUsed: string;
  totalGasLimit: string;
  topByGas: Array<{
    hash: string;
    from: string;
    to: string | null;
    gasUsed: string;
    percentOfBlock: number;  // 0-100
    methodId: string;
    methodName: string | null;
  }>;
};
```

**Caching:** by `blockNumber` for 60s (block contents don't change).

**Consumer:** Block page sidebar + Explorer home ("biggest gas burner in
latest block" tile).

**Implementation note:** `ots_getBlockTransactions(blockNumber, page, pageSize)`
returns the full tx list **and** their receipts in one round-trip, with
logs already trimmed. Server fetches page 0 with a large pageSize (the
whole block), sorts by `gasUsed`, slices the top N. Logs/logsBloom are
already null in the response which keeps payload small.

Fallback if `ots_` isn't exposed: `eth_getBlockReceipts(blockNumber)` →
one call → sort and slice. Avoid the N+1 per-tx-receipt approach.

---

### 2.5 `GET /api/address/:address/internal-txs?cursor&limit`

Internal transactions where this address is either origin or target,
aggregated across every parent tx that touched the address.

**Pagination model — cursor-based, not page numbers.** Blockscout's
page/limit pagination is unreliable on large addresses, and chifra's
appearance index is naturally cursor-friendly (block + transaction index).
We expose a cursor token that's opaque to the consumer; passing back
`cursor=<token>` fetches the next page. `cursor` omitted → newest first.

**Params:**
- `cursor` (optional) — opaque continuation token from the previous
  response's `nextCursor`.
- `limit` (default 25, max 100).

**Response:**
```ts
type AddressInternalTxs = {
  internalTransactions: Array<{
    parentHash: string;     // outer tx hash
    blockNumber: string;
    timestamp: number;
    type: "CALL" | "DELEGATECALL" | "STATICCALL" | "CREATE" | "CREATE2";
    from: string;
    to: string | null;
    value: string;
    valuePLS: string;
    isError: boolean;
  }>;
  nextCursor: string | null;  // null = end of history
};
```

**Caching:** by `(address, cursor)` for 30s — chifra's response is
deterministic for a given window, and we don't want to re-walk on
back-button.

**Consumer:** Address page → "Internal Transactions" tab.

**Backend source — chifra:** the canonical primitive here.

1. `chifra.valve.city/list?addrs=<address>` — returns every appearance
   (block, txid, trace path) as compact tuples. This is what powers the
   cursor: the cursor encodes the last `(block, txid)` we returned.
2. For each appearance window, we hydrate via `chifra /export?addrs=<...>&traces=true&articulate=true`
   to get the actual internal-call records with articulated function names.

Why chifra and not Reth: Reth's `ots_searchTransactionsBefore/After` —
the natural fit for this view — are stubbed `unimplemented` (see §4a).
Erigon has them, Reth doesn't, so chifra is the only address-history
pagination source we can rely on.

Fallback if chifra is unavailable: Blockscout `txlistinternal` — but
their pagination caps at ~10k results and gets unreliable past page ~50.
Frontend warns the user when falling back.

---

### 2.6 `GET /api/address/:address/transfers?type&cursor&limit`

Token transfer history for the address — ERC-20, ERC-721, or ERC-1155.

**Pagination model:** cursor-based, same shape as §2.5 (chifra-indexed,
opaque token, `nextCursor: null` means end of history). Page numbers are
not exposed.

**Params:**
- `type` (required) — one of `erc20` | `erc721` | `erc1155`.
- `cursor` (optional), `limit` (default 25, max 100).

**Response (ERC-20):**
```ts
type Erc20Transfer = {
  hash: string;
  blockNumber: string;
  timestamp: number;
  from: string;
  to: string;
  contractAddress: string;
  tokenName: string;
  tokenSymbol: string;
  tokenDecimal: number;
  value: string;            // raw
  valueFormatted: string;   // decimal-shifted by tokenDecimal
};
```

ERC-721 / 1155 shapes diverge on `tokenId` and `amount` — discriminated
union by type.

**Caching:** none.

**Consumer:** Address page → "Token Transfers" tab.

**Backend source — chifra:** `chifra.valve.city/export?addrs=<address>&logs=true&articulate=true`,
filtered server-side to the standard transfer-event topics:
`Transfer(address,address,uint256)` for ERC-20/721 (disambiguated by
indexed-topic count) and `TransferSingle`/`TransferBatch` for ERC-1155.
Articulated logs give us decoded `from / to / value / tokenId` without
per-event ABI decode.

Same Reth-can't-paginate caveat as §2.5 — `ots_searchTransactions*` are
stubbed. Chifra is the only realistic source.

Fallback if chifra is unavailable: Blockscout `tokentx` / `tokennfttx` /
`token1155tx` with same caveat about pagination ceiling.

---

### 2.7 `GET /api/token/:address`

Token contract metadata.

**Response:**
```ts
type TokenMetadata = {
  address: string;
  name: string;
  symbol: string;
  decimals: number | null;   // null for NFTs
  totalSupply: string;
  standard: "ERC-20" | "ERC-721" | "ERC-1155";
  holdersCount: number | null;
  verified: boolean;
  deployedAt: {              // from ots_getContractCreator
    txHash: string;
    creator: string;
    blockNumber: string;
  } | null;
};
```

**Caching:** 5 minutes by address — token metadata is effectively static.

**Consumer:** Token detail page (new route).

**Reth `ots_` usage:** `ots_hasCode(address)` first (constant-cost
"is contract" check), then `ots_getContractCreator(address)` to populate
the `deployedAt` field. `getContractCreator` is slow on cold contracts
(binary-searches block range + traces) — cache result indefinitely once
populated; the deployer doesn't change.

---

### 2.8 `GET /api/token/:address/holders` — **deferred (not in v1)**

Chifra's HTTP API has no holders-of-token primitive (`/tokens` returns
balances for holder addresses you pass *in*, not an enumeration), and
`chifra.valve.city` doesn't currently expose a custom pre-aggregated
holders endpoint above the standard surface. Building it ourselves means
walking every `Transfer` event for the token and tallying balances — real
aggregation, slow cold start, non-trivial to cache.

**Decision:** punt. The Token detail page renders a **disabled "View
holders" button with a "Coming soon" tooltip** in v1. No API endpoint
created. Revisit when there's either a pre-aggregated source on
`chifra.valve.city` or we decide the aggregator effort is justified.

---

### 2.9 `GET /api/gas/oracle`

Current gas market snapshot.

**Response:**
```ts
type GasOracle = {
  baseFeePerGas: string;     // wei
  priorityFee: {
    slow: string;            // 25th percentile of recent priority fees
    standard: string;        // 50th
    fast: string;            // 75th
  };
  blockNumber: string;       // block used for sampling
  sampledOverBlocks: number; // typically 20
};
```

**Caching:** 3s.

**Consumer:** Explorer home stats row + transaction builder (future).

**Implementation:** `eth_feeHistory(20, "latest", [25, 50, 75])`.

---

### 2.10 `GET /api/mempool/summary`

Hero stats for the mempool visualizer's home tile + the dedicated mempool
view's header.

**Params:** none.

**Response:**
```ts
type MempoolSummary = {
  pendingCount: number;        // ready-to-include txs
  queuedCount: number;         // future-nonce / replaced / stuck
  gasPrice: {
    p25: string;               // wei
    p50: string;
    p75: string;
    p95: string;
    max: string;
  };
  byMethod: Array<{            // top 5 method-IDs by pending count
    methodId: string;          // 0x-prefixed 4-byte selector
    methodName: string | null; // 4byte-resolved
    count: number;
  }>;
  oldestPendingSeconds: number; // age of the oldest still-pending tx
  sampledAt: number;           // unix ms; client-side staleness indicator
};
```

**Caching:** 2s. Mempool churns fast but a 2s window keeps the load down
and the UI fresh enough.

**Backend source:**
- `txpool_status` for pending/queued counts (cheap).
- `txpool_content` sampled and reduced server-side for percentiles +
  method breakdown (expensive — full snapshot can be MBs; we cache the
  reduced result, not the raw response).

**Consumer:** Mempool home tile on Explorer home + dedicated `/mempool`
route header.

---

### 2.11 `GET /api/mempool/pending?sortBy&direction&cursor&limit`

Paginated list of pending transactions, server-sorted.

**Params:**
- `sortBy` — `gasPrice` (default), `age`, `nonce`, `value`.
- `direction` — `asc` | `desc` (default `desc`).
- `cursor` (optional) — opaque continuation token.
- `limit` — default 25, max 100.

**Response:**
```ts
type MempoolPending = {
  transactions: Array<{
    hash: string;
    from: string;
    to: string | null;        // null = contract creation
    value: string;            // wei
    valuePLS: string;
    gasLimit: string;
    maxFeePerGas: string | null;        // EIP-1559
    maxPriorityFeePerGas: string | null;
    gasPrice: string | null;            // legacy / effective
    nonce: string;
    methodId: string;
    methodName: string | null;
    pendingSinceSeconds: number;        // how long it's been in the pool
    replacedCount: number;              // times the same (from, nonce) was bumped
  }>;
  nextCursor: string | null;
  totalEstimate: number;       // approximate total in the pool right now
};
```

**Caching:** none — we want fresh data for the listing.

**Backend source:** `txpool_content` reduced server-side. For sort-by-age
we track first-seen timestamps in a small in-memory ring buffer (the EL
client doesn't surface ingress time).

**Consumer:** `/mempool` route — main list view.

---

### 2.12 `GET /api/mempool/tx/:hash`

Detail view for a single pending transaction. Returns null/404 when the
hash is not in the mempool (caller should fall back to `/api/tx/:hash`
which will find it on-chain if it landed since the last request).

**Response:**
```ts
type MempoolTxDetail = {
  hash: string;
  from: string;
  to: string | null;
  value: string;
  valuePLS: string;
  input: string;
  decoded: {                   // present when ABI is resolvable
    methodName: string;
    args: Array<{ name: string; type: string; value: string }>;
  } | null;
  gasLimit: string;
  maxFeePerGas: string | null;
  maxPriorityFeePerGas: string | null;
  gasPrice: string | null;
  nonce: string;
  pendingSinceSeconds: number;
  positionEstimate: {           // best-effort "where in the queue"
    aheadInGasPrice: number;    // count of pending txs with higher gasPrice
    aheadFromSameSender: number; // count of same-sender lower-nonce pending
    percentileByGasPrice: number; // 0-100, this tx's rank in the pool
  };
  whatIfSimulationUrl: string;  // deep-link to /fork pre-filled with this tx
};
```

**Caching:** 1s by hash. A pending tx in our cache must still be in the
pool — re-validate cheaply with `txpool_content` membership check before
trusting the cache.

**Backend source:**
- `txpool_content` for the tx and its siblings (for ranking).
- Existing decoder service for `decoded`.

**Consumer:** Clicking a row in `/mempool` opens this view. Also linked
from `/api/tx/:hash` when the standard tx lookup returns "not found
on-chain" → frontend tries the mempool endpoint next.

**Reth `ots_` usage:** none — `txpool_*` namespace covers this.

---

### 2.13 Msgboard endpoints

PulseChain Reth ships a `msg/1` devp2p subprotocol for **off-chain**
PoW-mined message gossip — see
`reth/crates/net/msgboard/src/rpc_api.rs` for the canonical RPC trait.
Messages are not transactions; they live in the node's RAM/MDBX for a
bounded number of blocks (default 120), capped at 10,000 messages and
8 KiB per message. The RPC surface lives under the `msgboard_*`
namespace.

We expose a thin HTTP layer that proxies the relevant `msgboard_*` calls
into our `/api/msgboard/*` shape. Same envelope + BigInt-as-string
conventions as the rest of the spec.

#### Wire types (reused across these endpoints)

```ts
// Mirrors MsgboardMsg in rpc_api.rs. All uints are 0x-hex on the wire;
// we keep that shape so the consumer can match against erigon-pulse too.
type MsgboardMsg = {
  version: string;        // "0x1" for msg/1
  blockHash: string;
  blockNumber: string;
  nonce: string;
  workMultiplier: string;
  workDivisor: string;
  category: string;       // 0x-prefixed 32-byte app-defined id
  data: string;           // 0x-prefixed raw bytes
  hash: string;           // SHA-256 PoW hash, identifier
};

type MsgboardStatus = {
  enabled: boolean;
  count: string;          // current message count
  size: string;           // sum of all data field bytes
  workMultiplier: string; // node's minimum accepted
  workDivisor: string;    // node's minimum accepted
  headBlock: string;      // chain head as the board sees it
};
```

#### 2.13.1 `GET /api/msgboard/status`

Hero stats for the msgboard view + the home tile.

**Params:** none.
**Response:** `{ status: MsgboardStatus }`.
**Caching:** 2s.
**Backend source:** `msgboard_status` RPC call.
**Consumer:** Explorer home tile + `/msgboard` route header.

#### 2.13.2 `GET /api/msgboard/categories`

List of every category hash currently represented in the board.

**Params:** none.
**Response:** `{ categories: string[]; count: number }`.
**Caching:** 5s.
**Backend source:** `msgboard_categories` RPC call.
**Consumer:** `/msgboard` route — category browser sidebar.

#### 2.13.3 `GET /api/msgboard/messages?category&fromBlock&toBlock&cursor&limit`

Paginated list of live messages. Supports filtering by category and/or
block range.

**Params:**
- `category` (optional) — 32-byte hex hash.
- `fromBlock` (optional), `toBlock` (optional) — inclusive bounds.
- `cursor` (optional) — opaque continuation token.
- `limit` — default 25, max 100.

**Response:**
```ts
type MsgboardMessages = {
  messages: MsgboardMsg[];
  nextCursor: string | null;
  totalMatching: number;     // current snapshot count matching the filter
};
```

**Caching:** snapshot-based, same model as the mempool (§2.10–2.12). One
background loop polls `msgboard_content` every 2s into a reduced
`Map<hash, MsgboardMsg>`; all `/messages` queries serve from the
snapshot. Cursor encodes the last `(blockNumber, hash)` returned —
deterministic ordering newest-first.

**Backend source:** `msgboard_content({ category?, fromBlock?, toBlock? })`,
then in-memory pagination by cursor.

**Consumer:** `/msgboard` route main list + per-category drill-down.

#### 2.13.4 `GET /api/msgboard/messages/:hash`

Single message detail by SHA-256 PoW hash.

**Params:** `hash` — 32-byte hex.
**Response:**
```ts
type MsgboardMessageDetail = {
  message: MsgboardMsg;
  decoded: {                // best-effort presentation helper
    dataAsUtf8: string | null;   // null if data is not valid UTF-8
    categoryAsUtf8: string | null;
    blockAge: number;            // headBlock - blockNumber
    expiresAtBlock: string;      // blockNumber + boardBlockRange
  };
};
```

**Caching:** by hash for the lifetime of the message in the snapshot
(messages are immutable until they expire out of the board).

**Backend source:** `msgboard_getMessage(hash)`. If not in the snapshot,
return 404.

**Consumer:** `/msgboard/messages/:hash` route.

#### 2.13.5 `POST /api/msgboard/messages`

Submit a new message. The client is responsible for solving the PoW and
RLP-encoding the `PoWMsg`; the server just validates shape and forwards.

**Body:**
```ts
type SubmitMsgboardMessage = {
  rlpHex: string;     // 0x-prefixed RLP-encoded PoWMsg payload
};
```

**Response:** `{ hash: string }` — the SHA-256 PoW hash the node assigned.

**Caching:** none.

**Backend source:** `msgboard_addMessage(rlpHex)` RPC call. The node
verifies the PoW; we surface its error string verbatim on failure (with
`ApiError(400, ...)`).

**Consumer:** Future "Post to board" UI. Not required for MVP — the
read-only views (§2.13.1–2.13.4) are enough to launch.

#### 2.13.6 Live updates

Same architectural question as the mempool live-updates: 2s polling
(simplest, current API style) vs SSE/WS (sub-second pushes). The node
itself offers `msgboard_subscribe("newMessages", filter)`, so if we go
SSE we'd hold one upstream subscription on the API side and fan out
SSE events to every connected client. Recommend **polling for v1**,
revisit alongside the mempool live-updates decision.

---

### 2.14 `GET /api/search?q=` *(optional MVP)*

Server-side parser. Frontend currently does this in the ⌘K palette
([packages/web/src/components/AppShell.tsx](../packages/web/src/components/AppShell.tsx)),
so this is only useful if we want **fuzzy contract-name search** — which
needs an index we don't currently maintain.

**Recommendation:** skip in v1. Revisit when we have a contract-names
database to search against.

---

## 3. Implementation order (recommended)

Bundle 1 — **"home view"** (smallest valuable shipment):
1. `GET /api/latest/summary` — §2.1
2. `GET /api/blocks` — §2.2
3. `GET /api/txs/recent` — §2.3
4. Frontend: rewrite the Explorer empty state into a home view consuming
   the above.

Bundle 2 — **"block depth"**:
5. `GET /api/block/:n/gas-leaderboard` — §2.4
6. Frontend: integrate leaderboard into existing block view.

Bundle 3 — **"address depth"**:
7. `GET /api/address/:address/internal-txs` — §2.5
8. `GET /api/address/:address/transfers` — §2.6
9. Frontend: add tabs to AddressView.

Bundle 4 — **"token + gas"**:
10. `GET /api/token/:address` — §2.7
11. `GET /api/gas/oracle` — §2.9
12. Frontend: token detail page (new route), with a disabled "View holders
    — coming soon" button per §2.8; gas oracle pill on home.

Bundle 5 — **"mempool"**:
13. `GET /api/mempool/summary` — §2.10
14. `GET /api/mempool/pending` — §2.11
15. `GET /api/mempool/tx/:hash` — §2.12
16. Frontend: `/mempool` route + mempool tile on home + pending-tx fallback
    on the existing tx-detail page.

Bundle 6 — **"msgboard"**:
17. `GET /api/msgboard/status` — §2.13.1
18. `GET /api/msgboard/categories` — §2.13.2
19. `GET /api/msgboard/messages` — §2.13.3
20. `GET /api/msgboard/messages/:hash` — §2.13.4
21. Frontend: `/msgboard` route (list + category browser + detail) + home
    tile. `POST /api/msgboard/messages` (§2.13.5) and live updates
    (§2.13.6) are post-MVP.

Each bundle ships independently. After Bundle 1 the Explorer route is a
functional explorer; later bundles add depth.

---

## 4a. Reth `ots_` namespace — support matrix

We verified each method against Reth's source
([crates/rpc/rpc/src/otterscan.rs](https://github.com/paradigmxyz/reth/blob/main/crates/rpc/rpc/src/otterscan.rs))
on current `main` (lineage of the v2.x line). Spec details for each method
live at [otterscan-book ots-api.md](https://github.com/otterscan/otterscan-book/blob/main/src/api-docs/ots-api.md).

| `ots_` method | Reth | Used by spec section | Notes |
|---|---|---|---|
| `ots_getApiLevel` | ✓ | — | feature-detect only |
| `ots_hasCode` | ✓ | §2.7 (cheap "is contract" check) | constant-cost vs `eth_getCode` |
| `ots_getInternalOperations` | ✓ | replaces our debug trace for ETH-transfer-only views | per-tx, narrow output |
| `ots_getTransactionError` | ✓ | tx page revert-reason | one call vs receipt+decode |
| `ots_traceTransaction` | ✓ | alt path to `/api/debug/tx/:hash/trace` | optimized call tree |
| `ots_getBlockDetails` | ✓ | §2.1 latest, §2.2 recent blocks | trimmed header + issuance + totalFees |
| `ots_getBlockDetailsByHash` | ✓ | same, when fetching by hash | |
| `ots_getBlockTransactions` | ✓ | **§2.4 block-page tx pagination** | server-side pagination + receipts bundled |
| `ots_searchTransactionsBefore` | **✗ stubbed `unimplemented`** | (would have backed §2.5/§2.6) | needs per-address history index Reth doesn't maintain |
| `ots_searchTransactionsAfter` | **✗ stubbed `unimplemented`** | (same) | |
| `ots_getTransactionBySenderAndNonce` | ✓ | (future) sender-nonce navigation widget | |
| `ots_getContractCreator` | ✓ | §2.7 — "deployed at tx" line on token/contract pages | slow on cold contracts (binary-search + trace) |

**Bottom line:** Reth gives us strong primitives for **block-level** and
**per-tx** views (`getBlockDetails`, `getBlockTransactions`,
`getInternalOperations`, `traceTransaction`, `getTransactionError`,
`getContractCreator`). The **address-history pagination** primitives —
exactly what we'd hoped to lean on — are not implemented; **chifra `/list`
and `/export` are the only realistic pagination source for address pages**
on the Valve infra.

---

## 4. Cross-cutting concerns

- **BigInt → string** at the API boundary (existing pattern, enforced by
  `packages/api/src/services/explorer/client.ts:serialize`).
- **Caching** uses the same in-memory TTL Map pattern already used for ABI
  cache (see [`packages/api/src/services/decoder/abiCache.ts`](../packages/api/src/services/decoder/abiCache.ts)).
  No Redis — local Map with TTL + max-size eviction is sufficient.
- **Error envelope** — every endpoint uses `respond.ok` / `ApiError`. No new
  error patterns.
- **Validation** — Zod schemas alongside each route in
  `packages/api/src/routes/<name>/schemas.ts`, mirroring the alerts/actions
  layout.
- **Auth** — these routes live under `/api`, which is gated by
  `authMiddleware`. No changes.

---

## 5. Open questions for sign-off

1. **Server-side method-name resolution** for §2.3/§2.4 — accept the extra
   4byte lookups, or leave to client?
2. **`/api/block/:n` response extension** vs. dedicated leaderboard endpoint
   — extend (less round-trips, fatter responses) or split (clean, more
   calls)? Recommend split — and `ots_getBlockTransactions` already
   bundles receipts for us, so the leaderboard endpoint is mostly
   re-sorting cached data.
3. **chifra.valve.city integration** — **resolved**.
   - Standard TrueBlocks HTTP API (per [trueblocks.io/api](https://trueblocks.io/api/)):
     `/list`, `/export`, `/transactions`, `/logs`, `/traces`, `/tokens`.
   - "Opt-in" = UI lazy-load (button click), not auth/consent.
   - **Address pages**: §2.5 (internal txs) and §2.6 (token transfers) use
     `chifra /export` with `traces=true` / `logs=true` respectively;
     Blockscout becomes the fallback.
   - **Token holders (§2.8)**: deferred — chifra has no holders primitive,
     `chifra.valve.city` has no custom one either, and we're not building
     an aggregator now. UI shows a disabled "Coming soon" button.
4. **Internal-tx & transfer pagination** — **resolved**. Cursor-based
   (opaque token from chifra appearances), `nextCursor: null` signals end
   of history. No page numbers exposed. Blockscout fallback path keeps
   the same response shape and synthesizes a cursor from its `page` param,
   but warns the user when activated since its history ceiling is ~10k.
6. **Msgboard** — **scoped in** (Bundle 6, §2.13). Reads use
   `msgboard_status`, `msgboard_categories`, `msgboard_content`,
   `msgboard_getMessage`. Write path (`POST` → `msgboard_addMessage`) is
   post-MVP — read-only is enough to launch the visualizer. Same
   snapshot/polling model as the mempool keeps the upstream load low.
   Need to confirm the `msgboard` JSON-RPC namespace is enabled on the
   `--http.api` flag on Valve's PulseChain Reth instance.

5. **Mempool** — **scoped in** (Bundle 5, §2.10–2.12).
   - Need to confirm `txpool_status` and `txpool_content` are enabled on
     the PulseChain RPC node — both are gated behind `--http.api txpool`
     in Reth and may be off by default on a public endpoint.
   - **Live updates strategy** — open: HTTP polling every 2s (simplest,
     works through any proxy), or add SSE/WebSocket for sub-second pushes
     of new pending txs? Recommend **polling for v1** since (a) 2s
     latency is fine for a visualizer, (b) the API has been pure HTTP
     until now, (c) SSE can be layered on later without API surface
     changes. Worth confirming.
   - **Pool-snapshot caching** — `txpool_content` returns MBs on busy
     chains. We sample it server-side every 2s into a reduced shape
     (`Map<hash, lightTx>`), and serve all `/mempool/*` endpoints out of
     that snapshot. Tx-detail (§2.12) does a single-tx re-fetch for
     decoded fields. The snapshot cost is paid once per 2s window
     regardless of how many clients are viewing.
   - **Ingress timestamps** — the EL client doesn't surface
     first-seen-at, but our snapshot loop can track its own first-sight
     per hash. Stored in an in-memory ring buffer (~10k entries), evicted
     when the hash leaves the pool.
