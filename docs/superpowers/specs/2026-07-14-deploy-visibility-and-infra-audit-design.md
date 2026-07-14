# Deploy Visibility + Infra Audit Tooling — Design

**Date:** 2026-07-14
**Status:** Approved (design), pending implementation plan

## Motivation

Answering "is the latest online?" currently requires manual archaeology: diffing
the deployed `index.html` `last-modified` header against `git log` commit
timestamps, then hand-curling a grep-derived list of subdomains. That process is
fragile (a no-op rebuild moves the date; a CDN can lie) and non-repeatable
(nothing proactively told us the Reth snapshot hosts were down or the
`ipfs.explore` mirror was unpublished).

This spec closes three gaps, in dependency order:

- **A.** No build identifier in the running app.
- **B.** No way to ask the deployed app what version it is, and no signal to
  stale browser tabs.
- **C.** No source of truth for "what should be live," and no automated
  drift/uptime check.

## Non-Goals

- Changing the deploy pipeline itself (no Dockerfile exists in-repo; the prod box
  builds from git and serves `packages/web/dist` via Express static — that stays).
- Fixing the fleet-side infra outages the audit surfaced (Reth snapshots down,
  `ipfs.explore` unpublished, `one.valve.city/rpc` chain-369 routing). Those are
  server-side, out of this repo's lane; they are documented for the user to
  action separately.
- Any versioning of the published `@valve-tech/trace-sdk` package.

## A. Build-Version Stamp

A single resolver is the source of truth for build identity.

### `scripts/build-info.mjs`

Exports `resolveBuildInfo()` returning:

```js
{ sha, shortSha, commitISO, branch, builtAtISO }
```

Resolution order (never throws — degrades to `"unknown"`):

1. `process.env.BUILD_SHA` / `BUILD_COMMIT_ISO` / `BUILD_BRANCH` if set (lets an
   exotic deploy inject values without a `.git` dir).
2. `git rev-parse HEAD`, `git rev-parse --short HEAD`, `git show -s --format=%cI`,
   `git rev-parse --abbrev-ref HEAD` via `execSync` (wrapped in try/catch).
3. `{ sha: "unknown", shortSha: "unknown", commitISO: null, branch: "unknown" }`.

`builtAtISO` is stamped at resolve time. It is informational only — the drift
check compares `sha`, never `builtAtISO`, so a rebuild-without-change does not
register as drift.

### Web injection

`packages/web/vite.config.ts` imports the resolver and injects a compile-time
constant:

```js
define: { __BUILD_INFO__: JSON.stringify(resolveBuildInfo()) }
```

Runs in Node at build time (both the default BrowserRouter build and the
`VITE_IPFS` build), so the value is baked into the bundle. A new
`packages/web/src/lib/buildInfo.ts` reads `__BUILD_INFO__` and exposes a typed
`BUILD_INFO`, with a `declare global` for the `__BUILD_INFO__` symbol. In the
Vite dev server the constant is still defined (resolver runs against the working
tree), so dev shows a real short SHA or `"unknown"` on a dirty tree.

### API resolution

`packages/api/src/lib/buildInfo.ts` resolves once at module load using the same
env → git → `"unknown"` order (git is present on the build box; dev runs under
`tsx` where git is also present). Kept as a thin sibling rather than importing
the root `.mjs` to avoid cross-package path coupling; the logic is ~15 lines and
directly unit-testable.

## B. `/health` Version Field + Auto-Reload

### API

The existing `/health` handler (`packages/api/src/index.ts`, auth-bypassed) gains
a `version` field:

```json
{
  "status": "ok",
  "db": true,
  "chainsReady": true,
  "chains": [ ... ],
  "version": {
    "shortSha": "9400775",
    "sha": "9400775…",
    "commitISO": "2026-07-01T11:30:39-05:00",
    "builtAtISO": "2026-07-13T…"
  }
}
```

Liveness semantics are unchanged — `version` is additive; the DB gate still owns
the HTTP status. This makes the canonical check:

```bash
curl -s https://explore.valve.city/health | jq -r .version.sha   # == git rev-parse origin/main ?
```

The running SHA is also surfaced in the Settings/About UI for at-a-glance
inspection.

### Frontend auto-reload

The existing 15s `/health` poller in `packages/web/src/App.tsx` is extended (no
new poller). It already parses `{ status, db }`; it will additionally read
`data.version?.sha` and compare to the baked `BUILD_INFO.sha`.

