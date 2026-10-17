# Explore

**Explore** (by Valve City) — a multichain block explorer, transaction simulator, and opcode debugger, deployed at [explore.valve.city](https://explore.valve.city). Six developer tools — transaction simulation, block explorer, monitoring & alerting, virtual testnets (Anvil forks), smart-contract debugger and enhanced JSON-RPC proxy — delivered as a TypeScript monorepo plus a published `@valve-tech/trace-sdk` npm package.

## Packages

| Package | Purpose |
|---------|---------|
| [`packages/api/`](packages/api/) | Express 4 backend (port 10100). Routes + services architecture; most services split into per-responsibility subdirectories. Postgres via `pg` for persistence. |
| [`packages/web/`](packages/web/) | React 19 SPA, Vite dev server (port 11800). React Router v7 across 12 routes; TanStack Query persisted to IndexedDB. |
| [`packages/sdk/`](packages/sdk/) | [`@valve-tech/trace-sdk`](https://www.npmjs.com/package/@valve-tech/trace-sdk) — standalone EVM trace loaders, traversal, parsers, risk analysis, and React components. Published to npm; consumed internally by `packages/web`. ESM-only, MIT, 100% coverage gate. |
| [`shared/`](shared/) | PulseChain network constants (chain ID, RPC URL, BlockScout API). No build step. |

For full architecture, service dependencies, data flows, and gotchas, see [**`docs/CODEBASE_MAP.md`**](docs/CODEBASE_MAP.md).

## Quick start

```bash
# Install
npm install

# Bring up Postgres (the API requires it)
docker compose up -d postgres

# Run API + Web concurrently
npm run dev

# Or just one
npm run dev:api      # API on http://localhost:10100
npm run dev:web      # Web on http://localhost:11800
```

The Vite dev server proxies `/api`, `/rpc`, `/health`, and `/ws` to the API on `:10100`.

## Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `10100` | API server port |
| `DATABASE_URL` | `postgres://valvetech:valvetech@localhost:5432/valvetech` | Postgres connection |
| `PULSECHAIN_RPC_URL` | `https://rpc.pulsechain.com` | PulseChain RPC endpoint |
| `DEBUG_RPC_URL` | falls back to `PULSECHAIN_RPC_URL` | Debug-enabled node for `debug_*` methods |
| `BLOCKSCOUT_API_URL` | `https://api.scan.pulsechain.com/api` | BlockScout REST API for ABIs + explorer data |

Local `.env` is auto-loaded by `dotenv/config` in `packages/api/src/index.ts`. `.env` is gitignored — never commit private RPC URLs or tokens.

## Testing

```bash
# API integration tests — require a live API server on :10100 + live PulseChain RPC
npm run test --workspace=packages/api

# SDK unit tests — Vitest; 100% coverage threshold enforced (CI fails on any uncovered branch)
npm run test --workspace=packages/sdk

# Web unit tests — Vitest + Testing Library + jsdom
npm run test --workspace=packages/web
```

The API tests use Node's built-in `node:test`; SDK and web tests use Vitest. Postgres needs to be running for the API tests.

## Architecture in one diagram

```
┌──────────────┐       ┌──────────────────────┐       ┌─────────────────┐
│  packages/   │       │  packages/api        │       │  PulseChain RPC │
│  web (Vite)  ├──────►│  (Express, :10100)   ├──────►│  + BlockScout   │
│  React 19    │       │                      │       │  + Sourcify     │
└──────┬───────┘       └─────┬────────┬───────┘       └─────────────────┘
       │                     │        │
       │ imports             │        │
       ▼                     ▼        ▼
┌──────────────┐       ┌──────────┐  ┌──────────────────┐
│ packages/sdk │       │ Postgres │  │ Anvil forks      │
│ (npm pkg)    │       │ (pg)     │  │ (one per testnet)│
└──────────────┘       └──────────┘  └──────────────────┘
```

Each PulseChain interaction passes through the SDK's normalization layer so the same `TraceFrame` / `OpcodeStep` shapes power the web UI and external SDK consumers.

## Tech stack

| Layer | Tech |
|-------|------|
| Frontend | React 19, React Router 7, Vite 6, Tailwind CSS v4, TanStack Query 5 |
| Backend | Express 4, TypeScript, Node 22, `pg` (Pool) |
| SDK | TypeScript, viem (peer), React (optional peer), Vitest + Testing Library |
| Ethereum | viem 2.23+, Anvil/Foundry (forks), Slither via Docker |
| Validation | Zod |
| Database | Postgres (JSONB columns, advisory-lock-guarded migrations) |
| Real-time | WebSocket `/ws/alerts` |
| Deploy | Railway via `packages/api/Dockerfile` (multi-stage, Node 22 alpine) |

## Conventions

- **Per-responsibility splits** — any component or service over ~200 LOC tends to live in a sibling directory: `Foo.tsx` (orchestrator) next to `Foo/` (split pieces). See `packages/web/src/components/debugger/StepDebugger/` for a fully-developed example.
- **Backend** — Express routes wire Zod validation to service-layer functions; `ApiError` + `respond.fail` in `packages/api/src/lib/respond.ts` standardize error envelopes; BigInts are serialized to strings before JSON responses.
- **Frontend** — TanStack Query for server state with IDB persistence; local `useState` for UI; CSS custom properties in `index.css` `@theme` block (dark theme only).
- **SDK** — ESM-only, `.js` extensions in TypeScript imports, headless components themed via `classNames` slot prop.

## SDK (external consumers)

```bash
npm install @valve-tech/trace-sdk viem
```

```ts
import { loadTraceFromHash, parseSwaps, RisksWidget } from "@valve-tech/trace-sdk";
```

See [`packages/sdk/README.md`](packages/sdk/README.md) for the SDK-specific docs.

## License

The `@valve-tech/trace-sdk` npm package is MIT-licensed; see [`packages/sdk/LICENSE`](packages/sdk/LICENSE). The rest of the repository is private to Valve Tech.
