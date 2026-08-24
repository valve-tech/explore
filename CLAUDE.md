# Explore — multichain trace, simulate, debug

## Codebase Overview

**Product name:** Explore (by Valve City). Deployed at https://explore.valve.city.
The repo is named `explore`. (The published SDK package is still
`@valve-tech/trace-sdk` — renaming it is a separate, deliberate decision.)

Multichain block explorer + transaction simulator + opcode debugger.
Six features — transaction simulation, block explorer, monitoring/alerting,
virtual testnets (Anvil forks), smart contract debugger, and serverless Web3
Actions — delivered as a TypeScript monorepo. (The browser talks to purpose-built
REST endpoints only — there is no open JSON-RPC proxy; raw reads are a BYO-RPC
opt-in straight to the user's own node.)

**Chains served:** 1 (Ethereum), 369 (PulseChain), 943 (PulseChain Testnet v4),
11155111 (Sepolia). The original launch set — 1/369/943 — is specified in
`docs/superpowers/specs/2026-05-29-multichain-etherscan-labels-design.md`;
Sepolia joined once rpc.valve.city began serving it. **The backend registry
(`packages/api/src/services/chains/defaults.ts`) is authoritative** and must stay
in step with the gateway's own `config/chains.json` in the valve monorepo — that
file decides which chains rpc.valve.city actually serves, and registering a chain
here that isn't there fails at `getRpcClient`. `packages/web/src/lib/chains.ts`
mirrors the backend for the UI (picker, badges, labels); a test in each package
pins the id set, so adding a chain means editing both. Chain logos render via
[gib.show](https://gib.show) at `/image/<chainId>` (token art lives at
`/image/<chainId>/<address>`) — full API reference and prod-vs-staging notes
in [docs/GIB_SHOW.md](docs/GIB_SHOW.md).

**Chain scoping is a correctness property, not a feature.** Every cache keyed by
a transaction hash or an address MUST include the chain id. Two separate bugs
came from omitting it: migration 009 chain-scoped the address caches, and
migration 012 had to do the same for `trace_cache` plus the two in-process tracer
caches, which were serving one chain's trace to every chain. A tx hash is not a
cache identity on its own.

**Chain lives in the path as `/eip155/<id>/…`, and a chain-less URL is not a
bug.** The canonical scoped form is `/eip155/369/tx/0xabc` — two CAIP-2 path
segments, never the colon form (`docs/GIB_SHOW.md` records `/image/eip155:369`
returning 404 where the dash form returns 200).
`packages/web/src/lib/chainScope.ts` is the ONLY reader; `useActiveChainId()`
delegates to it and kept its old signature, so its ~40 call sites never moved.

**The namespace is a LITERAL route segment, and that is load-bearing.**
`App.tsx` mounts `<Route path="/eip155/:ref/*">`, one route per supported
namespace. A parameter route (`/:ns/:ref/*`) does NOT work: the outer `<Routes>`
ranks only its own routes and never sees the static segments inside
`AppRoutes`, so every two-segment URL — `/tx/0xabc`, `/workspace/abc` — would
match it with `ns="tx"` and render not-found. Adding a chain family later costs
one route line. An unregistered *reference* (`/eip155/8453/…`) renders
"Unsupported chain"; an unknown *namespace* (`/bip122/…`) falls through to
`AppRoutes`, matches nothing, and renders blank — accepted, because an app-wide
404 route is separate work.

**Anything that reads the path must strip the prefix first.**
`stripChainPrefix` exists for this. `ExplorerPanel` selects its view from
`location.pathname`, and without the strip every `/eip155/1/tx/0x…` rendered
Explorer Home.

**An unscoped URL means "every chain" on exactly three routes** —
`/address/:addr`, `/token/:addr`, `/block/:number` — which render every chain and
never redirect. Every other route collapses "all" to `DEFAULT_CHAIN_ID`.

**`useResolvedChainRedirect` is disabled when the URL names a chain by EITHER
mechanism** — a path prefix or a well-formed `?chainid=N`. An empty or malformed
`chainid` is deliberately NOT a scope: the hook resolves it and writes a real
chain. It still resolves a chain-less `/tx/0x…` and `/debugger/0x…`, because a
hash lives on exactly one chain, and it deliberately never fires for an address,
which is valid on all of them. Its invariants are pinned in
`__tests__/routingCharacterization.test.tsx` — do not weaken them.

**The API transport still uses `?chainid=N`.** Only the browser URL moved.
`scoped()` and `chainContext` are unchanged. The chain-agnostic endpoints
(`/api/resolve`, `/api/multichain/*`) ignore `chainid` by design and take an
optional `chains=1,369` allowlist, which is how the global testnet toggle
(`lib/settings/testnets.ts`) halves the fan-out. That toggle is a COST CONTROL,
not a preference — production has 429'd on Ethereum before, so the setting lives
in a module store the fetch layer can read, and the chain set sits in every
TanStack Query key so flipping it refetches instead of serving a stale answer.

Chain-aware routing has landed end to end. The chain picker, the Landing
search, and the ⌘K palette all resolve a pasted entity to the chain it lives
on and route straight there; the chain-agnostic endpoints (`/api/resolve`,
`/api/multichain/*`) back the three all-chain routes above. There is no
remaining "PulseChain as the live data source" fallback — every route now
either names a real chain or genuinely renders every chain.

**Stack:** React 19 + React Router 7 + Vite + Tailwind v4 + TanStack Query 5 (frontend), Express 4 + viem + Postgres (`pg`) (backend), Zod (validation), Anvil/Foundry (forks)

**Structure:**
- `packages/api/` — Express backend (port 10100), routes + services architecture (most services split into per-responsibility subdirectories)
- `packages/sdk/` — `@valve-tech/trace-sdk` published npm package (React components, hooks, parsers, risks); ESM-only, 100% coverage gate
- `packages/web/` — React SPA (router-based, 27 routes, mounted both bare and under the `/eip155/:ref/*` chain-scoped prefix), dark theme, TanStack Query persisted to IndexedDB
- `shared/` — PulseChain network constants (no build step)
- `docs/` — Product spec, per-feature specs, and [CODEBASE_MAP.md](docs/CODEBASE_MAP.md)

For detailed architecture, service dependencies, data flows, and gotchas, see [docs/CODEBASE_MAP.md](docs/CODEBASE_MAP.md).

## Quick Start

```bash
npm install
docker compose up -d postgres  # backing store
npm run dev                    # Starts API (port 10100) + Web (Vite) concurrently
npm run dev:api                # API only
npm run dev:web                # Frontend only
```

### Optional system deps

- **`heimdall-rs`** (decompiler) — install via [`bifrost`](https://github.com/Jon-Becker/heimdall-rs?tab=readme-ov-file#bifrost-installer) (`curl -L https://raw.githubusercontent.com/Jon-Becker/heimdall-rs/main/bifrost/install | bash && bifrost -t nightly`) or `cargo install heimdall-rs`. Used as a fall-through for unverified contracts on the storage-layout endpoint. Optional: the API degrades to the existing "not verified" message when heimdall isn't on PATH.

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `10100` | API server port |
| `DATABASE_URL` | `postgres://valvetech:valvetech@localhost:5432/valvetech` | Postgres connection |
| `PULSECHAIN_RPC_URL` | `https://rpc.pulsechain.com` | PulseChain RPC endpoint. Also the **key source for every sibling chain** — `valveRpcUrl` swaps the `/evm/369` tail, so one valve key covers 1/943/11155111. There is deliberately no `vk_demo` fallback: an unconfigured chain fails loudly at `getRpcClient` |
| `ETH_RPC_URL` / `PULSECHAIN_V4_RPC_URL` / `SEPOLIA_RPC_URL` | (derived from `PULSECHAIN_RPC_URL`) | Per-chain override, when a chain shouldn't reuse the PulseChain key/host |
| `DEBUG_RPC_URL` | (falls back to `PULSECHAIN_RPC_URL`) | Debug-enabled node for traces. **Chain 369 only** — every other chain uses its plain `rpcUrl` for `debug_*`, so the debugger there is only as capable as that endpoint |
| `DEBUG_RPC_BEARER` | (none) | `Authorization: Bearer` for a header-gated debug node. Silently 401s into "debug unavailable" if the node needs it and this is unset |
| `BLOCKSCOUT_API_URL` | `https://api.scan.pulsechain.com/api` | Verified-source fallback only (Sourcify is primary; explorer data is RPC + chifra) |

Local `.env` is auto-loaded by `dotenv/config` in `packages/api/src/index.ts`. `.env` is gitignored — never commit private RPC URLs or tokens.

## Testing

```bash
# API integration tests — require live server on :10100 + live PulseChain RPC
npm run test --workspace=packages/api

# SDK unit tests — vitest, 100% coverage gate
npm run test --workspace=packages/sdk

# Web unit tests — vitest + jsdom
npm run test --workspace=packages/web
```

API tests use Node's `node:test` against a live server. SDK and web tests use Vitest + Testing Library.

## Conventions

- **Per-responsibility splits.** Components and services over ~200 LOC live in a sibling directory: `Foo.tsx` (orchestrator) next to `Foo/` (split pieces). See `packages/web/src/components/debugger/StepDebugger/` for a fully-developed example (22 sub-files). When extracting, prefer one file per primitive over grouped helpers.
- **Backend** — Routes Zod-validate at the boundary (`routes/<name>/schemas.ts`), then call into services. `ApiError` + `respond` / `asyncRoute` from `packages/api/src/lib/respond.ts` standardize error envelopes; BigInts are serialized to strings before JSON responses; imports use `.js` extensions per ESM resolution.
- **SDK** — ESM-only, `.js` extensions in TS sources, 100% coverage threshold enforced (CI fails on any uncovered branch — extract genuinely-untestable paths into a pure helper, e.g. `src/util/errors.ts`).
- **Frontend** — TanStack Query for server state (persisted to IndexedDB, `staleTime: Infinity`); local `useState` for UI; CSS custom properties in `index.css` `@theme`; dark theme only; `void handler()` on async event handlers.

- **Plan execution is subagent-driven by default.** When executing an implementation plan from `docs/superpowers/plans/`, use subagent-driven development (a fresh subagent per task + review between tasks) without asking which mode to use. Only fall back to inline execution when explicitly requested.

For task-specific guidance ("how do I add an alert type / RPC method / SDK component"), see the **Navigation Guide** in [`docs/CODEBASE_MAP.md`](docs/CODEBASE_MAP.md).
