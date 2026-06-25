# `@valve-tech/trace-sdk` — family parity with the evm-toolkit packages — design spec

**Date:** 2026-06-25
**Status:** proposed (design) — pending pickup
**Repo:** `valve-tech/explore` · package `packages/sdk` (`@valve-tech/trace-sdk`, currently `0.4.0` on npm)
**Author:** drafted from the `valve-tech/evm-toolkit` side after confirming `trace-sdk` should remain housed in `explore` (it is correctly decoupled — zero runtime deps, peer-deps `viem` + optional `react`, no `@valve-tech/*` coupling in either direction).

## Why

`@valve-tech/trace-sdk` is the **13th** published `@valve-tech/*` package and the only one that lives outside the `evm-toolkit` monorepo. It is architecturally correct to keep it here (different domain — `debug_traceTransaction` parsing + React trace UI, not the `ChainSource` chain-observation model; provenance tied to the firehose-instrumented `reth` stack; independent `0.4.x` release line). See the decoupling audit summary at the end.

But it is **inconsistent with the toolkit family in its agent-facing surface**, which hurts discoverability and the "one family" feel across repos:

1. **No `AGENTS.md`.** Every published evm-toolkit package ships one — a terse, fast API reference for AI agents (Claude Code / Cursor / Aider) integrating the package. `trace-sdk` has only a human `README.md`.
2. **No integration skill.** Every evm-toolkit package ships `skills/<name>-integration/SKILL.md` in its npm tarball, and `@valve-tech/agent-skills` installs them into a consumer's `.claude/skills/`. `trace-sdk` ships none, so an agent in a consumer project gets no guided integration for it.
3. **README has 2 unfinished `TODO` placeholders**, including the Quickstart code block — the single most important positioning decision in the doc.

This spec brings `trace-sdk` to family parity on those three points. **It is documentation/packaging only — no change to the library's runtime surface, no version-semantics change.** A patch release (`0.4.1`) ships it.

## Non-goals

