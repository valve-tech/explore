# Deploy Visibility + Infra Audit Tooling — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "is the latest online?" a one-command check by stamping the build SHA into the running app, exposing it on `/health`, and adding a manifest-driven infra audit script.

**Architecture:** A single zero-dependency resolver (`scripts/build-info.mjs`) reads the git SHA at build time. Vite bakes it into the web bundle via `define`; the API resolves it at boot and adds it to the existing `/health` payload. The web app's existing 15s `/health` poller compares served vs. baked SHA and auto-reloads stale tabs. A committed `infra/endpoints.json` manifest drives `scripts/check-infra.mjs`, which probes every host and diffs the served SHA against `origin/main`.

**Tech Stack:** Node 20+ ESM (`node:test`, `node:child_process`), Express 4, Vite 7 (`define`), React 19, TanStack Query 5, Vitest, `tsx --test`.

**Spec:** `docs/superpowers/specs/2026-07-14-deploy-visibility-and-infra-audit-design.md`

## Global Constraints

- **ESM everywhere.** TS sources import with `.js` extensions (API/SDK convention). Root scripts are `.mjs`.
- **Zero new dependencies.** Every task uses built-ins (`node:test`, `node:child_process`, `fetch`) or already-installed packages. Do not `npm install` anything.
- **Resolvers never throw.** Build-info resolution degrades to `"unknown"`; a missing `.git` or missing `git` binary must not crash the API or a build.
- **`/health` liveness semantics are unchanged.** `version` is purely additive; the DB check still owns the HTTP status (200 vs 503).
- **No refs to smuggle derived state.** Derive in render; use effects only for real side effects (timers). Extract decision logic into pure helpers and test those.
- **Tailwind spacing:** never `gap-[1235]` / `space-y-[4-8]` (enforced by `npm run lint:spacing`); padding is `p-2`/`p-4`, never `p-6+`.
- **Borders:** outset `box-shadow` + 1px gap, never CSS `border` or inset shadow.
- **File paths are repo-relative to** `/Users/michaelmclaughlin/Documents/valve-tech/github/trace`.

## File Structure

| File | Responsibility |
|---|---|
| `scripts/build-info.mjs` (create) | Shared resolver: env → git → `"unknown"`. Sole source of build identity. |
| `scripts/build-info.d.mts` (create) | Types so `vite.config.ts` can import the `.mjs` under `tsc -b`. |
| `scripts/build-info.test.mjs` (create) | `node:test` unit tests for all three resolution branches. |
| `packages/api/src/lib/buildInfo.ts` (create) | API-side resolver + memoized `getBuildInfo()`. |
| `packages/api/src/index.ts` (modify) | Add `version` to the `/health` payload. |
| `packages/web/vite.config.ts` (modify) | Inject `define: { __BUILD_INFO__ }` at build time. |
| `packages/web/src/lib/buildInfo.ts` (create) | Typed access to the baked `__BUILD_INFO__`. |
| `packages/web/src/components/settings/SettingsPanel.tsx` (modify) | Add a `BuildSection` card showing the running commit. |
| `packages/web/src/lib/versionDrift.ts` (create) | Pure decision helpers: `hasDrifted`, `shouldReloadNow`. |
| `packages/web/src/App.tsx` (modify) | Read `version.sha` in the existing poller; schedule the reload. |
| `infra/endpoints.json` (create) | Source of truth for what should be live. |
| `scripts/check-infra.mjs` (create) | Probe the manifest; diff served SHA vs `origin/main`; exit non-zero on drift/down. |
| `scripts/check-infra.test.mjs` (create) | `node:test` unit tests for the `expect` matchers. |
| `package.json` (modify) | Add `test:scripts` and `check:infra`. |

---

### Task 1: Shared build-info resolver

**Files:**
- Create: `scripts/build-info.mjs`
- Create: `scripts/build-info.d.mts`
- Test: `scripts/build-info.test.mjs`
- Modify: `package.json` (add `test:scripts`)

**Interfaces:**
- Consumes: nothing.
- Produces: `resolveBuildInfo({ env?, now?, runGit? }) => { sha: string, shortSha: string, commitISO: string | null, branch: string, builtAtISO: string }`. Task 3 imports this from `vite.config.ts`. Task 2 mirrors its logic and shape.

- [ ] **Step 1: Write the failing test**

Create `scripts/build-info.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveBuildInfo } from "./build-info.mjs";

const NOW = () => "2026-07-14T00:00:00.000Z";
const noGit = () => null;

test("env override wins over git", () => {
  const info = resolveBuildInfo({
    env: {
      BUILD_SHA: "abc1234def5678",
      BUILD_COMMIT_ISO: "2026-07-01T11:30:39-05:00",
      BUILD_BRANCH: "main",
    },
    now: NOW,
    runGit: () => assert.fail("git must not be called when BUILD_SHA is set"),
  });
  assert.equal(info.sha, "abc1234def5678");
  assert.equal(info.shortSha, "abc1234");
  assert.equal(info.commitISO, "2026-07-01T11:30:39-05:00");
  assert.equal(info.branch, "main");
  assert.equal(info.builtAtISO, "2026-07-14T00:00:00.000Z");
});

test("env override without optional vars degrades those fields only", () => {
  const info = resolveBuildInfo({ env: { BUILD_SHA: "abc1234def5678" }, now: NOW, runGit: noGit });
  assert.equal(info.sha, "abc1234def5678");
  assert.equal(info.commitISO, null);
  assert.equal(info.branch, "unknown");
});

test("falls back to git when no env override", () => {
  const answers = {
    "rev-parse HEAD": "9400775aaaabbbbccccdddd",
    "show -s --format=%cI HEAD": "2026-07-01T11:30:39-05:00",
    "rev-parse --abbrev-ref HEAD": "main",
  };
  const info = resolveBuildInfo({ env: {}, now: NOW, runGit: (args) => answers[args] ?? null });
  assert.equal(info.sha, "9400775aaaabbbbccccdddd");
  assert.equal(info.shortSha, "9400775");
  assert.equal(info.commitISO, "2026-07-01T11:30:39-05:00");
  assert.equal(info.branch, "main");
});

test("degrades to unknown when git is unavailable", () => {
  const info = resolveBuildInfo({ env: {}, now: NOW, runGit: noGit });
  assert.deepEqual(info, {
    sha: "unknown",
    shortSha: "unknown",
    commitISO: null,
    branch: "unknown",
    builtAtISO: "2026-07-14T00:00:00.000Z",
  });
});

test("resolveBuildInfo never throws when git throws", () => {
  const info = resolveBuildInfo({
    env: {},
    now: NOW,
    runGit: () => { throw new Error("git: command not found"); },
  });
  assert.equal(info.sha, "unknown");
});
```

