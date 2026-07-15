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

**Multichain launch set** (per `docs/superpowers/specs/2026-05-29-multichain-etherscan-labels-design.md`):
chains 1 (Ethereum), 369 (PulseChain), 943 (PulseChain Testnet). The frontend
chain registry lives in `packages/web/src/lib/chains.ts`; chain logos render
via [gib.show](https://gib.show) at `/image/<chainId>` (token art lives at
`/image/<chainId>/<address>`) — full API reference and prod-vs-staging notes
in [docs/GIB_SHOW.md](docs/GIB_SHOW.md).

The dispatcher refactor to `?chainid=N` routing is in flight on the API side;
the frontend ChainSelector + Landing/AppShell rebrand is UI-only for now and
defaults to "All chains" with PulseChain as the live data source until the
backend lands chain-aware routing.

**Stack:** React 19 + React Router 7 + Vite + Tailwind v4 + TanStack Query 5 (frontend), Express 4 + viem + Postgres (`pg`) (backend), Zod (validation), Anvil/Foundry (forks)

**Structure:**
- `packages/api/` — Express backend (port 10100), routes + services architecture (most services split into per-responsibility subdirectories)
- `packages/sdk/` — `@valve-tech/trace-sdk` published npm package (React components, hooks, parsers, risks); ESM-only, 100% coverage gate
- `packages/web/` — React SPA (router-based, 12 routes), dark theme, TanStack Query persisted to IndexedDB
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
| `PULSECHAIN_RPC_URL` | `https://rpc.pulsechain.com` | PulseChain RPC endpoint |
| `DEBUG_RPC_URL` | (falls back to `PULSECHAIN_RPC_URL`) | Debug-enabled node for traces |
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
