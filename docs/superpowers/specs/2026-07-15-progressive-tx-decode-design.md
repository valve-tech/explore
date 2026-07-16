# Progressive transaction decode — design

**Date:** 2026-07-15
**Status:** approved (design), not yet implemented
**Scope:** the explorer transaction page only

## Problem

`GET /api/tx/:hash` returns core transaction facts and ABI enrichment in one
payload, so the page cannot paint until the slowest verified-source lookup
finishes. The core facts — from/to/value/gas/status/rawLogs — need **zero** ABI
and are ready in ~350ms. The enrichment (`decodedInput`, `decodedLogs`) depends
on Sourcify and Blockscout, which are third-party and periodically sick:

- Sourcify put API v1 into a 503 brownout on 2026-07-07 (fixed by migrating to
  v2 in `37e30b5`).
- Blockscout `api.scan.pulsechain.com` is unreachable outright and costs a
  connect timeout to discover (bounded to one per process in `98b71bc`).

After those fixes a cold container still spends ~4.17s on its first transaction
page, all of it waiting on an upstream whose answer the page does not need to
render. The next outage will do it again. The enrichment does not belong on the
critical path.

Rendering already degrades correctly: `TxDetail.tsx` renders on
`decodedLogs.length > 0 || rawLogs.length > 0`, `EventsSection` falls back to raw
topics, and `DecodedInputSection` is simply omitted when `decodedInput` is null.
Nothing needs to be taught how to cope with missing decode. The page only needs
to stop *waiting* for it.

## Goal

The transaction page paints core facts as soon as the RPC reads return, and
never waits on a verified-source upstream. Decoded names and arguments swap in
when they arrive. If they never arrive, the page stays useful and says so.

Non-goal: changing what is decoded, or how.

## Approach

**Opt-in split.** `/api/tx/:hash` stays complete by default; the explorer page
opts out of decode and fetches it separately.

Rejected alternatives:

- **Hard split** (`/api/tx/:hash` becomes core-only, always). Cleaner contract,
  but it silently drops `decodedInput`/`decodedLogs` for every existing caller —
  including the SDK's `FrameDetailPanel` and `TxPreview` — turning a latency fix
  into a flag day. Worth collapsing to this later, once nothing reads the fat
  payload.
- **Stream one response** (NDJSON/SSE: core frame, then decode frame). One
  round-trip and no contract split, but it is a lot of machinery for two fields
  and needs custom plumbing on the client. Not justified.

### Backend

Reuse the existing `skipDecode` seam. `buildTransactionDetails` already takes
`{ skipDecode?: boolean }`, and the Etherscan handlers already pass it
(`routes/etherscan/handlers/transaction.ts:65`) — this is a proven path, not a
new one.

1. **`GET /api/tx/:hash?decode=0`** → `getTransactionDetails(hash, { skipDecode: true })`.

   The response **shape is unchanged**: `skipDecode` yields `decodedInput: null`
   and `decodedLogs: []`, which are already valid values the page handles. No
   type change, no optional fields, no client migration for anyone who doesn't
   pass the flag. `decode` is parsed at the boundary like any other query input;
   anything other than `0` means "decode", so the default stays complete.