On mismatch (both values known and different): schedule an auto-reload after a
5-second delay.

**Safety guard.** The reload is deferred while an interactive run is in flight,
to avoid destroying live work:

- an active fork simulation, transaction simulation, or debugger step run, OR
- a dirty (unsaved) transaction-builder form.

Implementation: a single app-wide "busy" signal that the relevant interactive
surfaces set/clear while a run or edit is active. The poller checks it; if busy,
it defers and re-evaluates on the next 15s poll instead of reloading. Once the
tab is idle, the pending reload fires. If the guard proves noisy in practice it
can be removed for an unconditional reload (the user explicitly accepted the
interruption risk).

Only the mismatch → reload path is new; the existing connected/disconnected
status handling is untouched.

## C. Endpoint Manifest + Scheduled Monitor

### `infra/endpoints.json`

The single source of truth we lacked. An array of entries:

```json
{
  "name": "explore (frontend + API)",
  "url": "https://explore.valve.city/",
  "method": "GET",
  "category": "frontend",
  "expect": 200,
  "owner": "repo",
  "notes": "Express serves web/dist; /api same-origin"
}
```

- `expect`: an HTTP status code, or one of `"auth-gated"` (alive iff it returns a
  well-formed JSON-RPC/GraphQL auth error), `"grpc"` (alive on 200/415), or
  `"not-live"` (expected to be down/unresolvable today — e.g. the unpublished
  `ipfs.explore` mirror).
- `owner`: `repo` (this codebase deploys it) vs `fleet` (server-side infra).

Seeded from today's audit. Categories: `frontend`, `api`, `rpc`, `substreams`,
`icons`, `snapshots`. Notable entries:

- `baked.valve.city` is **excluded** — it is only a unit-test fixture
  (`packages/web/src/__tests__/apiBase.extra.test.ts`), not a real host. A short
  comment block at the top of the manifest records this so it is not
  re-audited.
- Snapshot hosts: the old `evm{1,369,943}-snapshot-reth.valve.city` subdomains
  are stale. The user reports snapshots are now consolidated under a versioned
  path. **`TODO(user)`**: fill in the real scheme (e.g.
  `https://<host>/snapshots/<chainId>/<version>/…`). Until then the snapshot
  entries carry `"expect": "not-live"` with a `TODO` note so the monitor does not
  false-alarm.

### `scripts/check-infra.mjs`

Node, zero dependencies. Reads the manifest and:

1. Probes each host per its `method`, validating the response against `expect`
   (status match; auth-gated → recognizable auth-error JSON; grpc → 200/415;
   not-live → resolution failure is a pass).
2. For `frontend` + `api` entries, fetches `/health`, reads `version.sha`, and
   compares it to the expected SHA from `git ls-remote origin refs/heads/main`
   (overridable via `--expected <sha>`).
3. Prints a status table and exits non-zero if any host is unexpectedly down or
   the served SHA has drifted from `origin/main`.

This is today's manual audit, made repeatable and machine-checkable.

### Scheduled agent

After the script lands, a `/schedule` routine runs the check every 30 minutes
and surfaces drift/down. Alert channel is confirmed with the user at setup time;
default is a push notification (never Slack). The routine is set up
interactively, not committed as code.

## Testing

- **`scripts/build-info.mjs`** — unit test the resolver's env-override and
  `"unknown"` fallback branches (git branch is covered by running in-repo).
- **`packages/api/src/lib/buildInfo.ts`** — unit test env → git → unknown order.
- **`/health`** — API integration test asserts the `version` object shape and
  that liveness status is unchanged.
- **`packages/web/src/lib/buildInfo.ts`** + poller — web unit test: mismatch
  schedules a reload; matching SHA does not; busy guard defers. SDK coverage gate
  is unaffected (no SDK changes).
- **`scripts/check-infra.mjs`** — exercised against the live manifest as the
  acceptance check; a small unit test covers the `expect` matchers with mocked
  responses.

## Rollout / Sequencing

1. A (build-info resolver + injection) — nothing observable yet.
2. B (`/health` field + auto-reload) — depends on A.
3. C (manifest + check script) — depends on B for the SHA-drift comparison.
4. `/schedule` routine — after C, interactive.

Each step is independently shippable and green before the next.