- [ ] **Step 2: Add the `test:scripts` runner**

In `package.json`, add to `"scripts"` (after `"test:sdk"`):

```json
"test:scripts": "node --test scripts/",
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test:scripts`
Expected: FAIL — `Cannot find module '.../scripts/build-info.mjs'`.

- [ ] **Step 4: Write minimal implementation**

Create `scripts/build-info.mjs`:

```js
/**
 * Build identity — the single source of truth for "what commit is this?".
 *
 * Resolution order (never throws): BUILD_SHA env override → git → "unknown".
 * The env override exists so a deploy without a .git dir can still stamp a
 * real SHA. `builtAtISO` is informational only — the drift check compares
 * `sha`, so a rebuild-without-change never registers as drift.
 */
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const UNKNOWN = "unknown";

/** Run a git command in the repo root. Returns trimmed stdout, or null on any failure. */
export function runGit(args) {
  try {
    const out = execSync(`git ${args}`, {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.trim() || null;
  } catch {
    return null;
  }
}

export function resolveBuildInfo({
  env = process.env,
  now = () => new Date().toISOString(),
  runGit: git = runGit,
} = {}) {
  const builtAtISO = now();

  const call = (args) => {
    try {
      return git(args);
    } catch {
      return null;
    }
  };

  if (env.BUILD_SHA) {
    const sha = env.BUILD_SHA;
    return {
      sha,
      shortSha: sha.slice(0, 7),
      commitISO: env.BUILD_COMMIT_ISO ?? null,
      branch: env.BUILD_BRANCH ?? UNKNOWN,
      builtAtISO,
    };
  }

  const sha = call("rev-parse HEAD");
  if (sha) {
    return {
      sha,
      shortSha: sha.slice(0, 7),
      commitISO: call("show -s --format=%cI HEAD"),
      branch: call("rev-parse --abbrev-ref HEAD") ?? UNKNOWN,
      builtAtISO,
    };
  }

  return { sha: UNKNOWN, shortSha: UNKNOWN, commitISO: null, branch: UNKNOWN, builtAtISO };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test:scripts`
Expected: PASS — 5 tests passing.

- [ ] **Step 6: Add type declarations for the TS consumer**

Create `scripts/build-info.d.mts` (so `vite.config.ts` type-checks under `tsc -b` in Task 3):

```ts
export interface BuildInfo {
  sha: string;
  shortSha: string;
  commitISO: string | null;
  branch: string;
  builtAtISO: string;
}

export interface ResolveBuildInfoOptions {
  env?: Record<string, string | undefined>;
  now?: () => string;
  runGit?: (args: string) => string | null;
}

export function runGit(args: string): string | null;
export function resolveBuildInfo(options?: ResolveBuildInfoOptions): BuildInfo;
```

- [ ] **Step 7: Sanity-check the real resolver against this repo**

Run: `node -e "import('./scripts/build-info.mjs').then(m => console.log(m.resolveBuildInfo()))"`
Expected: prints an object whose `shortSha` matches `git rev-parse --short HEAD` and whose `branch` is `main`.

- [ ] **Step 8: Commit**

```bash
git add scripts/build-info.mjs scripts/build-info.d.mts scripts/build-info.test.mjs package.json
git commit -m "feat(build): git-backed build-info resolver with env override"
```

---

### Task 2: API build info + `/health` version field

**Files:**
- Create: `packages/api/src/lib/buildInfo.ts`
- Test: `packages/api/tests/unit/buildInfo.test.ts`
- Modify: `packages/api/src/index.ts` (imports; `/health` handler at ~line 83)
- Test: `packages/api/tests/integration.test.ts` (append a describe block)

**Interfaces:**
- Consumes: nothing from Task 1 at runtime (mirrors its shape; kept as a thin sibling to avoid cross-package path coupling into a root `.mjs`).
- Produces: `getBuildInfo(): BuildInfo` and the `/health` response field `version: BuildInfo`, where `BuildInfo = { sha: string, shortSha: string, commitISO: string | null, branch: string, builtAtISO: string }`. Task 4 and Task 6 both read `version.sha`.

- [ ] **Step 1: Write the failing unit test**