2. **`GET /api/tx/:hash/decode`** → `{ ok: true, result: { decodedInput, decodedLogs } }`.

   Implemented by calling the existing `getTransactionDetails(hash)` and
   returning only the two decoded fields. This re-reads tx+receipt (~350ms of
   cheap RPC the core call also does), which is the deliberate trade: no
   duplicated decode logic, at the cost of two cheap reads that run concurrently
   from the client. If that ever shows up in a profile, the fix is to split the
   fetch from the build — not to fork the decode.

   Budget: its own `withTimeout`, sized against the upstream deadlines it waits
   on (`SOURCIFY_FETCH_TIMEOUT` 8s + `BLOCKSCOUT_FETCH_TIMEOUT` 3s = 11s; see
   `services/sourceCode/types.ts`). A genuine timeout (nothing resolved) still
   returns **504** — there is no partial result to preserve.

   A 404 (unknown hash) propagates as today.

   **AMENDED 2026-07-15 (from the final whole-branch review):** the original
   "504-not-`[]`" rule below could not hold as written. `fetchAbi` deliberately
   catches `UpstreamError` and returns `null` ("decode without an ABI rather
   than failing the caller"), so a decode build during an upstream outage
   resolves *fast and successfully* with empty decode — the timeout never fires,
   and `/decode` returned `200 []`, indistinguishable from "nothing to decode".
   Worse, with Blockscout permanently dead, "unverified" and "unreachable"
   collapse to the same `null` before the route can tell them apart, so a naive
   "504 when empty" would over-report unavailability for genuinely-unverified
   contracts.

   **Resolution — a `degraded` flag on a 200, not a 504.** `/decode` returns
   `{ ok: true, result: { decodedInput, decodedLogs, degraded } }`. `degraded`
   is `true` when any verified-source lookup during *this* build could not get a
   definitive answer — an upstream threw `UpstreamError`, or its circuit breaker
   was open and the lookup was skipped. This is request-scoped (a dedicated
   `AsyncLocalStorage` in the sourceCode layer, set by `getVerifiedSource`, read
   by the route), so it is accurate under partial decode (some contracts resolve
   via Sourcify while Blockscout is down → decode is kept AND `degraded: true`)
   and never fires on a healthy chain. The 504 remains only for a true timeout.

   The empty-vs-unreachable honesty the original rule wanted is preserved by
   `degraded`, not by the status code — and `degraded` additionally keeps the
   partial decode that a 504 would have thrown away.

### Frontend

`TxDetail` owns the core fetch today via `useState` + `useEffect` +
`fetchTransaction`, and is **not** a TanStack Query consumer.

3. **`api/explorer.ts`** — `fetchTransaction(hash, chainId, { decode }?)` appends
   `decode=0` when asked; new `fetchTransactionDecode(hash, chainId)` hits
   `/decode`. Both go through the existing `apiUrl()` + `scoped()` helpers so the
   IPFS build and `?chainid=` routing keep working.

4. **`useTxDecode(hash, chainId)`** — a small, isolated hook returning
   `{ decodedInput, decodedLogs, state }` where `state` is
   `"pending" | "ready" | "unavailable"`. It mirrors the cancelled-flag pattern
   `TxDetail` already uses, so a hash or chain change cannot land a stale
   response.

5. **`TxDetail`** passes `{ decode: false }` to its core fetch and calls
   `useTxDecode`. It renders immediately on core, then overlays:
   `decodedInput = decode.decodedInput ?? tx.decodedInput`. Because
   `skipDecode` already yields `null`/`[]`, the existing render conditions need
   no change — `DecodedInputSection` stays hidden until decode lands, and
   `EventsSection` shows raw topics meanwhile.

6. **Honesty affordance.** While `state === "pending"`, `EventsSection` shows a
   quiet "decoding…" note. `useTxDecode` maps a `degraded: true` response (and a
   504/reject) to `state: "unavailable"`, and `EventsSection` then says decoding
   was unavailable rather than implying the transaction had nothing to decode.
   Because `degraded` can accompany a *partial* decode, the note reads "some
   events couldn't be decoded — source lookup unavailable" and coexists with the
   decoded rows that did resolve.

### Why not TanStack Query here

The project convention is TanStack for server state, and this page predates it.
Migrating is tempting but **actively dangerous for this query**: the client sets
`staleTime: Infinity` + `gcTime: Infinity` and persists to IndexedDB with
`maxAge: Infinity` (`main.tsx:50,100`). A decode that failed during an upstream
outage would be pinned forever, clearable only by bumping the `buster` string.
That is not hypothetical — `main.tsx:86` records this exact incident: "Blockscout
outage held empty records that `staleTime: Infinity` pinned". See
`[[project-idb-cache-poisoning]]`.

A decode result whose upstream is periodically sick is the **worst possible**
candidate for infinite persistence. Keeping it as a plain fetch hook keeps the
failure ephemeral: a reload retries. If this page is migrated to TanStack later,
the decode query must be explicitly excluded from dehydration or given a finite
`staleTime` — not inherited from the defaults.

## Error handling

| Case | Backend | Page |
|---|---|---|
| Core read fails / unknown hash | 404 or 504 as today | existing error state |
| Decode upstreams unreachable | `/decode` → 504 | core renders; "decoding unavailable" |
| Decode slow | `/decode` pending | core renders; "decoding…" |
| Nothing to decode (plain transfer) | `/decode` → 200, `null` / `[]` | no decode section — correct, not an error |

A failed decode never fails the page. A failed core read still does.

## Testing

- **API:** `?decode=0` returns `decodedInput: null` / `decodedLogs: []` and makes
  **zero** ABI lookups (inject a `fetchAbi` spy — the point is that it doesn't
  call, not merely that the field is null). `/decode` returns only the two
  fields; a timeout yields 504, never `[]`. Unknown hash → 404.
- **Web:** `TxDetail` renders core fields while decode is pending (assert an
  address/gas value is on screen with the decode promise unresolved); decoded
  names appear after it resolves; a rejected decode leaves the page rendered
  with raw topics and the unavailable note. Hash change mid-flight does not land
  a stale decode.
- **Regression control:** a plain value transfer still issues zero ABI lookups
  end-to-end (~0.35s), matching the control used in `98b71bc`.

## Success criteria

- The transaction page paints core facts without waiting on any verified-source
  upstream — the cold-container first paint drops from ~4.17s to ~0.35s.
- With both upstreams dead, the page still renders, and says decoding is
  unavailable rather than implying there was nothing to decode.
- No other consumer of `/api/tx` changes behavior.

## Out of scope

- The debugger (`StepDebugger`, `DebuggerView`, `logsByStep`), `TxPreview`, and
  the SDK's `FrameDetailPanel` also read `decodedLogs`. They stay on the complete
  payload by simply not passing `decode=0`. Revisit once this pattern is proven.
- Fixing Blockscout. Both hosts are unreachable; that is fleet work. This design
  makes the page immune to it, not the upstream healthy.
