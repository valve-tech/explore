# Design: Multichain Entity Routing and the All-Chain Address View

## Overview

Explore serves four chains but presents one at a time. Two defects follow from
that, and this spec fixes both.

1. **The chain hides in a query parameter.** `?chainid=N` is a second-class
   scope. It does not compose with routing, it forces the
   `useResolvedChainRedirect` dance on every deep link, and it has no room for a
   non-EVM chain. This spec moves the chain into the path as
   `/eip155/369/tx/0x…`.
2. **A chain-less address page lies.** `/address/0x11490E…` renders PulseChain
   and offers no way to see or reach the other three chains. This spec makes a
   chain-less address URL mean *every* chain, and renders one page that says
   where the address lives.

A third change falls out of the second. The fan-out multiplies RPC cost, and the
production RPC has 429'd before. A global testnet toggle halves the fan-out and
therefore belongs in this spec as a cost control, not as a preference.

## Goals and Non-Goals

### Goals

- One canonical way to say "this page is about chain N", usable by every route.
- A URL scheme that admits a non-EVM chain without a second migration.
- A chain-less address URL that answers "where does this address live?".
- A single row component shared by chain lists, transaction lists, and block
  lists.
- No increase in RPC cost for a page that names its chain.
- A bounded, reported increase for a page that does not.

### Non-Goals

- **The API transport does not change.** Requests keep carrying `?chainid=N`
  through `scoped()`. Only the browser URL moves. This keeps `chainContext`,
  `strictChainId`, `lib/chainParam.ts`, and every API test untouched.
- **We do not add a non-EVM chain.** We only stop the URL from excluding one.
- **We do not build cross-chain pagination.** The merged feed covers a recent
  window. Paging deeper picks a chain.
- **We do not build a light theme.** The testnet toggle needs a home in the app
  footer. A theme switch is separate work.
- **We do not deprecate bare EIP-3091 paths.** Wallets emit them. They stay
  valid forever.

## Part 1 — The URL scheme

### Canonical form

```
/{namespace}/{reference}/{route}
```

`namespace` and `reference` are the two halves of a CAIP-2 chain id, written as
separate path segments. The colon form is not used. `docs/GIB_SHOW.md` records
`/image/eip155:369` returning 404 while `/image/eip155-369` returns 200, which
is direct evidence that the colon does not survive real infrastructure.

```
/eip155/369/tx/0xabc…            /eip155/1/address/0x11490E…
/eip155/943/block/26923553       /eip155/369/debugger/0xabc…/state
/eip155/369/network-health       /eip155/1/mempool
```

The prefix scopes any chain-scoped route, not only EIP-3091 entities. That is
the unification: one grammar for every page that is about a chain.

A future non-EVM chain needs no route work:

```
/bip122/000000000019d6689c085ae165831e93/tx/4a5e1e4b…
```

### Unscoped forms

Every unscoped form stays valid. Each means something specific.

| URL | Meaning | Behaviour |
|---|---|---|
| `/address/0x…` | all chains | terminal — renders the aggregate view, never redirects |
| `/token/0x…` | all chains | terminal — same contract address can exist on several chains |
| `/tx/0x…` | unknown chain | resolve, then rewrite to `/eip155/<n>/tx/0x…` |
| `/block/0x<hash>` | unknown chain | resolve, then rewrite |
| `/block/<number>` | all chains | terminal — renders the height on every chain |
| `…?chainid=N` | legacy | rewrite once to the path form |

`/tx/0x…` resolves because a 32-byte hash realistically exists on exactly one
chain. `/address/0x…` does not resolve because an address is valid on all of
them; "which one" is the wrong question and the aggregate view answers the right
one.

### Router structure

`App.tsx` declares the route table once, in an `<AppRoutes />` component. The
table is mounted twice:

```tsx
<Routes>
  {/* One literal route per supported namespace. */}
  <Route
    path="/eip155/:ref/*"
    element={<ChainScopedRoutes namespace="eip155"><AppRoutes /></ChainScopedRoutes>}
  />
  <Route path="/*" element={<AppRoutes />} />
</Routes>
```