Create `packages/api/tests/unit/buildInfo.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveBuildInfo, getBuildInfo } from "../../src/lib/buildInfo.js";

const NOW = () => "2026-07-14T00:00:00.000Z";

describe("resolveBuildInfo", () => {
  it("prefers the BUILD_SHA env override", () => {
    const info = resolveBuildInfo({
      env: { BUILD_SHA: "abc1234def5678", BUILD_BRANCH: "main" },
      now: NOW,
      runGit: () => assert.fail("git must not be called when BUILD_SHA is set"),
    });
    assert.equal(info.sha, "abc1234def5678");
    assert.equal(info.shortSha, "abc1234");
    assert.equal(info.branch, "main");
    assert.equal(info.commitISO, null);
  });

  it("falls back to git", () => {
    const answers: Record<string, string> = {
      "rev-parse HEAD": "9400775aaaabbbbccccdddd",
      "show -s --format=%cI HEAD": "2026-07-01T11:30:39-05:00",
      "rev-parse --abbrev-ref HEAD": "main",
    };
    const info = resolveBuildInfo({ env: {}, now: NOW, runGit: (args) => answers[args] ?? null });
    assert.equal(info.sha, "9400775aaaabbbbccccdddd");
    assert.equal(info.shortSha, "9400775");
    assert.equal(info.commitISO, "2026-07-01T11:30:39-05:00");
  });

  it("degrades to unknown without git", () => {
    const info = resolveBuildInfo({ env: {}, now: NOW, runGit: () => null });
    assert.equal(info.sha, "unknown");
    assert.equal(info.shortSha, "unknown");
    assert.equal(info.commitISO, null);
    assert.equal(info.branch, "unknown");
  });

  it("never throws when git throws", () => {
    const info = resolveBuildInfo({
      env: {},
      now: NOW,
      runGit: () => { throw new Error("git: command not found"); },
    });
    assert.equal(info.sha, "unknown");
  });
});

describe("getBuildInfo", () => {
  it("memoizes — repeated calls return the identical object", () => {
    assert.equal(getBuildInfo(), getBuildInfo());
  });

  it("resolves a real sha in-repo", () => {
    assert.match(getBuildInfo().sha, /^[0-9a-f]{40}$|^unknown$/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit --workspace=packages/api`
Expected: FAIL — cannot resolve `../../src/lib/buildInfo.js`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/api/src/lib/buildInfo.ts`:

```ts
/**
 * Build identity for the API — mirrors scripts/build-info.mjs (which the web
 * build uses via vite `define`). Kept as a thin sibling rather than importing
 * the root .mjs so the API package has no path coupling outside itself.
 *
 * Resolution order (never throws): BUILD_SHA env override → git → "unknown".
 */
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface BuildInfo {
  sha: string;
  shortSha: string;
  commitISO: string | null;
  branch: string;
  builtAtISO: string;
}

const UNKNOWN = "unknown";

// src/lib (dev, tsx) and dist/lib (prod, tsc) are both 4 levels below the repo root.
const REPO_ROOT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
);

