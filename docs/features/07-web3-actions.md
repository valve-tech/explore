# Feature 7: Web3 Actions (Serverless Functions)

**Status: REMOVED (2026-10-17)**

The feature ran caller-supplied JavaScript with no auth and open network
access. The routes, executor, scheduler, web pages and tests are deleted.
The `actions` and `action_logs` tables stay in the database, unread, as
evidence. The text below is the old design, kept for history only.

## Overview
Serverless JavaScript/TypeScript functions that execute in response to on-chain events, new blocks, cron schedules, or inbound webhooks. Each function runs in a sandboxed environment with a pre-configured PulseChain RPC client.

## Endpoints
- `POST /api/actions` — Create a new action
- `GET /api/actions` — List all actions
- `GET /api/actions/:id` — Get action details
- `PUT /api/actions/:id` — Update action code or trigger
- `DELETE /api/actions/:id` — Delete action
- `POST /api/actions/:id/test` — Dry-run action with sample event
- `GET /api/actions/:id/logs` — Execution logs
- `POST /api/actions/:id/secrets` — Set secret env vars
- `POST /api/webhooks/:actionId` — Inbound webhook trigger

## Trigger Types
1. **Transaction** — fires when a tx matches filter (address, event, function)
2. **Block** — fires on every new block (or every Nth block)
3. **Periodic** — cron expression (e.g., `*/5 * * * *` for every 5 min)
4. **Webhook** — fires when POST received at unique webhook URL
5. **Alert** — fires when a monitoring alert (Feature 3) triggers

## Action Runtime
- Sandboxed Node.js (vm2 or isolated-vm)
- Pre-injected globals:
  - `context.rpc` — viem PublicClient pointed at PulseChain
  - `context.event` — the trigger event data
  - `context.secrets` — user-defined secrets (API keys, etc.)
  - `context.storage` — simple key-value store persisted between runs
- Allowed imports: viem, ethers (bundled)
- Execution timeout: 30 seconds
- Memory limit: 128MB

## Action Code Example
```typescript
export async function handler(context) {
  const { event, rpc, secrets } = context;

  // React to a large transfer
  const value = BigInt(event.args.value);
  if (value > BigInt("1000000000000000000000000")) {
    await fetch(secrets.SLACK_WEBHOOK, {
      method: "POST",
      body: JSON.stringify({
        text: `Large transfer: ${value} PLS from ${event.args.from} to ${event.args.to}`
      })
    });
  }
}
```

## Backend Architecture
- **Action store**: SQLite/PostgreSQL stores action code, triggers, secrets
- **Trigger matcher**: shares the block/log poller with Monitoring (Feature 3)
  - On new block/logs, check if any action triggers match
- **Executor**: runs action code in sandboxed VM
  - Captures console.log output
  - Catches errors, records execution time
  - Enforces timeout and memory limits
- **Cron scheduler**: node-cron or similar for periodic triggers
- **Webhook server**: unique URL per action, validates and dispatches
- **Log store**: execution logs with stdout, stderr, duration, success/failure

## Frontend Components
- **Actions list** — all actions with status (active/paused), trigger type, last run
- **Code editor** — Monaco editor with TypeScript support, syntax highlighting
- **Trigger config** — form to select trigger type and configure filters
- **Secrets manager** — add/remove encrypted environment variables
- **Execution logs** — scrollable log viewer with timestamps, status, output
- **Test runner** — paste sample event JSON, dry-run the action, see output

## Dependencies
- isolated-vm or vm2 for sandboxed execution
- node-cron for periodic triggers
- Shares poller infrastructure with Monitoring feature