`ChainScopedRoutes` takes its namespace as a prop, validates the reference
against the registry, and renders `<AppRoutes />`. An unregistered reference
renders not-found rather than falling through — falling through would render the
page against the default chain and quietly answer a question nobody asked.

**The namespace is a literal, not a parameter, and that is load-bearing.** A
`/:ns/:ref/*` route does not work: the outer `<Routes>` ranks only its own two
routes and never sees the static segments inside `AppRoutes`, so every
two-segment URL — `/tx/0xabc`, `/workspace/abc`, `/block/123` — matches it with
`ns="tx"` and renders not-found. A static first segment ranks correctly against
`/*`, so a legacy URL never matches the scoped route at all. Adding a namespace
later costs one route line. A test pins the ranking against an inner route table
that mirrors the real one.

An unknown namespace (`/bip122/…`) therefore falls through to `AppRoutes` and
matches nothing, rather than rendering "Unsupported chain". An unregistered
*reference* (`/eip155/8453/…`) still renders it, which is the case a user can
actually produce by editing a URL.

### Both routers keep working

`main.tsx` picks `BrowserRouter` or `HashRouter` from `VITE_IPFS`. The path
prefix parses identically under both: `/#/eip155/369/tx/0x…` is a hash path, and
React Router reads it the same way.

One trap. `getActiveChainId()` currently reads the chain from the query *inside*
the hash:

```ts
const search = window.location.search || window.location.hash.split("?")[1] || "";
```

Path-based chain means the new parser must read the hash **path**, not only its
query. `packages/web/src/__tests__/activeChain.test.ts` already covers both
router shapes. Those cases get extended rather than replaced.

A second trap. `main.tsx` already runs a one-time `#/foo` → `/foo` rewrite on
the canonical build. The new legacy `?chainid` rewrite must run after it, not
against it. A test pins the order.

## Part 2 — Chain-scope plumbing

### One reader

New module `packages/web/src/lib/chainScope.ts`. It is the only code that
decides what chain a page is about.

```ts
export type ChainScope =
  | { kind: "one"; chainId: number }
  | { kind: "all" };
```

Resolution order, highest first:

1. the path prefix (`/eip155/369/…`)
2. the `?chainid=N` query parameter (legacy)
3. unscoped → `{ kind: "all" }`

Only three routes render an unscoped scope: `/address/:addr`, `/token/:addr`,
and `/block/:number`. Every other route treats `{ kind: "all" }` as
`DEFAULT_CHAIN_ID`, which is exactly today's behaviour. `useActiveChainId()`
performs that collapse, which is why its signature can stay `number`.

`useActiveChainId()` keeps its exact signature and delegates here, so its ~40
call sites do not move. `getActiveChainId()` does the same for fetch-layer code
outside a component. A new `useChainScope()` exposes the full scope for the
pages that can render "all".

### One path builder

`lib/scanRoutes.ts` gains the chain argument and stays the only place that
builds these paths:

```ts
export function scanPath(kind: ScanKind, value: string, chainId?: number): string
```

Omitting `chainId` produces the bare form. Passing it produces the prefixed
form. No call site concatenates an entity path by hand.

### The registry carries the mapping

`packages/web/src/lib/chains.ts` and
`packages/api/src/services/chains/defaults.ts` each gain a CAIP-2 field:

```ts
caip2: { namespace: "eip155", reference: "369" }
```

The mapping is data. No call site builds `"eip155/" + chainId`. A test in each
package pins the field alongside the existing chain-id set test.

### Legacy parameter rewrite

A `<LegacyChainParamRedirect>` component sits above the route table. When the
URL carries `?chainid=N` **and** the path has no namespace prefix, it rewrites
once with `replace: true` and strips the parameter. The prefix condition is what
makes a redirect loop impossible, and it mirrors the existing rule in
`useResolvedChainRedirect`.