/** Run a git command in the repo root. Returns trimmed stdout, or null on any failure. */
export function runGit(args: string): string | null {
  try {
    const out = execSync(`git ${args}`, {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.trim() || null;
  } catch {
    return null;
  }
}

export interface ResolveOpts {
  env?: NodeJS.ProcessEnv;
  now?: () => string;
  /** Injected for tests. Named to match scripts/build-info.mjs. */
  runGit?: (args: string) => string | null;
}

export function resolveBuildInfo({
  env = process.env,
  now = () => new Date().toISOString(),
  runGit: git = runGit,
}: ResolveOpts = {}): BuildInfo {
  const builtAtISO = now();

  const call = (args: string): string | null => {
    try {
      return git(args);
    } catch {
      return null;
    }
  };

  if (env.BUILD_SHA) {
    const sha = env.BUILD_SHA;
    return {
      sha,
      shortSha: sha.slice(0, 7),
      commitISO: env.BUILD_COMMIT_ISO ?? null,
      branch: env.BUILD_BRANCH ?? UNKNOWN,
      builtAtISO,
    };
  }

  const sha = call("rev-parse HEAD");
  if (sha) {
    return {
      sha,
      shortSha: sha.slice(0, 7),
      commitISO: call("show -s --format=%cI HEAD"),
      branch: call("rev-parse --abbrev-ref HEAD") ?? UNKNOWN,
      builtAtISO,
    };
  }

  return { sha: UNKNOWN, shortSha: UNKNOWN, commitISO: null, branch: UNKNOWN, builtAtISO };
}

let cached: BuildInfo | null = null;

/** Memoized build identity — resolved once per process. */
export function getBuildInfo(): BuildInfo {
  cached ??= resolveBuildInfo();
  return cached;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit --workspace=packages/api`
Expected: PASS — 6 tests passing.

- [ ] **Step 5: Wire `version` into `/health`**

In `packages/api/src/index.ts`, add the import next to the other local imports (after the `checkHealth` import around line 21):

```ts
import { getBuildInfo } from "./lib/buildInfo.js";
```

Then in the `/health` handler (around line 83), add `version` to the JSON payload — leave every existing field and the status logic untouched:

```ts
  res.status(dbOk ? 200 : 503).json({
    status,
    chain: "PulseChain",
    chainId: 369,
    db: dbOk,
    chainsReady: allChainsReady(),
    chains,
    version: getBuildInfo(),
  });
```

- [ ] **Step 6: Write the failing integration test**

Append to `packages/api/tests/integration.test.ts`:

```ts
describe("GET /health — build version", () => {
  it("exposes the running build identity without changing liveness", async () => {
    const res = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(3000) });
    assert.equal(res.status, 200);

    const body = (await res.json()) as {
      status: string;
      db: boolean;
      version?: {
        sha: string;
        shortSha: string;
        commitISO: string | null;
        branch: string;
        builtAtISO: string;
      };
    };

    // Liveness semantics unchanged.
    assert.equal(body.status, "ok");
    assert.equal(body.db, true);

    // Version is additive and well-formed.
    assert.ok(body.version, "expected a version object on /health");
    assert.match(body.version.sha, /^[0-9a-f]{40}$|^unknown$/);
    assert.equal(body.version.shortSha, body.version.sha.slice(0, 7));
    assert.match(body.version.builtAtISO, /^\d{4}-\d{2}-\d{2}T/);
  });
});
```

- [ ] **Step 7: Run the integration test**

Start the API if it isn't running (`npm run dev:api`), then run:
`npm run test --workspace=packages/api`
Expected: PASS, including the new `GET /health — build version` block.

- [ ] **Step 8: Verify by hand**

Run: `curl -s http://localhost:10100/health | jq .version`
Expected: a `version` object whose `shortSha` equals `git rev-parse --short HEAD`.

- [ ] **Step 9: Commit**

```bash
git add packages/api/src/lib/buildInfo.ts packages/api/tests/unit/buildInfo.test.ts packages/api/src/index.ts packages/api/tests/integration.test.ts
git commit -m "feat(api): expose build sha on /health"
```

---

### Task 3: Bake the build SHA into the web bundle + surface it in Settings

**Files:**
- Modify: `packages/web/vite.config.ts`
- Create: `packages/web/src/lib/buildInfo.ts`
- Test: `packages/web/src/__tests__/buildInfo.test.ts`
- Modify: `packages/web/src/components/settings/SettingsPanel.tsx` (add a `BuildSection`)

**Interfaces:**
- Consumes: `resolveBuildInfo()` from `scripts/build-info.mjs` (Task 1) and its types from `scripts/build-info.d.mts`.
- Produces: `BUILD_INFO: BuildInfo` exported from `packages/web/src/lib/buildInfo.ts`, and the global compile-time constant `__BUILD_INFO__`. Task 4 reads `BUILD_INFO.sha`.

- [ ] **Step 1: Write the failing test**

Create `packages/web/src/__tests__/buildInfo.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { BUILD_INFO } from "../lib/buildInfo";

/**
 * The SHA is injected by vite `define` at build time (and in vitest, which
 * shares vite.config.ts). Assert the shape, never a literal sha — the value
 * legitimately changes every commit.
 */
describe("BUILD_INFO", () => {
  it("is baked in with a well-formed shape", () => {
    expect(BUILD_INFO).toBeDefined();
    expect(typeof BUILD_INFO.sha).toBe("string");
    expect(BUILD_INFO.sha.length).toBeGreaterThan(0);
    expect(BUILD_INFO.sha).toMatch(/^[0-9a-f]{40}$|^unknown$/);
  });

  it("derives shortSha as the first 7 chars of sha", () => {
    expect(BUILD_INFO.shortSha).toBe(BUILD_INFO.sha.slice(0, 7));
  });

  it("stamps an ISO build timestamp", () => {
    expect(BUILD_INFO.builtAtISO).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=packages/web -- buildInfo`
Expected: FAIL — cannot resolve `../lib/buildInfo`.

- [ ] **Step 3: Inject the constant in vite.config.ts**

In `packages/web/vite.config.ts`, add the import at the top (after the existing plugin imports):

```ts
import { resolveBuildInfo } from "../../scripts/build-info.mjs";
```

Then add a top-level `define` to the config object — put it directly after the `base:` line, before `plugins`:

```ts
  // Build identity baked at build time (Node context), so the running bundle
  // can report which commit it is — including the VITE_IPFS build, which has
  // no server and therefore no /health to ask.
  define: {
    __BUILD_INFO__: JSON.stringify(resolveBuildInfo()),
  },
```

- [ ] **Step 4: Write the typed accessor**

Create `packages/web/src/lib/buildInfo.ts`:

```ts
/**
 * The commit this bundle was built from. Injected by vite `define` (see
 * vite.config.ts) — a compile-time constant, not a runtime lookup, so it
 * works for the IPFS build too.
 */
export interface BuildInfo {
  sha: string;
  shortSha: string;
  commitISO: string | null;
  branch: string;
  builtAtISO: string;
}

declare global {
  const __BUILD_INFO__: BuildInfo;
}

export const BUILD_INFO: BuildInfo = __BUILD_INFO__;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test --workspace=packages/web -- buildInfo`
Expected: PASS — 3 tests passing.

- [ ] **Step 6: Verify the type-check and a real build**

Run: `npm run typecheck`
Expected: clean.

Run: `npm run build --workspace=packages/web`
Expected: build succeeds. Then confirm the SHA is actually in the bundle:

```bash
grep -c "$(git rev-parse HEAD)" packages/web/dist/assets/*.js | grep -v ':0' | head -1
```
Expected: at least one asset contains the full SHA (proves `define` inlined it).

- [ ] **Step 7: Surface the version in Settings**

The spec calls for the running SHA to be visible at a glance. `SettingsPanel.tsx`
composes local `Section` / `Row` primitives with sibling section functions
(`BackendApiSection`, `RpcEndpointSection`, `NotificationsSection`) — add
`BuildSection` the same way, in the same file, matching that established pattern.

In `packages/web/src/components/settings/SettingsPanel.tsx`, add to the imports:

```tsx
import { BUILD_INFO } from "../../lib/buildInfo";
```

Add the section to the `SettingsPanel()` body, directly after `<NotificationsSection />`:

```tsx
      <BuildSection />
```

Then add the component next to the other section functions (place it after
`NotificationsSection`, before the `Section` primitive):

```tsx
/**
 * Which commit this bundle is. Baked at build time (see lib/buildInfo), so it
 * answers "what am I running?" even on the IPFS build, which has no /health.
 */
function BuildSection() {
  const commitDate =
    BUILD_INFO.commitISO === null
      ? "unknown"
      : new Date(BUILD_INFO.commitISO).toLocaleString();

  return (
    <Section title="Build" icon="heroicons:cube">
      <Row
        label="Commit"
        hint={`Branch ${BUILD_INFO.branch} — committed ${commitDate}`}
        control={
          <code className="text-xs font-mono theme-text-muted">
            {BUILD_INFO.shortSha}
          </code>
        }
      />
      <Row
        label="Built"
        hint="When this bundle was compiled."
        control={
          <code className="text-xs font-mono theme-text-muted">
            {new Date(BUILD_INFO.builtAtISO).toLocaleString()}
          </code>
        }
      />
    </Section>
  );
}
```

- [ ] **Step 8: Verify the Settings display renders**

Run: `npm run lint && npm run typecheck && npm run test --workspace=packages/web`
Expected: clean, including `lint:spacing` (the markup above uses only `gap-4`-free
primitives already present in the file — no banned spacing classes, no `p-6+`,
no CSS `border`).

Then with `npm run dev` running, open `/settings` and confirm a **Build** card
shows a short SHA matching `git rev-parse --short HEAD`.

- [ ] **Step 9: Commit**

```bash
git add packages/web/vite.config.ts packages/web/src/lib/buildInfo.ts packages/web/src/__tests__/buildInfo.test.ts packages/web/src/components/settings/SettingsPanel.tsx
git commit -m "feat(web): bake build sha into the bundle and show it in Settings"
```

---

### Task 4: Version-drift detection + auto-reload

**Files:**
- Create: `packages/web/src/lib/versionDrift.ts`
- Test: `packages/web/src/__tests__/versionDrift.test.ts`
- Modify: `packages/web/src/App.tsx` (imports at line 1-2; poller effect at ~line 67-85)

**Interfaces:**
- Consumes: `BUILD_INFO` from `packages/web/src/lib/buildInfo.ts` (Task 3); the `/health` `version.sha` field (Task 2).
- Produces: `hasDrifted(served: string | null | undefined, baked: string): boolean` and `shouldReloadNow(served: string | null | undefined, baked: string, busy: boolean): boolean`. Nothing downstream consumes these.

**Design note:** The "busy" guard uses TanStack Query's `useIsFetching()` + `useIsMutating()` rather than instrumenting each interactive surface by hand. `App` already renders inside `PersistQueryClientProvider` (`main.tsx:75`), and the simulator/fork/debugger surfaces run their server work through Query — so this covers in-flight work app-wide with zero component wiring, and there is no bespoke busy state to keep in sync.

- [ ] **Step 1: Write the failing test**

Create `packages/web/src/__tests__/versionDrift.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { hasDrifted, shouldReloadNow } from "../lib/versionDrift";

const BAKED = "9400775aaaabbbbccccdddd";
const DEPLOYED = "0a159c8eeeeffff11112222";

describe("hasDrifted", () => {
  it("is true when the served sha differs from the baked one", () => {
    expect(hasDrifted(DEPLOYED, BAKED)).toBe(true);
  });

  it("is false when they match", () => {
    expect(hasDrifted(BAKED, BAKED)).toBe(false);
  });

  it("is false when the served sha is missing — never reload on a bad payload", () => {
    expect(hasDrifted(null, BAKED)).toBe(false);
    expect(hasDrifted(undefined, BAKED)).toBe(false);
    expect(hasDrifted("", BAKED)).toBe(false);
  });

  it("is false when either side is unknown — an unstamped build is not drift", () => {
    expect(hasDrifted("unknown", BAKED)).toBe(false);
    expect(hasDrifted(DEPLOYED, "unknown")).toBe(false);
    expect(hasDrifted("unknown", "unknown")).toBe(false);
  });
});

describe("shouldReloadNow", () => {
  it("reloads when drifted and idle", () => {
    expect(shouldReloadNow(DEPLOYED, BAKED, false)).toBe(true);
  });

  it("defers while busy — never interrupt in-flight work", () => {
    expect(shouldReloadNow(DEPLOYED, BAKED, true)).toBe(false);
  });

  it("does not reload when there is no drift, busy or not", () => {
    expect(shouldReloadNow(BAKED, BAKED, false)).toBe(false);
    expect(shouldReloadNow(BAKED, BAKED, true)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=packages/web -- versionDrift`
Expected: FAIL — cannot resolve `../lib/versionDrift`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/web/src/lib/versionDrift.ts`:

```ts
/**
 * Pure decisions for "this tab is running an older build than the server".
 *
 * Both shas must be known for drift to count: an unstamped build ("unknown")
 * or a missing /health payload means we cannot tell, and guessing would
 * reload the tab forever.
 */
const UNKNOWN = "unknown";

function isKnown(sha: string | null | undefined): sha is string {
  return typeof sha === "string" && sha.length > 0 && sha !== UNKNOWN;
}

/** True when the server reports a different build than this bundle. */
export function hasDrifted(served: string | null | undefined, baked: string): boolean {
  if (!isKnown(served) || !isKnown(baked)) return false;
  return served !== baked;
}

/**
 * True when we should reload right now: drifted AND no in-flight work.
 * While busy we defer — the caller re-evaluates on its next poll.
 */
export function shouldReloadNow(
  served: string | null | undefined,
  baked: string,
  busy: boolean,
): boolean {
  return hasDrifted(served, baked) && !busy;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=packages/web -- versionDrift`
Expected: PASS — 7 tests passing.

- [ ] **Step 5: Wire it into the existing poller**

In `packages/web/src/App.tsx`, add to the imports at the top:

```tsx
import { useIsFetching, useIsMutating } from "@tanstack/react-query";
import { BUILD_INFO } from "./lib/buildInfo";
import { shouldReloadNow } from "./lib/versionDrift";
```

Inside `App()`, next to the existing `apiStatus` state, add:

```tsx
  const [servedSha, setServedSha] = useState<string | null>(null);
```

In the existing `/health` poller effect, widen the parsed type and capture the sha. Replace these two lines:

```tsx
        const data = (await res.json()) as { status: string; db: boolean };
        setApiStatus(data.status === "ok" && data.db ? "connected" : "disconnected");
```

with:

```tsx
        const data = (await res.json()) as {
          status: string;
          db: boolean;
          version?: { sha?: string };
        };
        setApiStatus(data.status === "ok" && data.db ? "connected" : "disconnected");
        setServedSha(data.version?.sha ?? null);
```

Then add a new effect directly after that poller effect:

```tsx
  // Auto-reload a stale tab once the deployed build moves ahead of this bundle.
  // `busy` defers the reload past in-flight work (a running simulation, fork op,
  // or debugger step) — the effect re-runs and fires once the app goes idle.
  const busy = useIsFetching() + useIsMutating() > 0;

  useEffect(() => {
    if (!shouldReloadNow(servedSha, BUILD_INFO.sha, busy)) return;
    const timer = setTimeout(() => window.location.reload(), 5_000);
    return () => clearTimeout(timer);
  }, [servedSha, busy]);
```

- [ ] **Step 6: Verify the whole web suite and lint**

Run: `npm run test --workspace=packages/web`
Expected: PASS — no regressions.

Run: `npm run lint && npm run typecheck`
Expected: clean.

- [ ] **Step 7: Verify the reload behavior on a cold Vite server**

Restart Vite and clear its cache first — HMR can serve a stale transform of a `define`d constant, which would invalidate this whole check:

```bash
rm -rf packages/web/node_modules/.vite && npm run dev:web
```

With the API also running (`npm run dev:api`), verify three things in the browser:

**(a) The negative case — no false reload.** Open the app, leave it for 60s (≥4 polls). In the Network tab confirm `/health` responses carry `version.sha`, and confirm the page never reloads. This is the normal case and the one a bug here would break most visibly.

**(b) The unreachable case — no reload.** Stop the API. Confirm the status goes disconnected and the tab still does **not** reload (a missing payload is not drift).

**(c) The positive case — reload fires.** Restart the API, then force real drift by starting the API from a different commit:

```bash
# in a separate shell, with the app open in the browser
git commit --allow-empty -m "temp: force sha drift"
# restart the API so it resolves the new HEAD
```

The browser's baked SHA is now behind the API's. Within one 15s poll + 5s delay, the tab reloads exactly once (after reloading, Vite re-bakes the new SHA, so the shas match again and it settles — no loop).

Clean up the throwaway commit:

```bash
git reset --hard HEAD~1
```

Expected: reload fires only in case (c), exactly once.

- [ ] **Step 8: Commit**

```bash
git add packages/web/src/lib/versionDrift.ts packages/web/src/__tests__/versionDrift.test.ts packages/web/src/App.tsx
git commit -m "feat(web): auto-reload stale tabs when the deployed build moves"
```

---

### Task 5: Endpoint manifest

**Files:**
- Create: `infra/endpoints.json`

**Interfaces:**
- Consumes: nothing.
- Produces: the manifest consumed by `scripts/check-infra.mjs` (Task 6). Entry shape: `{ name: string, url: string, method: "GET" | "POST", body?: unknown, category: string, expect: number | "auth-gated" | "grpc" | "not-live", owner: "repo" | "fleet", notes: string }`.

- [ ] **Step 1: Write the manifest**

Create `infra/endpoints.json`. Values are seeded from the 2026-07-14 live audit:

```json
{
  "$comment": [
    "Source of truth for what should be live. Consumed by scripts/check-infra.mjs.",
    "expect: an HTTP status code | 'auth-gated' (alive iff it returns a well-formed",
    "auth error) | 'grpc' (alive on 200/415) | 'not-live' (expected down today).",
    "owner: 'repo' (this codebase deploys it) | 'fleet' (server-side infra).",
    "NOTE: baked.valve.city is deliberately absent — it is a unit-test fixture in",
    "packages/web/src/__tests__/apiBase.extra.test.ts, not a real host."
  ],
  "endpoints": [
    {
      "name": "explore (frontend + API)",
      "url": "https://explore.valve.city/",
      "method": "GET",
      "category": "frontend",
      "expect": 200,
      "owner": "repo",
      "notes": "Express serves packages/web/dist; /api is same-origin"
    },
    {
      "name": "explore /health",
      "url": "https://explore.valve.city/health",
      "method": "GET",
      "category": "api",
      "expect": 200,
      "owner": "repo",
      "notes": "Liveness + build version; drives the SHA drift check"
    },
    {
      "name": "explore /api/network-health",
      "url": "https://explore.valve.city/api/network-health?limit=1",
      "method": "GET",
      "category": "api",
      "expect": 200,
      "owner": "repo",
      "notes": "Representative live-data read path"
    },
    {
      "name": "ipfs.explore mirror",
      "url": "https://ipfs.explore.valve.city/",
      "method": "GET",
      "category": "frontend",
      "expect": "not-live",
      "owner": "fleet",
      "notes": "No A record and no _dnslink TXT as of 2026-07-14. Flip to 200 once published."
    },
    {
      "name": "rpc.valve.city",
      "url": "https://rpc.valve.city/v1/test/evm/369",
      "method": "POST",
      "body": { "jsonrpc": "2.0", "id": 1, "method": "eth_blockNumber", "params": [] },
      "category": "rpc",
      "expect": "auth-gated",
      "owner": "fleet",
      "notes": "Alive when it rejects an invalid/absent key with a JSON-RPC error"
    },
    {
      "name": "evm-1-rpc",
      "url": "https://evm-1-rpc.valve.city/v1/",
      "method": "POST",
      "body": { "jsonrpc": "2.0", "id": 1, "method": "eth_blockNumber", "params": [] },
      "category": "rpc",
      "expect": "auth-gated",
      "owner": "fleet",
      "notes": "Ethereum"
    },
    {
      "name": "evm-369-rpc",
      "url": "https://evm-369-rpc.valve.city/v1/",
      "method": "POST",
      "body": { "jsonrpc": "2.0", "id": 1, "method": "eth_blockNumber", "params": [] },
      "category": "rpc",
      "expect": "auth-gated",
      "owner": "fleet",
      "notes": "PulseChain"
    },
    {
      "name": "one.valve.city",
      "url": "https://one.valve.city/",
      "method": "GET",
      "category": "rpc",
      "expect": 200,
      "owner": "fleet",
      "notes": "Root manifest; /rpc/ returned 'Unsupported chain' for 369 on 2026-07-14 — open question"
    },
    {
      "name": "chifra.valve.city",
      "url": "https://chifra.valve.city/",
      "method": "GET",
      "category": "rpc",
      "expect": 301,
      "owner": "fleet",
      "notes": "Redirects; explorer data source alongside RPC"
    },
    {
      "name": "evm-1-substreams",
      "url": "https://evm-1-substreams.valve.city/",
      "method": "GET",
      "category": "substreams",
      "expect": "grpc",
      "owner": "fleet",
      "notes": "gRPC endpoint — a plain GET yields 200 or 415 when alive"
    },
    {
      "name": "evm-369-substreams",
      "url": "https://evm-369-substreams.valve.city/",
      "method": "GET",
      "category": "substreams",
      "expect": "grpc",
      "owner": "fleet",
      "notes": "gRPC endpoint"
    },
    {
      "name": "evm-943-substreams",
      "url": "https://evm-943-substreams.valve.city/",
      "method": "GET",
      "category": "substreams",
      "expect": "grpc",
      "owner": "fleet",
      "notes": "gRPC endpoint; first chain stood up"
    },
    {
      "name": "gib.show icons",
      "url": "https://gib.show/image/369",
      "method": "GET",
      "category": "icons",
      "expect": 200,
      "owner": "fleet",
      "notes": "Chain logos; see docs/GIB_SHOW.md"
    },
    {
      "name": "reth snapshots",
      "url": "https://evm943-snapshot-reth.valve.city/",
      "method": "GET",
      "category": "snapshots",
      "expect": "not-live",
      "owner": "fleet",
      "notes": "TODO(user): the evm{1,369,943}-snapshot-reth.valve.city subdomains are stale — snapshots are now consolidated under a versioned path. Replace this entry with the real scheme, then set expect to 200."
    }
  ]
}
```

- [ ] **Step 2: Verify it is valid JSON with the expected entry count**

Run: `node -e "const m=require('./infra/endpoints.json'); console.log(m.endpoints.length, 'endpoints'); console.log([...new Set(m.endpoints.map(e=>e.category))].join(', '))"`
Expected: `14 endpoints` and the categories `frontend, api, rpc, substreams, icons, snapshots`.

- [ ] **Step 3: Commit**

```bash
git add infra/endpoints.json
git commit -m "docs(infra): endpoint manifest as the source of truth for what should be live"
```

---

### Task 6: `check-infra` script

**Files:**
- Create: `scripts/check-infra.mjs`
- Test: `scripts/check-infra.test.mjs`
- Modify: `package.json` (add `check:infra`)

**Interfaces:**
- Consumes: `infra/endpoints.json` (Task 5); the `/health` `version.sha` field (Task 2).
- Produces: `matchesExpectation(entry, probe) => { ok: boolean, detail: string }` (exported for tests) and a CLI: `node scripts/check-infra.mjs [--expected <sha>]`, exit 0 all-good / exit 1 on drift or unexpected-down.

- [ ] **Step 1: Write the failing test**

Create `scripts/check-infra.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { matchesExpectation } from "./check-infra.mjs";

const entry = (expect) => ({ name: "x", url: "https://x/", method: "GET", expect });

test("numeric expect matches the exact status", () => {
  assert.equal(matchesExpectation(entry(200), { status: 200, body: "" }).ok, true);
  assert.equal(matchesExpectation(entry(200), { status: 500, body: "" }).ok, false);
  assert.equal(matchesExpectation(entry(301), { status: 301, body: "" }).ok, true);
});

test("auth-gated passes on a JSON-RPC auth error", () => {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 0, error: { code: -32000, message: "API key required" } });
  assert.equal(matchesExpectation(entry("auth-gated"), { status: 200, body }).ok, true);
});