- No change to `trace-sdk`'s exported API, behavior, or types.
- No move into the `evm-toolkit` monorepo — the decoupling audit confirms it belongs here.
- No adoption of the toolkit's *synchronized* versioning — `trace-sdk` keeps its own independent `0.4.x` line.
- No new dependencies (the package's zero-runtime-deps / optional-react-peer shape is a feature; keep it).

## Coordination note

`explore` is under active development (a test-coverage sweep + a `refactor/split-by-responsibility-wave` branch as of 2026-06-25). This spec deliberately scopes the work to **two brand-new files** plus a **localized README edit**, so it collides minimally with in-flight work. Land it on its own branch and merge when convenient.

## Part 1 — `packages/sdk/AGENTS.md` (new file)

Mirror the structure of a toolkit `AGENTS.md` (e.g. `@valve-tech/wallet-crypto`'s): terse, agent-targeted, fast to scan. Sections:

- **What this package does** — 2-3 lines. Standalone EVM trace loading, traversal, rendering. Works against any JSON-RPC node supporting `debug_traceTransaction` / `debug_traceCall`. No platform/backend dependency.
- **Public API** — a single fenced `import { … } from '@valve-tech/trace-sdk'` block listing the real exports (verify against `src/index.ts` at authoring time; as of 0.4.0 these are: `parseCallTrace`, `walkCallTree`, `findRevertFrame`, `buildGasProfile`, `loadTraceFromHash`, and the React components `CallTree`, `GasFlamegraph`, `OpcodeViewer`). Note which are data-layer (no React) vs. components (need the `react` peer).
- **Decision tree: which entry point** — "have a tx hash → `loadTraceFromHash`; have a raw trace object → `parseCallTrace`; want to find why it reverted → `findRevertFrame`; want gas attribution → `buildGasProfile`; rendering in React → the components."
- **Invariants / load-bearing facts** — the data layer is pure over the trace object (no I/O except `loadTraceFromHash`); `react` is an OPTIONAL peer (data-only consumers must not be forced to install it); requires the `debug_*` RPC namespace (most public RPCs gate it — call this out, it's the #1 integration failure).
- **Composition** — pairs naturally with `viem` (the required peer; RPC + address utils). Mention it's part of the broader `@valve-tech/*` family but on an independent release line.
- **Verifying provenance** — the `npm view … dist.attestations` / `npm audit signatures` block, matching the toolkit packages.

## Part 2 — `packages/sdk/skills/trace-sdk-integration/SKILL.md` (new file)

Author per the toolkit's own **`writing-package-skills`** skill (in `evm-toolkit/.claude/skills/writing-package-skills/` — the canonical authoring guide for these). Requirements:

- **Frontmatter `description`** must be trigger-rich and end with a `Skip when …` clause (the toolkit house style). Triggers: calling `loadTraceFromHash` / `parseCallTrace` / `walkCallTree` / `findRevertFrame` / `buildGasProfile`, rendering `CallTree` / `GasFlamegraph` / `OpcodeViewer`, questions like "why did this tx revert", "where did the gas go", "render a call trace in React", "load a debug_traceTransaction". Skip when the user only needs receipts/logs (that's plain viem) or chain-watching (that's `@valve-tech/chain-source`).
- **No version pins** anywhere in the skill body — the toolkit's 2026-06-12 audit rule: pinning a concrete minor rots. Say "any `0.x` of `@valve-tech/trace-sdk`".
- **Any `node_modules/...` path the skill points at must exist in the package's `files` allowlist** — otherwise reference the GitHub URL (the other half of that audit rule).
- Content: the decision tree from Part 1 expanded with real code snippets; the `debug_*`-namespace gotcha with how to detect/handle it; the data-vs-React split; the revert-frame and gas-profile recipes.
- Ship it: confirm `skills` is in `packages/sdk/package.json#files` (add if missing) so it lands in the tarball, exactly as the toolkit packages do.

## Part 3 — finish `packages/sdk/README.md` (localized edit)

Resolve the 2 `TODO` placeholders:

- **Quickstart** (the `TODO(user)` block offering Option A/B/C): pick **Option C — data-first then UI-first**, matching the package's actual shape (a data core with optional React components, the same shape as `@valve-tech/tx-flight-react`). Write a ~10-line data snippet (`loadTraceFromHash` → `findRevertFrame` → print the revert) followed by a short React snippet (`<CallTree trace={…} />`). Use real imports from `src/index.ts`.
- The second `TODO`: resolve in place per its context.

Keep the edit localized to the TODO regions to minimize collision with any in-flight README work.

## Testing / gates

- `trace-sdk` is docs/packaging-only here — no new unit tests required. Run the package's existing `build` + `lint` + `typecheck` + `test` to confirm nothing regressed (adding `AGENTS.md` / `skills/` shouldn't, but the `files`-allowlist edit touches `package.json`).
- `npm pack --dry-run` in `packages/sdk` and confirm the tarball now contains `AGENTS.md` + `skills/trace-sdk-integration/SKILL.md` (and still only the intended files).
- If `explore` has a docs-artifact check (TypeDoc/etc.) like evm-toolkit's `docs:check`, run it.

## Release

- Cut `@valve-tech/trace-sdk@0.4.1` on the package's own (independent) line — a patch (docs + packaging only). Follow `explore`'s existing release process for the `sdk` package.
- This does **not** touch the `evm-toolkit` synchronized line.

## Decisions captured

- `trace-sdk` stays in `explore` (confirmed by the decoupling audit — no toolkit coupling, different domain, provenance tied to the reth/firehose stack, independent release cadence).
- Parity is **agent-surface only** (`AGENTS.md` + integration skill + finished README) — not API, not versioning, not monorepo location.
- Author the skill against the toolkit's `writing-package-skills` guide and its two anti-rot rules (no version pins; tarball-path/files-allowlist consistency).

## Appendix — decoupling audit (why it stays out of evm-toolkit)

- `package.json`: `dependencies: {}`; `peerDependencies: { react: ">=18.0.0", viem: "^2.23.0" }`; no `@valve-tech/*` in either direction.
- No `evm-toolkit` package imports `trace-sdk`; `trace-sdk` imports nothing from the toolkit.
- Domain: `debug_*` trace parsing + React trace visualization — orthogonal to the toolkit's `ChainSource` → `{ GasOracle, TxTracker }` chain-observation model; it would be an orphan concern there, not a sibling.
- Capability contract: requires the `debug_*` RPC namespace (commonly gated), a different availability story from the toolkit's browser/mobile-safe `eth_*` baseline.
- Provenance: extracted from the Explore debugger, which runs on valve's firehose-instrumented `reth`; the trace shapes it parses originate in that stack.
- Cadence: independent `0.4.x` line vs. the toolkit's synced `0.19.x`.