## Part 3 — The all-chain address view

### Two backend endpoints

Both are chain-agnostic. They ignore `chainid`, exactly as `/api/resolve`
already does. Both fan out over `listChains()` with
`runWithChain(chainId, …)`, which is already the seam that binds a chain to
deep service code.

```
GET /api/multichain/address/:addr?chains=1,369
  → { chains: [{ chainId, balance, nonce, isContract, error? }] }

GET /api/multichain/address/:addr/activity?limit=25&chains=1,369
  → { rows: [{ chainId, …AddressTransaction }],
      perChain: [{ chainId, returned, error? }] }
```

`chains` is an optional comma-separated allowlist. The client sends it to carry
the testnet toggle (Part 4). Omitting it probes every registered chain. An
unregistered id in the list is a 400, not a silent drop.

A per-chain failure returns `{ chainId, error: true }`. It never fails the
request. The UI renders that chain as unavailable, which is a different and
honest fact from "not present".

### The fan-out budget

Naively the address page goes from 2 RPC calls to 4 chains × ~5 calls. The
production RPC has 429'd on Ethereum before — `defaults.ts` carries a comment
about it — so the budget is a requirement, not an optimisation.

Four controls, in order of what they save:

1. **Two-phase fan-out.** Phase one is the cheap presence probe: `getCode`,
   `getBalance`, `getTransactionCount`, batched into one call per chain. Only
   chains that report presence get the expensive activity fetch. A typical
   address is present on one or two chains, so real cost is ~4 cheap calls plus
   1–2 expensive ones.
2. **Presence cache.** Presence changes slowly. A short-TTL cache keyed
   `chainId|address` collapses repeat loads. **The chain id is part of the key**
   — see the chain-scoping invariant in `CLAUDE.md`, which two production bugs
   have already taught us.
3. **One service, two callers.** `/api/resolve` performs this exact probe today
   and discards the answer. The presence endpoint and the resolver share one
   service and one cache.
4. **Testnet scope.** With testnets off the fan-out covers 2 chains, not 4.
   See Part 4.

`resolveEntity` already applies a 7s per-chain timeout and treats failure as
"not here". The new endpoints inherit the timeout and **report** the failure
instead of swallowing it.

### The frontend

`ExplorerPanel` gains an "all" scope. A bare `/address/0x…` renders
`MultiChainAddressView`; a scoped one renders today's `AddressView` unchanged.

New files under `components/explorer/MultiChainAddressView/`:

- `ChainPresenceStrip.tsx` — one row per chain with presence, a collapsed
  "not here" line for the rest
- `MergedActivityFeed.tsx` — chain-tagged rows, merged by timestamp
- `ChainScopeButtons.tsx` — the "page deeper on one chain" footer

### The row component

One row shape serves the chain strip, the merged feed, and the block
disambiguation page. It is **two lines and never three**:

- **Main line** — the answer. Chain name, or transfer amount and counterparty.
- **Subline** — the qualifiers. Nonce and account type, or chain, method, and
  hash.
- **Row fill** — a background fill whose width is that row's share. Activity
  share on the address page, gas used on the block page. It costs no extra
  column and no extra line, and the ranking reads before any digit does.

Detail beyond the subline goes in a tooltip through the existing
`components/primitives/Tooltip`.

Chain logos and token art come from gib.show through the existing
`chainLogoUrl()` and `TokenImage`. Note that `/image/943` returns bytes
identical to `/image/369` — the testnet has no distinct logo — so a testnet
glyph is dimmed to stay distinguishable.

### The redirect hook changes

`useResolvedChainRedirect` stops firing for addresses. That single change is
what fixes the reported page. It keeps firing for transaction hashes and block
hashes.

This hook carries three invariants in its docblock, and two production bug fixes
sit on it:

1. It runs only when `chainid` is absent. An explicit chain is the caller's
   stated scope.
2. Its `"resolving"` state must gate the entity fetch. The redirect lands one
   render after the resolve returns.
3. It redirects only when the entity is not on the default chain.