test("auth-gated passes when the key is invalid or inactive", () => {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 0, error: { code: -32000, message: "Invalid or inactive API key" } });
  assert.equal(matchesExpectation(entry("auth-gated"), { status: 200, body }).ok, true);
});

test("auth-gated fails when the host is unreachable", () => {
  assert.equal(matchesExpectation(entry("auth-gated"), { error: "ENOTFOUND" }).ok, false);
});

test("auth-gated fails on an unrecognizable body", () => {
  assert.equal(matchesExpectation(entry("auth-gated"), { status: 200, body: "<html>nope</html>" }).ok, false);
});

test("grpc passes on 200 or 415", () => {
  assert.equal(matchesExpectation(entry("grpc"), { status: 200, body: "" }).ok, true);
  assert.equal(matchesExpectation(entry("grpc"), { status: 415, body: "" }).ok, true);
  assert.equal(matchesExpectation(entry("grpc"), { status: 502, body: "" }).ok, false);
});

test("not-live passes when the host does not resolve, fails when it answers", () => {
  assert.equal(matchesExpectation(entry("not-live"), { error: "getaddrinfo ENOTFOUND" }).ok, true);
  assert.equal(matchesExpectation(entry("not-live"), { status: 200, body: "" }).ok, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:scripts`
Expected: FAIL — `Cannot find module '.../scripts/check-infra.mjs'`.

- [ ] **Step 3: Write minimal implementation**

Create `scripts/check-infra.mjs`:

```js
#!/usr/bin/env node
/**
 * Infra audit — probes every endpoint in infra/endpoints.json and diffs the
 * deployed build SHA against origin/main.
 *
 * Usage:
 *   node scripts/check-infra.mjs [--expected <sha>]
 *
 * Exit 0 when every endpoint meets its expectation and no SHA has drifted;
 * exit 1 otherwise (so a scheduled runner can alert on it).
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = path.join(REPO_ROOT, "infra", "endpoints.json");
const TIMEOUT_MS = 12_000;

/** Decide whether a probe result satisfies an entry's `expect`. Pure. */
export function matchesExpectation(entry, probe) {
  const { expect } = entry;

  if (expect === "not-live") {
    return probe.error
      ? { ok: true, detail: "not live (expected)" }
      : { ok: false, detail: `now answering with ${probe.status} — update the manifest` };
  }

  if (probe.error) return { ok: false, detail: probe.error };

  if (typeof expect === "number") {
    return probe.status === expect
      ? { ok: true, detail: String(probe.status) }
      : { ok: false, detail: `got ${probe.status}, want ${expect}` };
  }

  if (expect === "grpc") {
    return probe.status === 200 || probe.status === 415
      ? { ok: true, detail: `grpc alive (${probe.status})` }
      : { ok: false, detail: `got ${probe.status}, want 200/415` };
  }

  if (expect === "auth-gated") {
    let parsed;
    try {
      parsed = JSON.parse(probe.body);
    } catch {
      return { ok: false, detail: "non-JSON body — expected an auth error" };
    }
    return parsed?.error
      ? { ok: true, detail: `auth-gated (${parsed.error.message})` }
      : { ok: false, detail: "no auth error in body" };
  }

  return { ok: false, detail: `unknown expect: ${String(expect)}` };
}

async function probe(entry) {
  try {
    const res = await fetch(entry.url, {
      method: entry.method,
      headers: entry.body ? { "content-type": "application/json" } : undefined,
      body: entry.body ? JSON.stringify(entry.body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return { status: res.status, body: await res.text() };
  } catch (err) {
    return { error: err.cause?.code ?? err.message };
  }
}

function expectedSha(argv) {
  const flag = argv.indexOf("--expected");
  if (flag !== -1 && argv[flag + 1]) return argv[flag + 1];
  try {
    const out = execSync("git ls-remote origin refs/heads/main", {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.split(/\s+/)[0] || null;
  } catch {
    return null;
  }
}

async function main() {
  const { endpoints } = JSON.parse(readFileSync(MANIFEST, "utf8"));
  const want = expectedSha(process.argv);
  let failures = 0;

  console.log(`\nInfra audit — ${endpoints.length} endpoints`);
  console.log(`Expected sha (origin/main): ${want ?? "unknown"}\n`);

  const results = await Promise.all(
    endpoints.map(async (entry) => ({ entry, verdict: matchesExpectation(entry, await probe(entry)) })),
  );

  for (const { entry, verdict } of results) {
    if (!verdict.ok) failures++;
    console.log(`${verdict.ok ? "PASS" : "FAIL"}  ${entry.name.padEnd(32)} ${verdict.detail}`);
  }

  // Deploy drift — only the endpoints that serve /health can answer this.
  const health = endpoints.filter((e) => e.url.endsWith("/health"));
  for (const entry of health) {
    const res = await probe(entry);
    let served = null;
    try {
      served = JSON.parse(res.body)?.version?.sha ?? null;
    } catch { /* falls through to the unknown branch below */ }

    if (!served || served === "unknown") {
      failures++;
      console.log(`\nFAIL  deploy drift: ${entry.name} reports no build sha`);
    } else if (want && served !== want) {
      failures++;
      console.log(`\nFAIL  deploy drift: ${entry.name} serves ${served.slice(0, 7)}, origin/main is ${want.slice(0, 7)}`);
    } else {
      console.log(`\nPASS  deploy in sync: ${served.slice(0, 7)}`);
    }
  }

  console.log(failures ? `\n${failures} problem(s).\n` : "\nAll good.\n");
  process.exit(failures ? 1 : 0);
}

// Only run the CLI when invoked directly — importing for tests must not probe.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:scripts`
Expected: PASS — the 5 build-info tests plus 7 check-infra tests.

- [ ] **Step 5: Add the npm script**

In `package.json`, add to `"scripts"`:

```json
"check:infra": "node scripts/check-infra.mjs",
```

- [ ] **Step 6: Run it against live infra**

Run: `npm run check:infra`
Expected: every endpoint PASSes per the manifest. Deploy drift will **FAIL** with "reports no build sha" until Tasks 1–4 are actually deployed to `explore.valve.city` — that is correct behavior and is itself the proof the drift check works. Once deployed, re-run and expect `PASS deploy in sync`.

- [ ] **Step 7: Commit**

```bash
git add scripts/check-infra.mjs scripts/check-infra.test.mjs package.json
git commit -m "feat(infra): manifest-driven infra audit with deploy-drift detection"
```

---

### Task 7: Full verification sweep

**Files:** none (verification only)

**Interfaces:**
- Consumes: everything from Tasks 1-6.
- Produces: a green build, ready to push.

- [ ] **Step 1: Run every suite**

```bash
npm run lint && npm run typecheck && npm run test:scripts && npm run test:web && npm run test:sdk
```
Expected: all clean. (`npm run test --workspace=packages/api` additionally needs a live API on :10100.)

- [ ] **Step 2: Run the API suites against a live server**

With `npm run dev:api` running:
```bash
npm run test:unit --workspace=packages/api && npm run test --workspace=packages/api
```
Expected: PASS, including `GET /health — build version`.

- [ ] **Step 3: Confirm the end-to-end claim**

```bash
curl -s http://localhost:10100/health | jq -r .version.sha
git rev-parse HEAD
```
Expected: identical values — the one-command check the whole plan exists to enable.

- [ ] **Step 4: Push**

The app is internal-only and pushing to `origin/main` when green is pre-authorized.

```bash
git push origin main
```

- [ ] **Step 5: Hand off the remaining items**

Report to the user:
1. `npm run check:infra` output, and the fact that deploy-drift stays FAIL until `explore.valve.city` is redeployed from `origin/main`.
2. The `TODO(user)` snapshot entry in `infra/endpoints.json` still needs the real versioned-path scheme.
3. The `/schedule` routine (30-min cadence, alert channel to confirm — push notification, never Slack) is set up interactively after this lands.

---

## Deferred to the user (not in this plan)

These came out of the 2026-07-14 audit but are fleet-side, outside this repo's lane:

- **Reth snapshots** — the three `evm{N}-snapshot-reth.valve.city` subdomains do not resolve; snapshots are reportedly consolidated under a versioned path. Need the real scheme.
- **`ipfs.explore.valve.city`** — no A record, no `_dnslink` TXT. Publish it or drop the hostname.
- **`one.valve.city/rpc/`** — returns "Unsupported chain" for 369. Possible routing/key-path bug.
