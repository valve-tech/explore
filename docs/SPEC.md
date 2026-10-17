# Explore — Full Specification

Explore (by Valve City) — a Tenderly.co equivalent, originally targeting PulseChain (rpc.pulsechain.com, chainId 369), now multichain.

## Feature Overview

| # | Feature | Status | Spec |
|---|---------|--------|------|
| 1 | [Transaction Simulator](features/01-transaction-simulator.md) | DONE | Simulate txs before sending on-chain |
| 2 | [Transaction Explorer/Decoder](features/02-transaction-explorer.md) | DONE | Decode and inspect any on-chain transaction |
| 3 | [Monitoring & Alerting](features/03-monitoring-alerting.md) | DONE | Watch addresses, contracts, events with notifications |
| 4 | [Virtual TestNets](features/04-virtual-testnets.md) | DONE | Forked PulseChain sandboxes for dev/test |
| 5 | [Smart Contract Debugger](features/05-debugger.md) | DONE | Opcode-level EVM debugger with gas profiler |
| 6 | [Enhanced Node RPC](features/06-enhanced-rpc.md) | DONE | JSON-RPC proxy with custom methods |
| 7 | [Web3 Actions](features/07-web3-actions.md) | REMOVED | Removed 2026-10-17: it ran caller-supplied code with no auth |

## Architecture

```
┌─────────────────────────────────────────────────┐
│                   Frontend (React)                │
│  Explorer │ Simulator │ Debugger │ Monitor │ IDE  │
└────────────────────┬────────────────────────────┘
                     │
┌────────────────────┴────────────────────────────┐
│                API Gateway (Node.js)             │
│  Auth │ Rate Limit │ Custom RPC │ WebSocket      │
└────────────────────┬────────────────────────────┘
                     │
┌──────┬──────┬──────┴──────┬──────────┬──────────┐
│Decode│ Sim  │  Debug/     │ Monitor  │ Actions  │
│  Svc │ Svc  │  Trace Svc  │   Svc    │   Svc    │
└──┬───┴──┬───┴──────┬──────┴────┬─────┴────┬─────┘
   │      │          │           │           │
┌──┴──────┴──────────┴───────────┴───────────┴─────┐
│          Data Layer                               │
│  PostgreSQL │ Redis │ ABI Cache │ Event Store     │
└──────────────────────┬───────────────────────────┘
                       │
┌──────────────────────┴───────────────────────────┐
│           PulseChain Infrastructure               │
│  rpc.pulsechain.com │ Reth Node (debug APIs)      │
│  api.scan.pulsechain.com (BlockScout)             │
└──────────────────────────────────────────────────┘
```

## Infrastructure Dependencies

- **Public RPC** (rpc.pulsechain.com): Explorer, Simulator (basic), Monitoring
- **Reth archive node**: Debug/trace APIs, deep simulation, gas profiling
- **BlockScout API** (api.scan.pulsechain.com): ABIs, verified source, internal txs, token data
- **Anvil/Hardhat**: Powers Virtual TestNet fork feature
- **PostgreSQL**: Persistent storage for alerts and user data (the `actions` and `action_logs` tables remain, unused)
- **Redis**: Caching, pub/sub for real-time features, job queues

## Tech Stack

- **Backend**: Node.js, Express, TypeScript, viem
- **Frontend**: React, Vite, Tailwind CSS v4, TypeScript
- **Data**: PostgreSQL, Redis, better-sqlite3 (for lightweight/initial phases)
- **Tooling**: Anvil (Foundry) for forked testnets