Each invariant becomes a named test **before** the hook changes. The change gets
its own commit and is revertible independently of the routing work.

## Part 4 — The global testnet toggle

### Why it is in this spec

The toggle looks like a display preference. It is a cost control. With testnets
off, every chain-less page probes 2 chains instead of 4. That halves the RPC
cost of the feature this spec adds.

### Where it lives

- **Source of truth:** `packages/web/src/lib/settings/` — persisted to
  `localStorage`, exposed through a hook.
- **Control:** the app footer, as a labelled toggle, plus the same control in
  `/settings`. Both read and write the one store.
- **Not component state.** The API client must read it, or the server still
  probes every chain and the saving never happens.

### What it affects

- `CHAINS` filtering in the picker, `ChainSelector`, and every chain list
- the `chains` query parameter sent to the two multichain endpoints
- the chain strip and the merged feed

### What it does not affect

An explicit testnet URL still works. `/eip155/943/tx/0x…` renders with testnets
hidden, because the URL is a stated scope and outranks a display preference. The
page shows a dismissible note that it is on a hidden chain.

There is no light/dark toggle to sit beside. `index.css` defines one theme and
`CLAUDE.md` states dark only. The footer is built to hold a second control, and
building one is separate work.

## Testing

The codebase is large and two of these files carry bug-fix history. The test
strategy is therefore characterization-first.

### Before any change

Write tests that pin current behaviour. These stay green through every phase.

- `activeChain.ts` — both router shapes, default-chain omission, the
  `?chainid=` empty-string case its comments call out
- `scanPath` — every kind produces today's path
- `scoped()` — the default chain omits the parameter
- `useResolvedChainRedirect` — the three invariants above, one named test each

### New tests

| Area | Cases |
|---|---|
| `chainScope` | path beats parameter; unknown namespace; malformed reference; both routers |
| route ranking | `/settings` and `/workspace/:id` beat `/:ns/:ref/*` |
| legacy rewrite | fires once; never fires when a prefix is present; runs after the hash rewrite |
| aggregate view | renders with one chain erroring; renders with zero presence |
| address redirect | a bare address URL does **not** redirect |
| multichain endpoints | a chain whose RPC throws; a chain with no presence; cache key includes the chain id |
| testnet toggle | filters the fan-out; an explicit testnet URL still renders |

### Documentation

`CLAUDE.md` states the deep-link rule and the `useResolvedChainRedirect`
invariants. Both change here. The paragraph gets rewritten in the same commit as
the behaviour, not afterwards.

## Phases

Each phase ships alone.

**Phase 1 — routing.** `chainScope`, the route wrapper, the legacy rewrite,
`scanPath`, the registry CAIP-2 field. Characterization tests first. **This
phase changes no rendering.** If it moves a pixel, it is wrong.

**Phase 2 — endpoints.** The two multichain endpoints, the shared presence
service, and the cache. No UI.

**Phase 3 — the view.** `MultiChainAddressView`, the two-line row, the presence
strip, the merged feed. Behind a flag. The `useResolvedChainRedirect` address
change lands here, in its own commit.

**Phase 4 — reuse.** The slim "also on" bar on scoped pages, the
`/block/<number>` page, and the testnet toggle.

## Risks

**Phase 1 touches every internal link.** Mitigated because construction already
funnels through `scanPath` and `scoped`. We extend those two rather than editing
call sites.

**The redirect hook has bug-fix history.** Mitigated by pinning its three
invariants as tests first, and by isolating the change in its own commit.

**The fan-out can be slow even when it is cheap.** Four chains at a 7s timeout
is a 7s worst case. The presence strip renders per-chain rows as they settle
rather than waiting for the slowest.

**gib.show cannot disambiguate protocol types.** `docs/GIB_SHOW.md` records that
numeric chain ids are not unique across `evm | btc | solana | tvm`. Our registry
is EVM-only, so we have no exposure today. A future `bip122` chain will need a
different image source, and the row component must not assume otherwise.
