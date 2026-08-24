# Multichain Entity Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the chain out of `?chainid=N` and into the path as `/eip155/369/…`, and make a chain-less address URL render every chain instead of silently picking PulseChain.

**Architecture:** One new module (`lib/chainScope.ts`) becomes the only code that decides what chain a page is about; `useActiveChainId()` keeps its signature and delegates to it, so ~40 call sites never move. Two new chain-agnostic API endpoints fan out with the existing `runWithChain` seam and report per-chain failures instead of swallowing them. One two-line row component serves the chain strip, the merged activity feed, and the block-height page.

**Tech Stack:** React 19, React Router 7, Vite, Tailwind v4, TanStack Query 5, Vitest (web); Express 4, viem, `node:test` (api).

**Spec:** `docs/superpowers/specs/2026-08-23-multichain-entity-routing-design.md`

## Global Constraints

- **The API transport does not change.** Requests keep carrying `?chainid=N` through `scoped()`. Only the browser URL moves. Do not touch `chainContext`, `strictChainId`, or `lib/chainParam.ts`.
- **Chain id is part of every cache key** keyed by a hash or address. Two production bugs came from omitting it (migrations 009 and 012).
- **CAIP-2 is written as two path segments** — `/eip155/369/…`, never `/eip155:369/…`. `docs/GIB_SHOW.md` records the colon form returning 404 against real infrastructure.
- **Chains served:** 1 (Ethereum), 369 (PulseChain), 943 (PulseChain Testnet v4), 11155111 (Sepolia). `DEFAULT_CHAIN_ID` is 369.
- **Rows are two lines, never three.** Main line carries the answer, subline carries qualifiers, further detail goes in a `primitives/Tooltip`.
- **Web styling:** outset box-shadow borders (`ring-1 ring-(--color-…)` or `shadow-[0_0_0_1px_…]`), never `border`. Square corners on anything that can reach a viewport edge. Padding `p-2 sm:p-4`. Numbers carry a mono, tabular face. No native `<select>` or checkbox.
- **Async event handlers** are called as `void handler()`.
- **Test commands:** web `npm run test --workspace=packages/web`; api unit `npm run test:unit --workspace=packages/api`.
- **Typecheck is part of done.** Web work must leave `npx tsc -b packages/web` silent; api work must leave `npm run typecheck --workspace=packages/api` silent. Vitest does not typecheck, so a green suite is not evidence the build passes. `packages/web/tsconfig.json` sets `noUncheckedIndexedAccess`, which makes every un-defaulted array destructure `T | undefined`.
- **Phase 1 changes no rendering.** If it moves a pixel, it is wrong.

---

## Phase 1 — Routing

### Task 1: Pin current behaviour with characterization tests

Two of the files this plan edits carry bug-fix history. Before anything moves, pin what they do today. These tests stay green through every later task.

**Files:**
- Test: `packages/web/src/__tests__/routingCharacterization.test.tsx` (create)

**Interfaces:**
- Consumes: `getActiveChainId` from `lib/activeChain`, `scanPath` from `lib/scanRoutes`, `scoped` from `api/chainScope`, `useResolvedChainRedirect` from `lib/useResolvedChainRedirect`.
- Produces: nothing. This task is a safety net.

- [ ] **Step 1: Write the characterization tests**

```tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { MemoryRouter, useSearchParams } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { getActiveChainId } from "../lib/activeChain";
import { scanPath } from "../lib/scanRoutes";
import { scoped } from "../api/chainScope";
import { DEFAULT_CHAIN_ID } from "../lib/chains";
import { useResolvedChainRedirect } from "../lib/useResolvedChainRedirect";

/**
 * Characterization tests. These pin behaviour that already ships, so the
 * multichain routing refactor cannot change it by accident. They are not
 * aspirational — if one fails, the refactor broke something real.
 */

const resolveMock = vi.hoisted(() => vi.fn());
vi.mock("../api/resolve", () => ({ resolveEntity: resolveMock }));

const original = window.location.href;
afterEach(() => {
  window.history.replaceState({}, "", original);
  resolveMock.mockReset();
});

function wrapper(initialEntry: string) {
  return function Wrapper({ children }: { children: ReactNode }) {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    return (
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[initialEntry]}>{children}</MemoryRouter>
      </QueryClientProvider>
    );
  };
}

describe("getActiveChainId — both router shapes", () => {
  it("reads chainid from location.search (BrowserRouter build)", () => {
    window.history.replaceState({}, "", "/tx/0xabc?chainid=1");
    expect(getActiveChainId()).toBe(1);
  });

  it("reads chainid from the hash query (HashRouter / IPFS build)", () => {
    window.history.replaceState({}, "", "/#/tx/0xabc?chainid=943");
    expect(getActiveChainId()).toBe(943);
  });

  it("treats an empty chainid as the default, not as absent", () => {
    window.history.replaceState({}, "", "/tx/0xabc?chainid=");
    expect(getActiveChainId()).toBe(DEFAULT_CHAIN_ID);
  });
});

describe("scanPath — EIP-3091 shapes", () => {
  it("builds today's bare paths", () => {
    expect(scanPath("tx", "0xabc")).toBe("/tx/0xabc");
    expect(scanPath("block", "123")).toBe("/block/123");
    expect(scanPath("address", "0xdef")).toBe("/address/0xdef");
    expect(scanPath("contract", "0xdef")).toBe("/token/0xdef");
  });
});

describe("scoped — API transport", () => {
  it("omits chainid for the default chain", () => {
    expect(scoped("/api/tx/0xabc", DEFAULT_CHAIN_ID)).toBe("/api/tx/0xabc");
  });

  it("appends chainid for any other chain, respecting an existing query", () => {
    expect(scoped("/api/tx/0xabc", 1)).toBe("/api/tx/0xabc?chainid=1");
    expect(scoped("/api/tx/0xabc?limit=5", 1)).toBe("/api/tx/0xabc?limit=5&chainid=1");
  });
});

describe("useResolvedChainRedirect — the three invariants", () => {
  it("invariant 1: does not run when the URL already names a chain", async () => {
    const { result } = renderHook(() => useResolvedChainRedirect("0xabc"), {
      wrapper: wrapper("/tx/0xabc?chainid=1"),
    });
    expect(result.current).toBe("idle");
    expect(resolveMock).not.toHaveBeenCalled();
  });

  it("invariant 2: stays 'resolving' until the redirect is applied", async () => {
    resolveMock.mockResolvedValue({ kind: "tx", query: "0xabc", matches: [{ chainId: 943 }] });
    const { result } = renderHook(() => useResolvedChainRedirect("0xabc"), {
      wrapper: wrapper("/tx/0xabc"),
    });
    expect(result.current).toBe("resolving");
    // Never reports "settled" while a redirect to a non-default chain is pending.
    await waitFor(() => expect(resolveMock).toHaveBeenCalled());
    expect(result.current).not.toBe("settled");
  });

  it("invariant 3: does not redirect when the entity is on the default chain", async () => {
    resolveMock.mockResolvedValue({
      kind: "tx",
      query: "0xabc",
      matches: [{ chainId: DEFAULT_CHAIN_ID }],
    });
    const seen: string[] = [];
    function Probe() {
      const [params] = useSearchParams();
      seen.push(params.get("chainid") ?? "absent");
      return useResolvedChainRedirect("0xabc");
    }
    const { result } = renderHook(() => Probe(), { wrapper: wrapper("/tx/0xabc") });
    await waitFor(() => expect(result.current).toBe("settled"));
    expect(seen.every((v) => v === "absent")).toBe(true);
  });
});
```

> **Correction applied during execution (commit `0c588cd`).** The invariant-2
> test above cannot fail: for a non-default chain the hook's observable state is
> `"idle"` by the time the test samples it, so `not.toBe("settled")` holds
> whether or not the invariant exists. The shipped test records the hook's value
> on every render and asserts `"settled"` never appears, and separately asserts
> the redirect writes `chainid=943`. Read the committed file, not the block
> above, if you need this test.

- [ ] **Step 2: Run the tests to verify they pass against current code**

Run: `npm run test --workspace=packages/web -- routingCharacterization`
Expected: PASS. These describe shipping behaviour. If any fails, stop and report — the assumption behind this plan is wrong.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/__tests__/routingCharacterization.test.tsx
git commit -m "test(web): pin routing behaviour before the multichain refactor"
```

---

### Task 2: Add the CAIP-2 mapping to both chain registries

**Files:**
- Modify: `packages/web/src/lib/chains.ts`
- Modify: `packages/api/src/services/chains/types.ts`
- Modify: `packages/api/src/services/chains/defaults.ts`
- Test: `packages/web/src/__tests__/chains.test.ts` (extend)
- Test: `packages/api/tests/unit/chainRegistry.test.ts` (extend)

**Interfaces:**
- Produces:
  - `interface Caip2 { namespace: string; reference: string }`
  - `ChainInfo.caip2: Caip2` (web), `ChainConfig.caip2: Caip2` (api)
  - `chainCaip2(chainId: number): Caip2 | undefined` (web)
  - `caip2ToChainId(namespace: string, reference: string): number | undefined` (web)

- [ ] **Step 1: Write the failing tests**

Append to `packages/web/src/__tests__/chains.test.ts`:

```ts
import { chainCaip2, caip2ToChainId } from "../lib/chains";

describe("CAIP-2 mapping", () => {
  it("gives every chain an eip155 namespace and its id as the reference", () => {
    for (const c of CHAINS) {
      expect(chainCaip2(c.id)).toEqual({ namespace: "eip155", reference: String(c.id) });
    }
  });

  it("round-trips a chain id through the CAIP-2 pair", () => {
    for (const c of CHAINS) {
      const caip2 = chainCaip2(c.id)!;
      expect(caip2ToChainId(caip2.namespace, caip2.reference)).toBe(c.id);
    }
  });

  it("rejects an unregistered chain and a foreign namespace", () => {
    expect(chainCaip2(8453)).toBeUndefined();
    expect(caip2ToChainId("eip155", "8453")).toBeUndefined();
    expect(caip2ToChainId("bip122", "369")).toBeUndefined();
  });

  it("matches the namespace case-insensitively but never the colon form", () => {
    expect(caip2ToChainId("EIP155", "369")).toBe(369);
    expect(caip2ToChainId("eip155:369", "")).toBeUndefined();
  });
});
```

Append to `packages/api/tests/unit/chainRegistry.test.ts`:

```ts
describe("chain registry — CAIP-2", () => {
  it("gives every chain an eip155 namespace and its id as the reference", () => {
    for (const c of listChains()) {
      assert.deepEqual(c.caip2, { namespace: "eip155", reference: String(c.chainId) });
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test --workspace=packages/web -- chains` and `npm run test:unit --workspace=packages/api`
Expected: FAIL — `chainCaip2 is not a function`, and `c.caip2` is `undefined`.

- [ ] **Step 3: Implement in the web registry**

In `packages/web/src/lib/chains.ts`, add to the `ChainInfo` interface and each `CHAINS` entry, then export the two helpers:

```ts
/**
 * The two halves of a CAIP-2 chain id, kept as separate fields because the URL
 * scheme writes them as separate path segments (/eip155/369/…). The colon form
 * is deliberately unused: docs/GIB_SHOW.md records /image/eip155:369 returning
 * 404 where the dash form returns 200, so the colon does not survive real
 * infrastructure.
 */
export interface Caip2 {
  namespace: string;
  reference: string;
}

// …add to ChainInfo:
//   /** CAIP-2 identity. Drives the /{namespace}/{reference}/… route prefix. */
//   caip2: Caip2;
//
// …and to every CHAINS entry, e.g. for Ethereum:
//   caip2: { namespace: "eip155", reference: "1" },

/** The CAIP-2 pair for a registered chain, or undefined if we do not serve it. */
export function chainCaip2(id: number): Caip2 | undefined {
  return chainById(id)?.caip2;
}

/**
 * The chain id for a CAIP-2 pair, or undefined for a namespace we do not serve
 * and for any id outside the registry. The namespace match is case-insensitive
 * because URLs get typed by hand; the reference is compared exactly, so a
 * colon-form string never matches.
 */
export function caip2ToChainId(namespace: string, reference: string): number | undefined {
  const ns = namespace.toLowerCase();
  return CHAINS.find((c) => c.caip2.namespace === ns && c.caip2.reference === reference)?.id;
}
```

- [ ] **Step 4: Implement in the api registry**

In `packages/api/src/services/chains/types.ts`, add to `ChainConfig`:

```ts
  /** CAIP-2 identity, mirrored by the web registry's ChainInfo.caip2. */
  caip2: { namespace: string; reference: string };
```

In `packages/api/src/services/chains/defaults.ts`, add `caip2` to each of the four `VALVE_DEFAULT_CHAINS` entries:

```ts
  caip2: { namespace: "eip155", reference: "1" },      // chain 1
  caip2: { namespace: "eip155", reference: "369" },    // chain 369
  caip2: { namespace: "eip155", reference: "943" },    // chain 943
  caip2: { namespace: "eip155", reference: "11155111" }, // chain 11155111
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test --workspace=packages/web -- chains` and `npm run test:unit --workspace=packages/api`
Expected: PASS. Also run `npm run typecheck --workspace=packages/api` — `ChainConfig.caip2` is required, so a chains-config loader that builds a `ChainConfig` will fail to compile until it sets the field. Fix `loadConfig.ts` by deriving it: `caip2: { namespace: "eip155", reference: String(chainId) }`.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/lib/chains.ts packages/web/src/__tests__/chains.test.ts \
        packages/api/src/services/chains/types.ts \
        packages/api/src/services/chains/defaults.ts \
        packages/api/src/services/chains/loadConfig.ts \
        packages/api/tests/unit/chainRegistry.test.ts
git commit -m "feat(chains): give every chain its CAIP-2 identity"
```

---

### Task 3: Write the chain-scope parser

**Files:**
- Create: `packages/web/src/lib/chainScope.ts`
- Test: `packages/web/src/__tests__/chainScope.test.ts` (create)

**Interfaces:**
- Consumes: `caip2ToChainId`, `DEFAULT_CHAIN_ID` from `lib/chains` (Task 2).
- Produces:
  - `type ChainScope = { kind: "one"; chainId: number } | { kind: "all" }`
  - `parseChainScope(pathname: string, search: string): ChainScope`
  - `chainRoutePrefix(chainId: number): string` → `"/eip155/369"`
  - `readLocationScope(): ChainScope` — non-reactive, handles both router shapes

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect, afterEach } from "vitest";
import {
  parseChainScope,
  chainRoutePrefix,
  readLocationScope,
} from "../lib/chainScope";

const original = window.location.href;
afterEach(() => window.history.replaceState({}, "", original));

describe("parseChainScope", () => {
  it("reads the chain from a path prefix", () => {
    expect(parseChainScope("/eip155/369/tx/0xabc", "")).toEqual({ kind: "one", chainId: 369 });
    expect(parseChainScope("/eip155/11155111/address/0xdef", "")).toEqual({
      kind: "one",
      chainId: 11155111,
    });
  });

  it("lets the path prefix beat a conflicting chainid parameter", () => {
    expect(parseChainScope("/eip155/1/tx/0xabc", "?chainid=369")).toEqual({
      kind: "one",
      chainId: 1,
    });
  });

  it("falls back to the chainid parameter when there is no prefix", () => {
    expect(parseChainScope("/tx/0xabc", "?chainid=943")).toEqual({ kind: "one", chainId: 943 });
  });

  it("reports 'all' when neither is present", () => {
    expect(parseChainScope("/address/0xdef", "")).toEqual({ kind: "all" });
  });

  it("reports 'all' for an unknown namespace or an unregistered reference", () => {
    expect(parseChainScope("/bip122/000000000019d6/tx/4a5e", "")).toEqual({ kind: "all" });
    expect(parseChainScope("/eip155/8453/tx/0xabc", "")).toEqual({ kind: "all" });
    expect(parseChainScope("/eip155/abc/tx/0xabc", "")).toEqual({ kind: "all" });
  });

  it("ignores a bare namespace with no reference", () => {
    expect(parseChainScope("/eip155", "")).toEqual({ kind: "all" });
    expect(parseChainScope("/eip155/", "")).toEqual({ kind: "all" });
  });

  it("treats an empty or malformed chainid as 'all', not as a chain", () => {
    expect(parseChainScope("/tx/0xabc", "?chainid=")).toEqual({ kind: "all" });
    expect(parseChainScope("/tx/0xabc", "?chainid=abc")).toEqual({ kind: "all" });
    expect(parseChainScope("/tx/0xabc", "?chainid=0")).toEqual({ kind: "all" });
    expect(parseChainScope("/tx/0xabc", "?chainid=-5")).toEqual({ kind: "all" });
  });
});

describe("chainRoutePrefix", () => {
  it("builds the two-segment prefix", () => {
    expect(chainRoutePrefix(369)).toBe("/eip155/369");
    expect(chainRoutePrefix(11155111)).toBe("/eip155/11155111");
  });

  it("returns an empty prefix for an unregistered chain", () => {
    expect(chainRoutePrefix(8453)).toBe("");
  });
});

describe("readLocationScope — both router shapes", () => {
  it("reads a path prefix under BrowserRouter", () => {
    window.history.replaceState({}, "", "/eip155/1/tx/0xabc");
    expect(readLocationScope()).toEqual({ kind: "one", chainId: 1 });
  });

  it("reads a path prefix inside the hash under HashRouter", () => {
    window.history.replaceState({}, "", "/#/eip155/943/tx/0xabc");
    expect(readLocationScope()).toEqual({ kind: "one", chainId: 943 });
  });

  it("reads a chainid query inside the hash under HashRouter", () => {
    window.history.replaceState({}, "", "/#/tx/0xabc?chainid=369");
    expect(readLocationScope()).toEqual({ kind: "one", chainId: 369 });
  });

  it("returns 'all' in a no-window (SSR) environment", () => {
    const g = globalThis as { window?: Window };
    const saved = g.window;
    delete g.window;
    try {
      expect(readLocationScope()).toEqual({ kind: "all" });
    } finally {
      g.window = saved;
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test --workspace=packages/web -- chainScope`
Expected: FAIL — cannot resolve `../lib/chainScope`.

- [ ] **Step 3: Write the implementation**

```ts
import { caip2ToChainId, chainCaip2 } from "./chains";

/**
 * The single reader for "what chain is this page about?".
 *
 * Chain scope used to live only in `?chainid=N`, which made it a second-class
 * citizen: it did not compose with routing, and it had no room for a non-EVM
 * chain. Scope now lives in the path as two CAIP-2 segments —
 * `/eip155/369/tx/0x…` — and the query parameter survives only as a legacy
 * form that gets rewritten once.
 *
 * Resolution order, highest first:
 *   1. the path prefix
 *   2. the `?chainid=N` query parameter (legacy)
 *   3. neither → "all"
 *
 * "All" is a real scope for exactly three routes — /address/:addr,
 * /token/:addr, /block/:number — which render every chain. Every other route
 * collapses "all" to DEFAULT_CHAIN_ID, which is what shipped before. That
 * collapse happens in `useActiveChainId`, not here, so this module stays a
 * pure description of the URL.
 */
export type ChainScope =
  | { kind: "one"; chainId: number }
  | { kind: "all" };

const ALL: ChainScope = { kind: "all" };

/** Chain id from the two leading path segments, or undefined. */
function scopeFromPath(pathname: string): number | undefined {
  const [, namespace, reference] = pathname.split("/");
  if (!namespace || !reference) return undefined;
  return caip2ToChainId(namespace, reference);
}

/** Chain id from `?chainid=N`, or undefined for absent/malformed values. */
function scopeFromQuery(search: string): number | undefined {
  const raw = new URLSearchParams(search).get("chainid");
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

export function parseChainScope(pathname: string, search: string): ChainScope {
  const fromPath = scopeFromPath(pathname);
  if (fromPath !== undefined) return { kind: "one", chainId: fromPath };
  const fromQuery = scopeFromQuery(search);
  if (fromQuery !== undefined) return { kind: "one", chainId: fromQuery };
  return ALL;
}

/**
 * The route prefix for a chain — `/eip155/369`. Empty string for a chain we do
 * not serve, so a caller concatenating it produces the bare path rather than a
 * route that resolves to nothing.
 */
export function chainRoutePrefix(chainId: number): string {
  const pair = chainCaip2(chainId);
  return pair ? `/${pair.namespace}/${pair.reference}` : "";
}

/**
 * Non-reactive scope read for fetch-layer code that runs outside a component.
 * Handles both router shapes: BrowserRouter keeps the path in `pathname` and
 * the query in `search`; the IPFS HashRouter build carries BOTH inside the
 * hash (`/#/eip155/369/tx/0x…?chainid=N`).
 *
 * Components should prefer `useChainScope` — it re-renders on navigation and
 * feeds query keys. This getter only reflects the URL at call time.
 */
export function readLocationScope(): ChainScope {
  if (typeof window === "undefined") return ALL;
  const hash = window.location.hash.startsWith("#/") ? window.location.hash.slice(1) : "";
  if (hash) {
    // `noUncheckedIndexedAccess` is on, so BOTH elements need a default.
    const [path = "", query = ""] = hash.split("?");
    return parseChainScope(path, query ? `?${query}` : "");
  }
  return parseChainScope(window.location.pathname, window.location.search);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test --workspace=packages/web -- chainScope`
Expected: PASS, all 15 cases.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/lib/chainScope.ts packages/web/src/__tests__/chainScope.test.ts
git commit -m "feat(web): read chain scope from the path, not just the query"
```

---

### Task 4: Point `activeChain` at the new parser

**Files:**
- Modify: `packages/web/src/lib/activeChain.ts`
- Test: `packages/web/src/__tests__/activeChain.test.ts` (extend)

**Interfaces:**
- Consumes: `parseChainScope`, `readLocationScope` from `lib/chainScope` (Task 3).
- Produces: `useChainScope(): ChainScope`. `useActiveChainId()` and `getActiveChainId()` keep their exact existing signatures (`(): number`).

- [ ] **Step 1: Write the failing tests**

Append to `packages/web/src/__tests__/activeChain.test.ts`:

```ts
describe("getActiveChainId — path prefix", () => {
  it("reads the chain from a path prefix", () => {
    window.history.replaceState({}, "", "/eip155/1/tx/0xabc");
    expect(getActiveChainId()).toBe(1);
  });

  it("reads a path prefix inside the hash (HashRouter / IPFS build)", () => {
    window.history.replaceState({}, "", "/#/eip155/943/tx/0xabc");
    expect(getActiveChainId()).toBe(943);
  });

  it("lets the path prefix beat a conflicting chainid parameter", () => {
    window.history.replaceState({}, "", "/eip155/1/tx/0xabc?chainid=369");
    expect(getActiveChainId()).toBe(1);
  });

  it("still defaults to PulseChain for an unscoped URL", () => {
    window.history.replaceState({}, "", "/address/0xdef");
    expect(getActiveChainId()).toBe(DEFAULT_CHAIN_ID);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test --workspace=packages/web -- activeChain`
Expected: FAIL — the path-prefix cases return `DEFAULT_CHAIN_ID` (369) instead of 1 and 943.

- [ ] **Step 3: Rewrite `activeChain.ts` to delegate**

```ts
import { useLocation, useSearchParams } from "react-router-dom";
import { DEFAULT_CHAIN_ID } from "./chains";
import { parseChainScope, readLocationScope, type ChainScope } from "./chainScope";

/**
 * The full chain scope of the current route: one chain, or every chain.
 *
 * Only three routes render an "all" scope — /address/:addr, /token/:addr and
 * /block/:number. Everything else uses `useActiveChainId`, which collapses
 * "all" to the default chain and so keeps its pre-multichain behaviour exactly.
 */
export function useChainScope(): ChainScope {
  const location = useLocation();
  const [params] = useSearchParams();
  return parseChainScope(location.pathname, `?${params.toString()}`);
}

/**
 * The chain a route is scoped to, defaulting to PulseChain. Signature unchanged
 * from the `?chainid=N`-only era on purpose: ~40 call sites read this, and the
 * routing change must not reach any of them.
 */
export function useActiveChainId(): number {
  const scope = useChainScope();
  return scope.kind === "one" ? scope.chainId : DEFAULT_CHAIN_ID;
}

/**
 * Non-reactive read of the same scope, for fetch-layer code that runs outside a
 * component (api/source.ts, contractMeta.ts). Handles both router shapes — see
 * `readLocationScope`.
 */
export function getActiveChainId(): number {
  const scope = readLocationScope();
  return scope.kind === "one" ? scope.chainId : DEFAULT_CHAIN_ID;
}
```

- [ ] **Step 4: Run the full web suite**

Run: `npm run test --workspace=packages/web`
Expected: PASS, including Task 1's characterization tests. The `?chainid=` empty-string case still yields `DEFAULT_CHAIN_ID` — `parseChainScope` returns "all" for it and `getActiveChainId` collapses that to the default, which is the same answer by a different route.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/lib/activeChain.ts packages/web/src/__tests__/activeChain.test.ts
git commit -m "refactor(web): route activeChain through the chain-scope parser"
```

---

### Task 5: Teach `scanPath` to build prefixed paths

**Files:**
- Modify: `packages/web/src/lib/scanRoutes.ts`
- Test: `packages/web/src/__tests__/scanRoutes.test.ts` (create)

**Interfaces:**
- Consumes: `chainRoutePrefix` from `lib/chainScope` (Task 3).
- Produces: `scanPath(kind: ScanKind, value: string, chainId?: number): string`. The existing two-argument calls keep working unchanged.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { scanPath } from "../lib/scanRoutes";

describe("scanPath", () => {
  it("builds bare EIP-3091 paths when no chain is given", () => {
    expect(scanPath("tx", "0xabc")).toBe("/tx/0xabc");
    expect(scanPath("block", "123")).toBe("/block/123");
    expect(scanPath("address", "0xdef")).toBe("/address/0xdef");
    expect(scanPath("contract", "0xdef")).toBe("/token/0xdef");
  });

  it("prefixes the path when a chain is given", () => {
    expect(scanPath("tx", "0xabc", 369)).toBe("/eip155/369/tx/0xabc");
    expect(scanPath("address", "0xdef", 1)).toBe("/eip155/1/address/0xdef");
    expect(scanPath("contract", "0xdef", 11155111)).toBe("/eip155/11155111/token/0xdef");
  });

  it("falls back to the bare path for an unregistered chain", () => {
    expect(scanPath("tx", "0xabc", 8453)).toBe("/tx/0xabc");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace=packages/web -- scanRoutes`
Expected: FAIL — the prefixed cases return the bare path, because the third argument is ignored.

- [ ] **Step 3: Implement**

Replace the body of `packages/web/src/lib/scanRoutes.ts`:

```ts
import { chainRoutePrefix } from "./chainScope";

/**
 * Canonical block-explorer routes, per EIP-3091
 * (https://eips.ethereum.org/EIPS/eip-3091). All scan navigation goes through
 * here so the path scheme stays consistent — never query strings.
 *
 *   tx       → /tx/<hash>
 *   block    → /block/<number|hash>
 *   address  → /address/<address>   (EOA or unknown)
 *   contract → /token/<address>     (a contract-detail page)
 *
 * Pass `chainId` to scope the path to one chain — the CAIP-2 prefix goes in
 * front: `/eip155/369/tx/<hash>`. Omit it for the chain-less form, which the
 * address, token and block-number routes render as "every chain". This is the
 * only place an entity path is built; never concatenate one by hand.
 */
export type ScanKind = "tx" | "block" | "address" | "contract";

function bareScanPath(kind: ScanKind, value: string): string {
  switch (kind) {
    case "tx":
      return `/tx/${value}`;
    case "block":
      return `/block/${value}`;
    case "address":
      return `/address/${value}`;
    case "contract":
      return `/token/${value}`;
  }
}

export function scanPath(kind: ScanKind, value: string, chainId?: number): string {
  const bare = bareScanPath(kind, value);
  // An unregistered chain yields an empty prefix, so the caller gets the bare
  // path rather than a route that resolves to nothing.
  return chainId === undefined ? bare : `${chainRoutePrefix(chainId)}${bare}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test --workspace=packages/web -- scanRoutes` then the full web suite.
Expected: PASS. Task 1's characterization test for the bare shapes still passes, because the third argument is optional.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/lib/scanRoutes.ts packages/web/src/__tests__/scanRoutes.test.ts
git commit -m "feat(web): let scanPath build chain-prefixed entity paths"
```

---

### Task 6: Mount the chain-scoped route subtree and rewrite legacy URLs

**Files:**
- Modify: `packages/web/src/App.tsx`
- Create: `packages/web/src/components/routing/ChainScopedRoutes.tsx`
- Create: `packages/web/src/components/routing/LegacyChainParamRedirect.tsx`
- Test: `packages/web/src/__tests__/chainScopedRouting.test.tsx` (create)

**Interfaces:**
- Consumes: `parseChainScope`, `chainRoutePrefix` from `lib/chainScope`.
- Produces: `<AppRoutes />` (the route table, extracted from `App.tsx`), `<ChainScopedRoutes />`, `<LegacyChainParamRedirect />`.

- [ ] **Step 1: Write the failing tests**

```tsx
import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import ChainScopedRoutes from "../components/routing/ChainScopedRoutes";
import LegacyChainParamRedirect from "../components/routing/LegacyChainParamRedirect";

function Probe() {
  const location = useLocation();
  return <div data-testid="url">{location.pathname + location.search}</div>;
}

function renderAt(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <LegacyChainParamRedirect />
      <Routes>
        <Route path="/settings" element={<div data-testid="hit">settings</div>} />
        <Route path="/workspace/:id" element={<div data-testid="hit">workspace</div>} />
        <Route path="/:ns/:ref/*" element={<ChainScopedRoutes><Probe /></ChainScopedRoutes>} />
        <Route path="/*" element={<Probe />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("route ranking", () => {
  it("gives a static two-segment route priority over the chain prefix", () => {
    renderAt("/workspace/abc");
    expect(screen.getByTestId("hit")).toHaveTextContent("workspace");
  });

  it("gives a static one-segment route priority", () => {
    renderAt("/settings");
    expect(screen.getByTestId("hit")).toHaveTextContent("settings");
  });
});

describe("ChainScopedRoutes", () => {
  it("renders the child tree for a served chain", () => {
    renderAt("/eip155/369/tx/0xabc");
    expect(screen.getByTestId("url")).toHaveTextContent("/eip155/369/tx/0xabc");
  });

  it("renders not-found for an unserved namespace instead of falling through", () => {
    renderAt("/bip122/000000000019d6/tx/4a5e");
    expect(screen.getByText(/unsupported chain/i)).toBeInTheDocument();
  });

  it("renders not-found for an unregistered reference", () => {
    renderAt("/eip155/8453/tx/0xabc");
    expect(screen.getByText(/unsupported chain/i)).toBeInTheDocument();
  });
});

describe("LegacyChainParamRedirect", () => {
  it("rewrites ?chainid=N into the path form once", async () => {
    renderAt("/tx/0xabc?chainid=943");
    await waitFor(() =>
      expect(screen.getByTestId("url")).toHaveTextContent("/eip155/943/tx/0xabc"),
    );
    expect(screen.getByTestId("url")).not.toHaveTextContent("chainid");
  });

  it("preserves other query parameters while stripping chainid", async () => {
    renderAt("/tx/0xabc?chainid=1&tab=logs");
    await waitFor(() => expect(screen.getByTestId("url")).toHaveTextContent("tab=logs"));
    expect(screen.getByTestId("url")).toHaveTextContent("/eip155/1/tx/0xabc");
  });

  it("does not fire when the path already carries a prefix", () => {
    renderAt("/eip155/369/tx/0xabc?chainid=1");
    // No rewrite: an explicit prefix wins and re-writing would loop.
    expect(screen.getByTestId("url")).toHaveTextContent("chainid=1");
  });

  it("does not fire for an unregistered chainid", () => {
    renderAt("/tx/0xabc?chainid=8453");
    expect(screen.getByTestId("url")).toHaveTextContent("/tx/0xabc?chainid=8453");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test --workspace=packages/web -- chainScopedRouting`
Expected: FAIL — cannot resolve the two new components.

- [ ] **Step 3: Write `ChainScopedRoutes`**

```tsx
import { type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { caip2ToChainId } from "../../lib/chains";

/**
 * The `/{namespace}/{reference}/…` subtree.
 *
 * Validates the CAIP-2 pair against the registry before rendering anything. An
 * unserved namespace or an unregistered reference renders a message rather than
 * falling through to the unscoped tree — falling through would render the page
 * against the default chain and quietly answer a question nobody asked.
 *
 * Children read the resolved chain through `useActiveChainId`, which parses the
 * same prefix. There is no context to thread, and deliberately so: one parser,
 * one answer.
 */
export default function ChainScopedRoutes({ children }: { children: ReactNode }) {
  const { ns = "", ref = "" } = useParams<{ ns: string; ref: string }>();
  const chainId = caip2ToChainId(ns, ref);

  if (chainId === undefined) {
    return (
      <div className="p-2 sm:p-4 shadow-[0_0_0_1px_var(--color-border-default)]">
        <p className="theme-text">Unsupported chain</p>
        <p className="theme-text-secondary theme-mono text-sm">
          {ns}/{ref} is not a chain Explore serves.
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
```

- [ ] **Step 4: Write `LegacyChainParamRedirect`**

```tsx
import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { chainRoutePrefix, parseChainScope } from "../../lib/chainScope";

/**
 * One-time rewrite of the legacy `?chainid=N` form into the path form.
 *
 * Fires only when the path has NO chain prefix. That condition is what makes a
 * loop impossible: the rewrite writes a prefix, and a prefixed path never
 * re-enters this branch. It mirrors the same rule in `useResolvedChainRedirect`
 * — writing the scope is what disables the thing that writes it.
 *
 * An unregistered chainid is left alone. `chainRoutePrefix` returns "" for it,
 * and rewriting to a bare path would silently change which chain the page is
 * about.
 */
export default function LegacyChainParamRedirect() {
  const location = useLocation();
  const navigate = useNavigate();

  const params = new URLSearchParams(location.search);
  const hasParam = params.has("chainid");
  // parseChainScope prefers the path, so a prefixed path yields the path's id.
  // Compare against the raw parameter to detect "prefix already present".
  const prefixed = parseChainScope(location.pathname, "").kind === "one";
  const raw = params.get("chainid");
  const chainId = raw !== null && Number.isInteger(Number(raw)) ? Number(raw) : NaN;
  const prefix = Number.isNaN(chainId) ? "" : chainRoutePrefix(chainId);
  const shouldRewrite = hasParam && !prefixed && prefix !== "";

  useEffect(() => {
    if (!shouldRewrite) return;
    const next = new URLSearchParams(location.search);
    next.delete("chainid");
    const query = next.toString();
    navigate(`${prefix}${location.pathname}${query ? `?${query}` : ""}`, { replace: true });
  }, [shouldRewrite, prefix, location.pathname, location.search, navigate]);

  return null;
}
```

- [ ] **Step 5: Extract the route table in `App.tsx` and mount it twice**

Move the entire `<Routes>…</Routes>` body from `App.tsx` into a new local component `AppRoutes`, then render:

```tsx
<ErrorBoundary resetKey={location.pathname}>
  <LegacyChainParamRedirect />
  <Suspense fallback={<RouteFallback />}>
    <Routes>
      {/* Chain-scoped subtree: /eip155/369/tx/0xabc… Validated, then the same
          route table renders underneath. React Router ranks static segments
          above dynamic ones, so /settings and /workspace/:id still win. */}
      <Route
        path="/:ns/:ref/*"
        element={
          <ChainScopedRoutes>
            <AppRoutes />
          </ChainScopedRoutes>
        }
      />
      <Route path="/*" element={<AppRoutes />} />
    </Routes>
  </Suspense>
</ErrorBoundary>
```

`AppRoutes` keeps every existing `<Route>` exactly as it is today. Do not change a single path string in it.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm run test --workspace=packages/web`
Expected: PASS, whole suite. Task 1's characterization tests must still be green.

- [ ] **Step 7: Verify by running the app**

```bash
npm run dev
```

Check each of these renders the same page it did before:
- `http://localhost:5173/tx/<a 369 tx hash>` — unchanged
- `http://localhost:5173/tx/<hash>?chainid=1` — rewrites to `/eip155/1/tx/<hash>`, same content
- `http://localhost:5173/eip155/1/address/0x11490E0f8050FA8A3f40C5aA9bB20fB76B010b68` — Ethereum
- `http://localhost:5173/settings` — settings, not "Unsupported chain"
- `http://localhost:5173/bip122/000/tx/0xabc` — "Unsupported chain"

- [ ] **Step 8: Commit**

```bash
git add packages/web/src/App.tsx packages/web/src/components/routing/ \
        packages/web/src/__tests__/chainScopedRouting.test.tsx
git commit -m "feat(web): mount the chain-scoped route subtree"
```

---

## Phase 2 — Endpoints

### Task 7: Build the shared chain-presence service

**Files:**
- Create: `packages/api/src/services/multichain/chainPresence.ts`
- Test: `packages/api/tests/unit/chainPresence.test.ts` (create)

**Interfaces:**
- Consumes: `listChains` from `services/chains/registry.js`, `runWithChain` from `services/chains/context.js`, `getRpcClient` from `services/chains/clients.js`.
- Produces:
  - `interface ChainPresence { chainId: number; balance: string; nonce: number; isContract: boolean; error?: true }`
  - `interface PresenceDeps { chainIds(): number[]; getClient(chainId: number): PublicClient; timeoutMs: number; now(): number }`
  - `getChainPresence(address: string, chainIds: number[] | undefined, deps?: PresenceDeps): Promise<ChainPresence[]>`
  - `hasPresence(p: ChainPresence): boolean`
  - `clearPresenceCache(): void`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  getChainPresence,
  hasPresence,
  clearPresenceCache,
  type PresenceDeps,
} from "../../src/services/multichain/chainPresence.js";

const ADDR = "0x11490e0f8050fa8a3f40c5aa9bb20fb76b010b68";
const OTHER = "0x00000000219ab540356cbb839cbe05303d7705fa";

/**
 * Unit tests for the cross-chain presence probe. Deps are injected, so no live
 * RPC is involved. The cache key is the interesting part: chain id must be in
 * it, because migrations 009 and 012 both exist to fix caches that left it out.
 */

function deps(overrides: Partial<PresenceDeps> = {}): PresenceDeps {
  let clock = 1_000;
  return {
    chainIds: () => [1, 369, 943, 11155111],
    getClient: (chainId: number) =>
      ({
        getCode: async () => (chainId === 1 ? "0x6080" : undefined),
        getBalance: async () => (chainId === 369 ? 5n : 0n),
        getTransactionCount: async () => (chainId === 369 ? 94 : 0),
      }) as never,
    timeoutMs: 50,
    now: () => clock++,
    ...overrides,
  };
}

describe("getChainPresence", () => {
  beforeEach(() => clearPresenceCache());

  it("reports one row per chain, ascending", async () => {
    const rows = await getChainPresence(ADDR, undefined, deps());
    assert.deepEqual(rows.map((r) => r.chainId), [1, 369, 943, 11155111]);
  });

  it("marks a chain present when it has code, a balance, or a nonce", async () => {
    const rows = await getChainPresence(ADDR, undefined, deps());
    assert.equal(hasPresence(rows.find((r) => r.chainId === 1)!), true);   // code
    assert.equal(hasPresence(rows.find((r) => r.chainId === 369)!), true); // balance + nonce
    assert.equal(hasPresence(rows.find((r) => r.chainId === 943)!), false);
  });

  it("serializes the balance as a string, never a BigInt", async () => {
    const rows = await getChainPresence(ADDR, undefined, deps());
    assert.equal(typeof rows.find((r) => r.chainId === 369)!.balance, "string");
    assert.equal(rows.find((r) => r.chainId === 369)!.balance, "5");
  });

  it("marks a failing chain as errored rather than absent", async () => {
    const rows = await getChainPresence(ADDR, undefined, deps({
      getClient: (chainId: number) => {
        if (chainId === 11155111) throw new Error("rpc unconfigured");
        return {
          getCode: async () => undefined,
          getBalance: async () => 0n,
          getTransactionCount: async () => 0,
        } as never;
      },
    }));
    const sepolia = rows.find((r) => r.chainId === 11155111)!;
    assert.equal(sepolia.error, true);
    assert.equal(hasPresence(sepolia), false);
  });

  it("does not fail the whole probe when one chain times out", async () => {
    const rows = await getChainPresence(ADDR, undefined, deps({
      timeoutMs: 5,
      getClient: (chainId: number) =>
        ({
          getCode: async () =>
            chainId === 1 ? new Promise((r) => setTimeout(() => r(undefined), 50)) : undefined,
          getBalance: async () => 0n,
          getTransactionCount: async () => 0,
        }) as never,
    }));
    assert.equal(rows.length, 4);
    assert.equal(rows.find((r) => r.chainId === 1)!.error, true);
  });

  it("honours an explicit chain allowlist", async () => {
    const rows = await getChainPresence(ADDR, [1, 369], deps());
    assert.deepEqual(rows.map((r) => r.chainId), [1, 369]);
  });

  it("caches by chain id AND address, never by address alone", async () => {
    let calls = 0;
    const counting = deps({
      getClient: () =>
        ({
          getCode: async () => { calls++; return undefined; },
          getBalance: async () => 0n,
          getTransactionCount: async () => 0,
        }) as never,
    });
    await getChainPresence(ADDR, [1, 369], counting);
    assert.equal(calls, 2);
    await getChainPresence(ADDR, [1, 369], counting); // served from cache
    assert.equal(calls, 2);
    await getChainPresence(OTHER, [1, 369], counting); // different address
    assert.equal(calls, 4);
    await getChainPresence(ADDR, [943], counting);     // different chain
    assert.equal(calls, 5);
  });

  it("normalizes the address so case does not split the cache", async () => {
    let calls = 0;
    const counting = deps({
      getClient: () =>
        ({
          getCode: async () => { calls++; return undefined; },
          getBalance: async () => 0n,
          getTransactionCount: async () => 0,
        }) as never,
    });
    await getChainPresence(ADDR, [1], counting);
    await getChainPresence(ADDR.toUpperCase().replace("0X", "0x"), [1], counting);
    assert.equal(calls, 1);
  });

  it("does not cache an errored probe", async () => {
    let calls = 0;
    const failing = deps({
      chainIds: () => [1],
      getClient: () =>
        ({
          getCode: async () => { calls++; throw new Error("down"); },
          getBalance: async () => 0n,
          getTransactionCount: async () => 0,
        }) as never,
    });
    await getChainPresence(ADDR, [1], failing);
    await getChainPresence(ADDR, [1], failing);
    assert.equal(calls, 2); // a failure must be retried, not pinned
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:unit --workspace=packages/api`
Expected: FAIL — cannot resolve `chainPresence.js`.

- [ ] **Step 3: Write the implementation**

```ts
import type { Address, PublicClient } from "viem";
import { getRpcClient } from "../chains/clients.js";
import { listChains } from "../chains/registry.js";

/**
 * Cross-chain presence probe — "which chains is this address worth opening on?".
 *
 * An address is valid on every EVM chain, so existence proves nothing. Presence
 * means bytecode, a non-zero nonce, or a non-zero balance. This is the same
 * question `services/resolve/resolveEntity.ts` asks per chain; the difference is
 * that this one keeps the answer, caches it, and reports failures instead of
 * folding them into "not here".
 *
 * The fan-out is the cheap half of the multichain address page: three reads per
 * chain, batched by viem. Only chains that come back present pay for the
 * expensive activity fetch. Prod has 429'd on Ethereum before (see the comment
 * in chains/defaults.ts), so this budget is a requirement, not an optimisation.
 *
 * Deps are injected so the fan-out is unit-testable without any live RPC.
 */

export interface ChainPresence {
  chainId: number;
  /** Native balance in wei, serialized — BigInt never reaches JSON. */
  balance: string;
  nonce: number;
  isContract: boolean;
  /** Set when the probe failed. Means "unknown", NOT "absent". */
  error?: true;
}

export interface PresenceDeps {
  chainIds: () => number[];
  getClient: (chainId: number) => PublicClient;
  timeoutMs: number;
  now: () => number;
}

const defaultDeps: PresenceDeps = {
  chainIds: () => listChains().map((c) => c.chainId),
  getClient: getRpcClient,
  timeoutMs: 7_000,
  now: () => Date.now(),
};

/** Presence changes slowly; a short TTL collapses repeat page loads. */
const TTL_MS = 60_000;

interface CacheEntry {
  value: ChainPresence;
  expiresAt: number;
}

/**
 * Cache key is `${chainId}|${address}`. The chain id is NOT optional: two
 * production bugs (migrations 009 and 012) came from caching chain data under a
 * key that omitted it, which served one chain's answer for every chain.
 */
const cache = new Map<string, CacheEntry>();

export function clearPresenceCache(): void {
  cache.clear();
}

/** A chain is worth showing when the address has code, funds, or history. */
export function hasPresence(p: ChainPresence): boolean {
  if (p.error) return false;
  return p.isContract || p.nonce > 0 || p.balance !== "0";
}

export async function getChainPresence(
  address: string,
  chainIds?: number[],
  deps: PresenceDeps = defaultDeps,
): Promise<ChainPresence[]> {
  const addr = address.trim().toLowerCase();
  const ids = (chainIds ?? deps.chainIds()).slice().sort((a, b) => a - b);

  return Promise.all(ids.map((chainId) => probeOne(addr, chainId, deps)));
}

async function probeOne(
  address: string,
  chainId: number,
  deps: PresenceDeps,
): Promise<ChainPresence> {
  const key = `${chainId}|${address}`;
  const hit = cache.get(key);
  if (hit && hit.expiresAt > deps.now()) return hit.value;

  const value = await withTimeout(read(address, chainId, deps), deps.timeoutMs).catch(
    (): ChainPresence => ({
      chainId,
      balance: "0",
      nonce: 0,
      isContract: false,
      error: true,
    }),
  );

  // Never pin a failure. An unreachable RPC recovers; a cached "error" would
  // outlive the outage and read as a fact.
  if (!value.error) {
    cache.set(key, { value, expiresAt: deps.now() + TTL_MS });
  }
  return value;
}

async function read(
  address: string,
  chainId: number,
  deps: PresenceDeps,
): Promise<ChainPresence> {
  const client = deps.getClient(chainId);
  const [code, balance, nonce] = await Promise.all([
    client.getCode({ address: address as Address }),
    client.getBalance({ address: address as Address }),
    client.getTransactionCount({ address: address as Address }),
  ]);
  return {
    chainId,
    balance: String(balance ?? 0n),
    nonce: Number(nonce ?? 0),
    isContract: !!code && code !== "0x",
  };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("probe timed out")), ms),
    ),
  ]);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:unit --workspace=packages/api`
Expected: PASS, all 9 cases.

- [ ] **Step 5: Write the failing test for the shared cache**

`/api/resolve` runs this exact probe today and throws the answer away. Sharing one service and one cache is fan-out control 3 in the spec: after a search, the address page's probe is already warm.

Append to `packages/api/tests/unit/chainPresence.test.ts`:

```ts
import { resolveEntity } from "../../src/services/resolve/resolveEntity.js";

describe("resolve shares the presence cache", () => {
  it("does not re-probe a chain the presence service already answered for", async () => {
    clearPresenceCache();
    let calls = 0;
    const counting = deps({
      chainIds: () => [1, 369],
      getClient: () =>
        ({
          getCode: async () => { calls++; return "0x6080"; },
          getBalance: async () => 0n,
          getTransactionCount: async () => 0,
        }) as never,
    });

    await getChainPresence(ADDR, [1, 369], counting);
    assert.equal(calls, 2);

    // resolveEntity's address branch reads the same cache, so this costs zero
    // further RPC calls.
    const result = await resolveEntity(ADDR, {
      chainIds: () => [1, 369],
      getClient: counting.getClient,
      timeoutMs: 50,
    });
    assert.equal(calls, 2);
    assert.deepEqual(result.matches.map((m) => m.chainId), [1, 369]);
    assert.equal(result.matches[0]!.isContract, true);
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `npm run test:unit --workspace=packages/api`
Expected: FAIL — `calls` is 4, because `resolveEntity.probeAddress` does its own reads.

- [ ] **Step 7: Route `resolveEntity`'s address probe through the presence service**

In `packages/api/src/services/resolve/resolveEntity.ts`, replace the body of `probeAddress` and leave `probeTx` and `probeBlock` untouched:

```ts
import { getChainPresence, hasPresence } from "../multichain/chainPresence.js";

/**
 * An address is valid on every EVM chain, so "existence" alone is useless.
 * Report it only where it has presence: deployed bytecode, a non-zero nonce, or
 * a non-zero balance.
 *
 * This delegates to the presence service rather than re-reading, so a search
 * and the address page it leads to share one probe and one cache instead of
 * paying twice. The behaviour is unchanged — the same three reads decide
 * presence — but the second caller is free.
 */
async function probeAddress(
  deps: ResolveDeps,
  chainId: number,
  addr: string,
): Promise<ResolveMatch | null> {
  const [presence] = await getChainPresence(addr, [chainId], {
    chainIds: deps.chainIds,
    getClient: deps.getClient,
    timeoutMs: deps.timeoutMs,
    now: () => Date.now(),
  });
  if (!presence || !hasPresence(presence)) return null;
  return { chainId, isContract: presence.isContract };
}
```

- [ ] **Step 8: Run the whole api unit suite**

Run: `npm run test:unit --workspace=packages/api`
Expected: PASS. The existing `resolveEntity` tests must stay green — this changes where the reads happen, not which addresses match.

- [ ] **Step 9: Commit**

```bash
git add packages/api/src/services/multichain/chainPresence.ts \
        packages/api/src/services/resolve/resolveEntity.ts \
        packages/api/tests/unit/chainPresence.test.ts
git commit -m "feat(api): add the cross-chain address presence probe

Route resolveEntity's address branch through it too, so a search and the
address page it leads to share one probe and one cache."
```

---

### Task 8: Build the merged activity service

**Files:**
- Create: `packages/api/src/services/multichain/mergedActivity.ts`
- Test: `packages/api/tests/unit/mergedActivity.test.ts` (create)

**Interfaces:**
- Consumes: `getChainPresence`, `hasPresence`, `ChainPresence` from `chainPresence.js` (Task 7); `getAddressTransactions` from `services/explorer/addresses.js`; `runWithChain` from `services/chains/context.js`.
- Produces:
  - `interface TaggedTx { chainId: number; hash: string; timeStamp: string; [k: string]: unknown }`
  - `interface PerChainStatus { chainId: number; returned: number; error?: true }`
  - `interface MergedActivity { rows: TaggedTx[]; perChain: PerChainStatus[] }`
  - `interface ActivityDeps { fetchForChain(chainId: number, address: string, limit: number): Promise<TaggedTx[]>; timeoutMs: number }`
  - `getMergedActivity(address: string, presence: ChainPresence[], limit: number, deps?: ActivityDeps): Promise<MergedActivity>`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getMergedActivity,
  type ActivityDeps,
} from "../../src/services/multichain/mergedActivity.js";
import type { ChainPresence } from "../../src/services/multichain/chainPresence.js";

const ADDR = "0x11490e0f8050fa8a3f40c5aa9bb20fb76b010b68";

function present(chainId: number): ChainPresence {
  return { chainId, balance: "1", nonce: 1, isContract: false };
}
function absent(chainId: number): ChainPresence {
  return { chainId, balance: "0", nonce: 0, isContract: false };
}
function errored(chainId: number): ChainPresence {
  return { chainId, balance: "0", nonce: 0, isContract: false, error: true };
}

function tx(chainId: number, ts: number, hash: string) {
  return { chainId, hash, timeStamp: String(ts) };
}

function deps(overrides: Partial<ActivityDeps> = {}): ActivityDeps {
  return {
    fetchForChain: async (chainId) =>
      chainId === 1
        ? [tx(1, 300, "0xa"), tx(1, 100, "0xc")]
        : [tx(369, 200, "0xb")],
    timeoutMs: 50,
    ...overrides,
  };
}

describe("getMergedActivity", () => {
  it("merges rows from every present chain, newest first", async () => {
    const out = await getMergedActivity(ADDR, [present(1), present(369)], 10, deps());
    assert.deepEqual(out.rows.map((r) => r.hash), ["0xa", "0xb", "0xc"]);
  });

  it("skips chains with no presence entirely", async () => {
    const seen: number[] = [];
    await getMergedActivity(ADDR, [present(1), absent(369)], 10, deps({
      fetchForChain: async (chainId) => { seen.push(chainId); return []; },
    }));
    assert.deepEqual(seen, [1]);
  });

  it("skips errored chains but still reports them", async () => {
    const out = await getMergedActivity(ADDR, [present(1), errored(11155111)], 10, deps());
    assert.equal(out.perChain.find((p) => p.chainId === 11155111)!.error, true);
    assert.equal(out.perChain.find((p) => p.chainId === 11155111)!.returned, 0);
  });

  it("truncates to the limit after merging, not before", async () => {
    const out = await getMergedActivity(ADDR, [present(1), present(369)], 2, deps());
    assert.deepEqual(out.rows.map((r) => r.hash), ["0xa", "0xb"]);
  });

  it("reports each chain's contribution", async () => {
    const out = await getMergedActivity(ADDR, [present(1), present(369)], 10, deps());
    assert.deepEqual(
      out.perChain.map((p) => [p.chainId, p.returned]),
      [[1, 2], [369, 1]],
    );
  });

  it("marks a fetch failure as an errored chain, not an empty one", async () => {
    const out = await getMergedActivity(ADDR, [present(1), present(369)], 10, deps({
      fetchForChain: async (chainId) => {
        if (chainId === 369) throw new Error("archive down");
        return [tx(1, 300, "0xa")];
      },
    }));
    assert.deepEqual(out.rows.map((r) => r.hash), ["0xa"]);
    assert.equal(out.perChain.find((p) => p.chainId === 369)!.error, true);
  });

  it("returns empty rows and an empty perChain for an address with no presence", async () => {
    const out = await getMergedActivity(ADDR, [absent(1), absent(369)], 10, deps());
    assert.deepEqual(out.rows, []);
    assert.deepEqual(out.perChain, []);
  });

  it("orders ties by chain id so the merge is reproducible", async () => {
    const out = await getMergedActivity(ADDR, [present(1), present(369)], 10, deps({
      fetchForChain: async (chainId) => [tx(chainId, 500, chainId === 1 ? "0xa" : "0xb")],
    }));
    assert.deepEqual(out.rows.map((r) => r.hash), ["0xa", "0xb"]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:unit --workspace=packages/api`
Expected: FAIL — cannot resolve `mergedActivity.js`.

- [ ] **Step 3: Write the implementation**

```ts
import { runWithChain } from "../chains/context.js";
import { getAddressTransactions } from "../explorer/addresses.js";
import { hasPresence, type ChainPresence } from "./chainPresence.js";

/**
 * The merged recent-activity feed for the chain-less address page.
 *
 * Each present chain contributes its newest `limit` rows; the rows are tagged
 * with their chain, merged by timestamp, and truncated to `limit`. That is
 * deliberately a recent WINDOW and not a paginated view: paging deeper across
 * chains needs per-chain cursors and a total nobody can compute cheaply, so the
 * UI sends the user to one chain instead of faking it.
 *
 * A chain that fails is reported in `perChain`, never silently dropped — an
 * absent chain and an unreachable chain are different facts, and conflating
 * them tells the user their address has no history when the truth is we could
 * not look.
 */

export interface TaggedTx {
  chainId: number;
  hash: string;
  /** Unix seconds as a string, matching AddressTransaction. */
  timeStamp: string;
  [key: string]: unknown;
}

export interface PerChainStatus {
  chainId: number;
  returned: number;
  error?: true;
}

export interface MergedActivity {
  rows: TaggedTx[];
  perChain: PerChainStatus[];
}

export interface ActivityDeps {
  fetchForChain: (chainId: number, address: string, limit: number) => Promise<TaggedTx[]>;
  timeoutMs: number;
}

const defaultDeps: ActivityDeps = {
  fetchForChain: async (chainId, address, limit) =>
    runWithChain(chainId, async () => {
      const result = await getAddressTransactions(address, 1, limit);
      const list = Array.isArray(result) ? result : (result.transactions ?? []);
      return list.map((t: Record<string, unknown>) => ({ ...t, chainId }) as TaggedTx);
    }),
  timeoutMs: 12_000,
};

export async function getMergedActivity(
  address: string,
  presence: ChainPresence[],
  limit: number,
  deps: ActivityDeps = defaultDeps,
): Promise<MergedActivity> {
  const perChain: PerChainStatus[] = [];

  // An errored chain is reported but never fetched — we already know we cannot
  // reach it, and a second attempt only spends more of the RPC budget.
  const errored = presence.filter((p) => p.error);
  const targets = presence.filter((p) => hasPresence(p));

  const settled = await Promise.all(
    targets.map(async (p) => {
      try {
        const rows = await withTimeout(
          deps.fetchForChain(p.chainId, address, limit),
          deps.timeoutMs,
        );
        return { chainId: p.chainId, rows };
      } catch {
        return { chainId: p.chainId, rows: [] as TaggedTx[], error: true as const };
      }
    }),
  );

  const rows: TaggedTx[] = [];
  for (const s of settled) {
    rows.push(...s.rows);
    perChain.push(
      s.error
        ? { chainId: s.chainId, returned: 0, error: true }
        : { chainId: s.chainId, returned: s.rows.length },
    );
  }
  for (const e of errored) {
    perChain.push({ chainId: e.chainId, returned: 0, error: true });
  }
  perChain.sort((a, b) => a.chainId - b.chainId);

  // Newest first. Ties break on chain id so the same inputs always produce the
  // same order — two chains can easily share a second.
  rows.sort((a, b) => {
    const delta = Number(b.timeStamp) - Number(a.timeStamp);
    return delta !== 0 ? delta : a.chainId - b.chainId;
  });

  return { rows: rows.slice(0, limit), perChain };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timed out")), ms)),
  ]);
}
```

Before running the tests, open `packages/api/src/services/explorer/addresses.ts` and check the actual return shape of `getAddressTransactions`. The `defaultDeps` above handles both an array and a `{ transactions }` envelope; delete the branch that does not apply so the code states one truth.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:unit --workspace=packages/api`
Expected: PASS, all 8 cases.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/multichain/mergedActivity.ts \
        packages/api/tests/unit/mergedActivity.test.ts
git commit -m "feat(api): merge recent address activity across chains"
```

---

### Task 9: Expose the two multichain endpoints

**Files:**
- Create: `packages/api/src/routes/multichain/index.ts`
- Create: `packages/api/src/routes/multichain/schemas.ts`
- Modify: `packages/api/src/index.ts`
- Test: `packages/api/tests/unit/multichainRoutes.test.ts` (create)

**Interfaces:**
- Consumes: `getChainPresence` (Task 7), `getMergedActivity` (Task 8), `ApiError`/`asyncRoute`/`respond` from `lib/respond.js`, `isSupportedChain` from `services/chains/registry.js`.
- Produces:
  - `GET /api/multichain/address/:address` → `{ ok, result: { address, chains: ChainPresence[] } }`
  - `GET /api/multichain/address/:address/activity` → `{ ok, result: { address, rows, perChain } }`
  - `parseChainsParam(raw: string | undefined): number[] | undefined`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseChainsParam } from "../../src/routes/multichain/schemas.js";

/**
 * The `chains` allowlist carries the UI's testnet toggle to the server. Getting
 * it wrong is expensive in both directions: too permissive and the fan-out
 * costs RPC budget the user asked us not to spend; too lenient about bad input
 * and a typo silently narrows the answer.
 */

describe("parseChainsParam", () => {
  it("returns undefined when the parameter is absent or empty", () => {
    assert.equal(parseChainsParam(undefined), undefined);
    assert.equal(parseChainsParam(""), undefined);
  });

  it("parses a comma-separated list into ascending unique ids", () => {
    assert.deepEqual(parseChainsParam("369,1,1"), [1, 369]);
  });

  it("tolerates whitespace around ids", () => {
    assert.deepEqual(parseChainsParam(" 1 , 369 "), [1, 369]);
  });

  it("throws on an unregistered chain rather than dropping it", () => {
    assert.throws(() => parseChainsParam("1,8453"), /8453/);
  });

  it("throws on a non-numeric entry", () => {
    assert.throws(() => parseChainsParam("1,abc"), /abc/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:unit --workspace=packages/api`
Expected: FAIL — cannot resolve `routes/multichain/schemas.js`.

- [ ] **Step 3: Write the schema helper**

```ts
import { ApiError } from "../../lib/respond.js";
import { isSupportedChain } from "../../services/chains/registry.js";

/**
 * Parse the optional `chains=1,369` allowlist.
 *
 * `undefined` means "every registered chain". An unregistered or non-numeric id
 * is a 400, never a silent drop: quietly narrowing the fan-out would answer a
 * different question from the one asked, and the caller could not tell.
 */
export function parseChainsParam(raw: string | undefined): number[] | undefined {
  if (!raw || raw.trim() === "") return undefined;

  const ids = raw.split(",").map((part) => {
    const trimmed = part.trim();
    const n = Number(trimmed);
    if (!Number.isInteger(n) || n <= 0) {
      throw new ApiError(400, `Invalid chain id: ${trimmed}`);
    }
    if (!isSupportedChain(n)) {
      throw new ApiError(400, `Unregistered chain id: ${n}`);
    }
    return n;
  });

  return [...new Set(ids)].sort((a, b) => a - b);
}
```

- [ ] **Step 4: Write the routes**

```ts
import { Router, type Request, type Response } from "express";
import { ApiError, asyncRoute, respond } from "../../lib/respond.js";
import { getChainPresence } from "../../services/multichain/chainPresence.js";
import { getMergedActivity } from "../../services/multichain/mergedActivity.js";
import { parseChainsParam } from "./schemas.js";

/**
 * Chain-agnostic address routes.
 *
 *   GET /api/multichain/address/:address
 *   GET /api/multichain/address/:address/activity?limit=25
 *
 * Both deliberately IGNORE the request's `chainid`, exactly as /api/resolve
 * does — they exist to answer "which chains?", so binding them to one chain
 * would be incoherent. Chain scope comes from the optional `chains=` allowlist,
 * which carries the UI's testnet toggle.
 */

const router = Router();
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

function requireAddress(raw: unknown): string {
  const value = String(raw ?? "");
  if (!ADDRESS_RE.test(value)) throw new ApiError(400, "Invalid address");
  return value.toLowerCase();
}

router.get(
  "/address/:address",
  asyncRoute(async (req: Request, res: Response) => {
    const address = requireAddress(req.params.address);
    const chains = parseChainsParam(
      typeof req.query.chains === "string" ? req.query.chains : undefined,
    );
    const presence = await getChainPresence(address, chains);
    respond.ok(res, { result: { address, chains: presence } });
  }, "multichain/address"),
);

router.get(
  "/address/:address/activity",
  asyncRoute(async (req: Request, res: Response) => {
    const address = requireAddress(req.params.address);
    const chains = parseChainsParam(
      typeof req.query.chains === "string" ? req.query.chains : undefined,
    );
    const limit = Math.min(
      Math.max(parseInt(String(req.query.limit ?? "25"), 10) || 25, 1),
      100,
    );

    // Two-phase: the cheap presence probe first, so only chains that actually
    // hold this address pay for the expensive activity fetch.
    const presence = await getChainPresence(address, chains);
    const activity = await getMergedActivity(address, presence, limit);
    respond.ok(res, { result: { address, ...activity } });
  }, "multichain/address/activity"),
);

export default router;
```

- [ ] **Step 5: Register the router**

In `packages/api/src/index.ts`, beside the existing `app.use("/api/resolve", resolveRouter)` line:

```ts
import multichainRouter from "./routes/multichain/index.js";
// …
app.use("/api/multichain", multichainRouter);
```

- [ ] **Step 6: Run the tests and verify the endpoints live**

Run: `npm run test:unit --workspace=packages/api`
Expected: PASS.

Then start the API (`npm run dev:api`) and probe it:

```bash
curl -s "http://localhost:10100/api/multichain/address/0x11490E0f8050FA8A3f40C5aA9bB20fB76B010b68" | head -c 600
curl -s "http://localhost:10100/api/multichain/address/0x11490E0f8050FA8A3f40C5aA9bB20fB76B010b68?chains=1,369" | head -c 400
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:10100/api/multichain/address/0xnope"          # 400
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:10100/api/multichain/address/0x11490E0f8050FA8A3f40C5aA9bB20fB76B010b68?chains=8453"  # 400
curl -s "http://localhost:10100/api/multichain/address/0x11490E0f8050FA8A3f40C5aA9bB20fB76B010b68/activity?limit=5" | head -c 800
```

Confirm: four rows in `chains`, balances as strings, and no BigInt serialization error. Time the second call — it should be materially faster than the first, because the presence cache is warm.

- [ ] **Step 7: Commit**

```bash
git add packages/api/src/routes/multichain/ packages/api/src/index.ts \
        packages/api/tests/unit/multichainRoutes.test.ts
git commit -m "feat(api): serve chain-agnostic address presence and activity"
```

---

## Phase 3 — The all-chain address view

### Task 10: Build the two-line entity row

**Files:**
- Create: `packages/web/src/components/primitives/EntityRow.tsx`
- Test: `packages/web/src/__tests__/entityRow.test.tsx` (create)

**Interfaces:**
- Produces:

```tsx
export interface EntityRowProps {
  art?: ReactNode;      // 22px leading image or glyph
  main: ReactNode;      // line 1, left — the answer
  sub: ReactNode;       // line 2, left — the qualifiers
  right?: ReactNode;    // line 1, right
  rightSub?: ReactNode; // line 2, right
  share?: number;       // 0..1 — background fill width
  tint?: string;        // CSS colour for the fill
  href?: string;        // renders a react-router Link when set
  tone?: "default" | "warn";
}
export default function EntityRow(props: EntityRowProps): JSX.Element;
```

- [ ] **Step 1: Write the failing tests**

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import EntityRow from "../components/primitives/EntityRow";

function renderRow(props: Parameters<typeof EntityRow>[0]) {
  return render(
    <MemoryRouter>
      <EntityRow {...props} />
    </MemoryRouter>,
  );
}

describe("EntityRow", () => {
  it("renders exactly two lines of content per side", () => {
    renderRow({ main: "Ethereum", sub: "nonce 1,204", right: "12.401 ETH", rightSub: "68%" });
    expect(screen.getByText("Ethereum")).toBeInTheDocument();
    expect(screen.getByText("nonce 1,204")).toBeInTheDocument();
    expect(screen.getByText("12.401 ETH")).toBeInTheDocument();
    expect(screen.getByText("68%")).toBeInTheDocument();
  });

  it("renders a link when href is set and a plain row when it is not", () => {
    const { unmount } = renderRow({ main: "Ethereum", sub: "x", href: "/eip155/1/address/0xa" });
    expect(screen.getByRole("link")).toHaveAttribute("href", "/eip155/1/address/0xa");
    unmount();
    renderRow({ main: "Ethereum", sub: "x" });
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("sets the fill width from share, clamped to 0..100%", () => {
    const { container } = renderRow({ main: "a", sub: "b", share: 0.68, tint: "#627eea" });
    const fill = container.querySelector("[data-testid='row-fill']") as HTMLElement;
    expect(fill.style.width).toBe("68%");
  });

  it("clamps an out-of-range share instead of emitting a broken width", () => {
    const { container, unmount } = renderRow({ main: "a", sub: "b", share: 1.8 });
    expect(
      (container.querySelector("[data-testid='row-fill']") as HTMLElement).style.width,
    ).toBe("100%");
    unmount();
    const second = renderRow({ main: "a", sub: "b", share: -0.5 });
    expect(
      (second.container.querySelector("[data-testid='row-fill']") as HTMLElement).style.width,
    ).toBe("0%");
  });

  it("omits the fill entirely when share is undefined", () => {
    const { container } = renderRow({ main: "a", sub: "b" });
    expect(container.querySelector("[data-testid='row-fill']")).toBeNull();
  });

  it("uses an outset shadow outline and never a CSS border", () => {
    const { container } = renderRow({ main: "a", sub: "b" });
    const row = container.firstElementChild as HTMLElement;
    expect(row.className).not.toMatch(/\bborder(-|\b)/);
    expect(row.className).toMatch(/shadow-\[/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test --workspace=packages/web -- entityRow`
Expected: FAIL — cannot resolve `EntityRow`.

- [ ] **Step 3: Write the component**

```tsx
import { type ReactNode } from "react";
import { Link } from "react-router-dom";

/**
 * The two-line row used by every multichain list: the chain presence strip, the
 * merged activity feed, and the block-height page.
 *
 * Two lines, never three. The main line carries the answer; the subline carries
 * the qualifiers. Anything further belongs in a Tooltip, not a third line — a
 * three-line row makes a list of four chains taller than the screen and buries
 * the comparison the list exists to support.
 *
 * `share` fills the row's own background rather than adding a bar column. The
 * ranking then reads before any digit does, and it costs neither a column nor a
 * line. Activity share on the address page; gas used on the block page.
 */
export interface EntityRowProps {
  art?: ReactNode;
  main: ReactNode;
  sub: ReactNode;
  right?: ReactNode;
  rightSub?: ReactNode;
  /** 0..1. Clamped — a caller dividing by a zero total must not emit NaN%. */
  share?: number;
  tint?: string;
  href?: string;
  tone?: "default" | "warn";
}

export default function EntityRow({
  art,
  main,
  sub,
  right,
  rightSub,
  share,
  tint,
  href,
  tone = "default",
}: EntityRowProps) {
  const outline =
    tone === "warn"
      ? "shadow-[0_0_0_1px_var(--color-warning)]"
      : "shadow-[0_0_0_1px_var(--color-border-default)]";

  const body = (
    <>
      {share !== undefined && (
        <span
          data-testid="row-fill"
          aria-hidden="true"
          className="absolute inset-y-0 left-0 pointer-events-none opacity-15"
          style={{
            width: `${Math.round(Math.min(1, Math.max(0, share)) * 100)}%`,
            backgroundColor: tint ?? "var(--color-accent)",
          }}
        />
      )}
      {art !== undefined && <span className="relative shrink-0">{art}</span>}
      <span className="relative min-w-0 flex flex-col">
        <span className="theme-text text-sm truncate">{main}</span>
        <span className="theme-text-muted theme-mono text-xs truncate">{sub}</span>
      </span>
      {(right !== undefined || rightSub !== undefined) && (
        <span className="relative min-w-0 flex flex-col text-right">
          <span className="theme-text theme-mono text-xs tabular-nums">{right}</span>
          <span className="theme-text-muted theme-mono text-xs">{rightSub}</span>
        </span>
      )}
    </>
  );

  const className =
    `relative overflow-hidden flex items-center gap-inline p-2 theme-card-bg ${outline} ` +
    (href ? "hover:shadow-[0_0_0_1px_var(--color-accent)]" : "");

  return href ? (
    <Link to={href} className={className}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test --workspace=packages/web -- entityRow`
Expected: PASS, all 6 cases.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/primitives/EntityRow.tsx \
        packages/web/src/__tests__/entityRow.test.tsx
git commit -m "feat(web): add the two-line entity row"
```

---

### Task 11: Build the chain presence strip

**Files:**
- Create: `packages/web/src/api/multichain.ts`
- Create: `packages/web/src/components/explorer/MultiChainAddressView/ChainPresenceStrip.tsx`
- Test: `packages/web/src/__tests__/chainPresenceStrip.test.tsx` (create)

**Interfaces:**
- Consumes: `EntityRow` (Task 10), `scanPath` (Task 5), `CHAINS`/`chainLogoUrl` from `lib/chains`.
- Produces:
  - `interface ChainPresence { chainId: number; balance: string; nonce: number; isContract: boolean; error?: true }` (web mirror)
  - `fetchChainPresence(address: string, chainIds?: number[]): Promise<ChainPresence[]>`
  - `fetchMergedActivity(address: string, chainIds?: number[], limit?: number): Promise<MergedActivity>`
  - `<ChainPresenceStrip address={string} rows={ChainPresence[]} shares={Record<number, number>} />`

- [ ] **Step 1: Write the failing tests**

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import ChainPresenceStrip from "../components/explorer/MultiChainAddressView/ChainPresenceStrip";
import type { ChainPresence } from "../api/multichain";

const ADDR = "0x11490e0f8050fa8a3f40c5aa9bb20fb76b010b68";

const rows: ChainPresence[] = [
  { chainId: 1, balance: "12401000000000000000", nonce: 1204, isContract: false },
  { chainId: 369, balance: "8201113000000000000000000", nonce: 94, isContract: false },
  { chainId: 943, balance: "0", nonce: 0, isContract: false },
  { chainId: 11155111, balance: "0", nonce: 0, isContract: false, error: true },
];

function renderStrip(input = rows) {
  return render(
    <MemoryRouter>
      <ChainPresenceStrip address={ADDR} rows={input} shares={{ 1: 0.68, 369: 0.32 }} />
    </MemoryRouter>,
  );
}

describe("ChainPresenceStrip", () => {
  it("renders one row per chain with presence", () => {
    renderStrip();
    expect(screen.getByText("Ethereum")).toBeInTheDocument();
    expect(screen.getByText("PulseChain")).toBeInTheDocument();
  });

  it("links each present chain to its chain-scoped address page", () => {
    renderStrip();
    const link = screen.getByRole("link", { name: /Ethereum/ });
    expect(link).toHaveAttribute("href", `/eip155/1/address/${ADDR}`);
  });

  it("collapses every absent chain into a single line", () => {
    renderStrip();
    expect(screen.getByText(/not here/i)).toBeInTheDocument();
    // 943 is absent, so it must NOT get its own row link.
    expect(screen.queryByRole("link", { name: /PulseChain Testnet v4/ })).toBeNull();
  });

  it("shows an errored chain as unavailable, never as absent", () => {
    renderStrip();
    expect(screen.getByText(/unavailable/i)).toBeInTheDocument();
    const notHere = screen.getByText(/not here/i).closest("div")!;
    expect(notHere.textContent).not.toMatch(/Sepolia/);
  });

  it("renders an empty-state line when the address is on no chain at all", () => {
    renderStrip(rows.map((r) => ({ ...r, balance: "0", nonce: 0, isContract: false, error: undefined })));
    expect(screen.getByText(/no activity on any chain/i)).toBeInTheDocument();
  });

  it("labels the nonce as sent, not as a transaction total", () => {
    renderStrip();
    // The nonce counts transactions SENT. Calling it a tx count would be a lie:
    // a real total needs the archive.
    expect(screen.getByText(/1,204 sent/)).toBeInTheDocument();
    expect(screen.queryByText(/1,204 txs?$/)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test --workspace=packages/web -- chainPresenceStrip`
Expected: FAIL — cannot resolve the component.

- [ ] **Step 3: Write the API client**

```ts
import { apiUrl } from "../lib/apiBase";

/**
 * Client for the chain-agnostic address endpoints. These deliberately do NOT go
 * through `scoped()` — they answer "which chains?", so binding them to one
 * chain would be incoherent. `chainIds` carries the testnet toggle instead.
 */

const API_BASE = apiUrl("/api/multichain");

export interface ChainPresence {
  chainId: number;
  /** Native balance in wei, as a string. Format at the edge, never here. */
  balance: string;
  nonce: number;
  isContract: boolean;
  /** True when the probe failed. Means "unknown", NOT "absent". */
  error?: true;
}

export interface PerChainStatus {
  chainId: number;
  returned: number;
  error?: true;
}

export interface TaggedTx {
  chainId: number;
  hash: string;
  timeStamp: string;
  [key: string]: unknown;
}

export interface MergedActivity {
  rows: TaggedTx[];
  perChain: PerChainStatus[];
}

function chainsParam(chainIds?: number[]): string {
  return chainIds?.length ? `?chains=${chainIds.join(",")}` : "";
}

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `Request failed HTTP ${res.status}`);
  }
  const data = (await res.json()) as { ok: boolean; result: T };
  return data.result;
}

export async function fetchChainPresence(
  address: string,
  chainIds?: number[],
): Promise<ChainPresence[]> {
  const result = await get<{ address: string; chains: ChainPresence[] }>(
    `${API_BASE}/address/${address}${chainsParam(chainIds)}`,
  );
  return result.chains;
}

export async function fetchMergedActivity(
  address: string,
  chainIds?: number[],
  limit = 25,
): Promise<MergedActivity> {
  const suffix = chainsParam(chainIds);
  const sep = suffix ? "&" : "?";
  return get<MergedActivity>(
    `${API_BASE}/address/${address}/activity${suffix}${sep}limit=${limit}`,
  );
}

/** A chain is worth showing when the address has code, funds, or history. */
export function hasPresence(p: ChainPresence): boolean {
  if (p.error) return false;
  return p.isContract || p.nonce > 0 || p.balance !== "0";
}
```

- [ ] **Step 4: Write the strip**

```tsx
import EntityRow from "../../primitives/EntityRow";
import { chainById, chainLogoUrl } from "../../../lib/chains";
import { scanPath } from "../../../lib/scanRoutes";
import { formatNative } from "../format";
import { hasPresence, type ChainPresence } from "../../../api/multichain";

/**
 * "Where does this address live?" — the whole point of the chain-less address
 * page, and the component that pays for itself three times over: full size
 * here, slim on a scoped page, and the entire body of /block/<number>.
 *
 * Chains with no presence collapse into one line. Four registered chains used
 * to mean four rows even when two were empty, which pushed the actual answer
 * below the fold.
 *
 * An errored chain is NOT absent. "We could not reach Sepolia" and "this
 * address is not on Sepolia" are different facts, and showing the first as the
 * second tells the user something false.
 */
interface Props {
  address: string;
  rows: ChainPresence[];
  /** chainId → 0..1 share of recent activity, for the row fill. */
  shares: Record<number, number>;
}

export default function ChainPresenceStrip({ address, rows, shares }: Props) {
  const present = rows.filter(hasPresence);
  const errored = rows.filter((r) => r.error);
  const absent = rows.filter((r) => !hasPresence(r) && !r.error);

  if (present.length === 0 && errored.length === 0) {
    return (
      <p className="p-2 theme-text-muted theme-mono text-xs shadow-[0_0_0_1px_var(--color-border-muted)]">
        No activity on any chain we serve.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-px">
      {present.map((p) => {
        const chain = chainById(p.chainId);
        return (
          <EntityRow
            key={p.chainId}
            href={scanPath("address", address, p.chainId)}
            share={shares[p.chainId]}
            art={<ChainArt chainId={p.chainId} />}
            main={chain?.name ?? `Chain ${p.chainId}`}
            // `nonce` counts transactions SENT. A true total needs the archive,
            // so the label says what the number actually is.
            sub={`${p.isContract ? "Contract" : "EOA"} · ${p.nonce.toLocaleString()} sent`}
            right={formatNative(p.balance, p.chainId)}
            rightSub={
              shares[p.chainId] !== undefined
                ? `${Math.round(shares[p.chainId]! * 100)}% of recent`
                : ""
            }
          />
        );
      })}

      {errored.map((p) => (
        <EntityRow
          key={p.chainId}
          tone="warn"
          art={<ChainArt chainId={p.chainId} />}
          main={chainById(p.chainId)?.name ?? `Chain ${p.chainId}`}
          sub="probe failed — unknown, not absent"
          right="unavailable"
          rightSub="retry"
        />
      ))}

      {absent.length > 0 && (
        <div className="flex flex-wrap items-center gap-inline p-2 theme-text-muted theme-mono text-xs shadow-[0_0_0_1px_var(--color-border-muted)]">
          <span className="uppercase tracking-wide font-semibold">Not here</span>
          {absent.map((p) => (
            <span key={p.chainId} className="inline-flex items-center gap-tight">
              <ChainArt chainId={p.chainId} dim />
              {chainById(p.chainId)?.name ?? p.chainId}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Chain art from gib.show. A fixed size and `shrink-0` keep the row from
 * reflowing when the image lands. Testnets are dimmed because /image/943
 * returns bytes identical to /image/369 — the testnet has no distinct logo, and
 * without the dimming it reads as PulseChain mainnet.
 */
function ChainArt({ chainId, dim = false }: { chainId: number; dim?: boolean }) {
  const chain = chainById(chainId);
  return (
    <img
      src={chainLogoUrl(chainId)}
      alt=""
      width={22}
      height={22}
      className={`size-[22px] shrink-0 rounded-full ${
        dim || chain?.testnet ? "grayscale opacity-60" : ""
      }`}
    />
  );
}
```

If `formatNative(balanceWei, chainId)` does not already exist in `packages/web/src/components/explorer/format.ts`, add it there — scale the raw integer by 18 decimals and append `chainSymbol(chainId)`. Keep the value a raw string everywhere else; format only at this edge.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test --workspace=packages/web -- chainPresenceStrip`
Expected: PASS, all 6 cases.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/api/multichain.ts \
        packages/web/src/components/explorer/MultiChainAddressView/ \
        packages/web/src/components/explorer/format.ts \
        packages/web/src/__tests__/chainPresenceStrip.test.tsx
git commit -m "feat(web): render where an address lives across chains"
```

---

### Task 12: Build the merged activity feed

**Files:**
- Create: `packages/web/src/components/explorer/MultiChainAddressView/MergedActivityFeed.tsx`
- Test: `packages/web/src/__tests__/mergedActivityFeed.test.tsx` (create)

**Interfaces:**
- Consumes: `EntityRow` (Task 10), `MergedActivity`/`TaggedTx`/`PerChainStatus` from `api/multichain` (Task 11), `scanPath` (Task 5).
- Produces: `<MergedActivityFeed address={string} activity={MergedActivity} />`

- [ ] **Step 1: Write the failing tests**

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import MergedActivityFeed from "../components/explorer/MultiChainAddressView/MergedActivityFeed";
import type { MergedActivity } from "../api/multichain";

const ADDR = "0x11490e0f8050fa8a3f40c5aa9bb20fb76b010b68";

const activity: MergedActivity = {
  rows: [
    { chainId: 1, hash: "0xaaa", timeStamp: "1700000300", methodName: "swap" },
    { chainId: 369, hash: "0xbbb", timeStamp: "1700000200", methodName: "transfer" },
  ],
  perChain: [
    { chainId: 1, returned: 1 },
    { chainId: 369, returned: 1 },
    { chainId: 11155111, returned: 0, error: true },
  ],
};

function renderFeed(input = activity) {
  return render(
    <MemoryRouter>
      <MergedActivityFeed address={ADDR} activity={input} />
    </MemoryRouter>,
  );
}

describe("MergedActivityFeed", () => {
  it("renders one row per transaction, newest first", () => {
    renderFeed();
    const links = screen.getAllByRole("link");
    expect(links[0]).toHaveAttribute("href", "/eip155/1/tx/0xaaa");
    expect(links[1]).toHaveAttribute("href", "/eip155/369/tx/0xbbb");
  });

  it("names the chain on every row", () => {
    renderFeed();
    expect(screen.getByText(/Ethereum/)).toBeInTheDocument();
    expect(screen.getByText(/PulseChain/)).toBeInTheDocument();
  });

  it("reports an excluded chain instead of dropping it silently", () => {
    renderFeed();
    expect(screen.getByText(/Sepolia/)).toBeInTheDocument();
    expect(screen.getByText(/excluded/i)).toBeInTheDocument();
  });

  it("offers a per-chain jump instead of pretending to page across chains", () => {
    renderFeed();
    expect(screen.getByText(/page deeper on one chain/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Ethereum →/ })).toHaveAttribute(
      "href",
      `/eip155/1/address/${ADDR}`,
    );
  });

  it("renders an empty state rather than a bare footer", () => {
    renderFeed({ rows: [], perChain: [] });
    expect(screen.getByText(/no recent activity/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test --workspace=packages/web -- mergedActivityFeed`
Expected: FAIL — cannot resolve the component.

- [ ] **Step 3: Write the component**

```tsx
import EntityRow from "../../primitives/EntityRow";
import { chainById } from "../../../lib/chains";
import { scanPath } from "../../../lib/scanRoutes";
import { truncateAddr } from "../format";
import type { MergedActivity } from "../../../api/multichain";

/**
 * The merged recent-activity feed.
 *
 * This is a WINDOW, not a paginated list, and the footer says so. Paging deeper
 * across chains needs per-chain cursors and a total nobody can compute cheaply,
 * so the footer sends the user to one chain rather than faking a page count.
 *
 * A chain the backend could not reach is named in the footer. Dropping it
 * silently would read as "no activity there", which is a different claim from
 * "we could not look".
 */
interface Props {
  address: string;
  activity: MergedActivity;
}

export default function MergedActivityFeed({ address, activity }: Props) {
  const { rows, perChain } = activity;
  const reachable = perChain.filter((p) => !p.error);
  const excluded = perChain.filter((p) => p.error);

  if (rows.length === 0) {
    return (
      <p className="p-2 theme-text-muted theme-mono text-xs shadow-[0_0_0_1px_var(--color-border-muted)]">
        No recent activity on any chain we could reach.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-px">
      {rows.map((row) => {
        const chain = chainById(row.chainId);
        const method = typeof row.methodName === "string" ? row.methodName : "transaction";
        return (
          <EntityRow
            key={`${row.chainId}-${row.hash}`}
            href={scanPath("tx", row.hash, row.chainId)}
            main={method}
            sub={`${chain?.name ?? row.chainId} · ${truncateAddr(row.hash)}`}
            right={relativeAge(row.timeStamp)}
          />
        );
      })}

      <div className="flex flex-wrap items-center justify-between gap-inline p-2 theme-text-muted theme-mono text-xs shadow-[0_0_0_1px_var(--color-border-muted)]">
        <span>Page deeper on one chain</span>
        <span className="flex flex-wrap gap-inline">
          {reachable.map((p) => (
            <a
              key={p.chainId}
              href={scanPath("address", address, p.chainId)}
              className="theme-accent rounded px-2 py-0.5 shadow-[0_0_0_1px_var(--color-border-default)]"
            >
              {chainById(p.chainId)?.name ?? p.chainId} →
            </a>
          ))}
          {excluded.map((p) => (
            <span key={p.chainId} className="px-2 py-0.5 theme-warning">
              {chainById(p.chainId)?.name ?? p.chainId} excluded ⚠
            </span>
          ))}
        </span>
      </div>
    </div>
  );
}

/** Unix seconds → a short relative age. Pure, so it is directly testable. */
export function relativeAge(timeStamp: string, nowMs = Date.now()): string {
  const seconds = Math.max(0, Math.floor(nowMs / 1000) - Number(timeStamp));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86_400)}d`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test --workspace=packages/web -- mergedActivityFeed`
Expected: PASS, all 5 cases.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/explorer/MultiChainAddressView/MergedActivityFeed.tsx \
        packages/web/src/__tests__/mergedActivityFeed.test.tsx
git commit -m "feat(web): render the merged cross-chain activity feed"
```

---

### Task 13: Wire the view in and stop redirecting addresses

This task changes `useResolvedChainRedirect`, which carries two production bug fixes. Task 1 pinned its three invariants. Those tests must stay green.

**Files:**
- Create: `packages/web/src/components/explorer/MultiChainAddressView.tsx`
- Modify: `packages/web/src/components/explorer/ExplorerPanel.tsx`
- Modify: `packages/web/src/lib/useResolvedChainRedirect.ts`
- Test: `packages/web/src/__tests__/multiChainAddressView.test.tsx` (create)

**Interfaces:**
- Consumes: `ChainPresenceStrip` (Task 11), `MergedActivityFeed` (Task 12), `fetchChainPresence`/`fetchMergedActivity` (Task 11), `useChainScope` (Task 4).
- Produces: `<MultiChainAddressView address={string} />`.

- [ ] **Step 1: Write the failing tests**

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import MultiChainAddressView from "../components/explorer/MultiChainAddressView";

const ADDR = "0x11490e0f8050fa8a3f40c5aa9bb20fb76b010b68";

const presenceMock = vi.hoisted(() => vi.fn());
const activityMock = vi.hoisted(() => vi.fn());
vi.mock("../api/multichain", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/multichain")>()),
  fetchChainPresence: presenceMock,
  fetchMergedActivity: activityMock,
}));

function Wrap({ entry, children }: { entry: string; children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  presenceMock.mockReset();
  activityMock.mockReset();
  presenceMock.mockResolvedValue([
    { chainId: 1, balance: "1", nonce: 5, isContract: false },
    { chainId: 369, balance: "2", nonce: 3, isContract: false },
  ]);
  activityMock.mockResolvedValue({
    rows: [{ chainId: 1, hash: "0xaaa", timeStamp: "1700000300", methodName: "swap" }],
    perChain: [{ chainId: 1, returned: 1 }],
  });
});

describe("MultiChainAddressView", () => {
  it("shows every chain the address lives on", async () => {
    render(
      <Wrap entry={`/address/${ADDR}`}>
        <MultiChainAddressView address={ADDR} />
      </Wrap>,
    );
    await waitFor(() => expect(screen.getByText("Ethereum")).toBeInTheDocument());
    expect(screen.getByText("PulseChain")).toBeInTheDocument();
  });

  it("computes each chain's share from its returned row count", async () => {
    activityMock.mockResolvedValue({
      rows: [
        { chainId: 1, hash: "0xa", timeStamp: "3", methodName: "x" },
        { chainId: 1, hash: "0xb", timeStamp: "2", methodName: "x" },
        { chainId: 369, hash: "0xc", timeStamp: "1", methodName: "x" },
      ],
      perChain: [{ chainId: 1, returned: 2 }, { chainId: 369, returned: 1 }],
    });
    render(
      <Wrap entry={`/address/${ADDR}`}>
        <MultiChainAddressView address={ADDR} />
      </Wrap>,
    );
    await waitFor(() => expect(screen.getByText(/67% of recent/)).toBeInTheDocument());
    expect(screen.getByText(/33% of recent/)).toBeInTheDocument();
  });

  it("surfaces an error instead of rendering an empty page", async () => {
    presenceMock.mockRejectedValue(new Error("upstream down"));
    render(
      <Wrap entry={`/address/${ADDR}`}>
        <MultiChainAddressView address={ADDR} />
      </Wrap>,
    );
    await waitFor(() => expect(screen.getByText(/upstream down/i)).toBeInTheDocument());
  });
});

describe("chain-less address URLs no longer redirect", () => {
  it("leaves /address/0x… on the all-chain page", async () => {
    function Probe() {
      const location = useLocation();
      return <div data-testid="url">{location.pathname + location.search}</div>;
    }
    render(
      <Wrap entry={`/address/${ADDR}`}>
        <Routes>
          <Route
            path="/address/:address"
            element={<><Probe /><MultiChainAddressView address={ADDR} /></>}
          />
        </Routes>
      </Wrap>,
    );
    await waitFor(() => expect(screen.getByText("Ethereum")).toBeInTheDocument());
    expect(screen.getByTestId("url")).toHaveTextContent(`/address/${ADDR}`);
    expect(screen.getByTestId("url")).not.toHaveTextContent("chainid");
    expect(screen.getByTestId("url")).not.toHaveTextContent("eip155");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test --workspace=packages/web -- multiChainAddressView`
Expected: FAIL — cannot resolve `MultiChainAddressView`.

- [ ] **Step 3: Write the view**

```tsx
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import ChainPresenceStrip from "./MultiChainAddressView/ChainPresenceStrip";
import MergedActivityFeed from "./MultiChainAddressView/MergedActivityFeed";
import { fetchChainPresence, fetchMergedActivity } from "../../api/multichain";

/**
 * The chain-less address page — `/address/0x…` with no chain named.
 *
 * This page is TERMINAL. It does not resolve to a chain and it does not
 * redirect, because "which chain is this address on?" is the wrong question: an
 * address is valid on all of them. The page answers the right question instead,
 * which is where the address has presence.
 *
 * Two queries, in sequence by design. The cheap presence probe decides which
 * chains are worth the expensive activity fetch, so a typical address costs
 * four cheap calls plus one or two real ones rather than four of each.
 */
interface Props {
  address: string;
}

export default function MultiChainAddressView({ address }: Props) {
  const presence = useQuery({
    queryKey: ["multichain-presence", address],
    queryFn: () => fetchChainPresence(address),
    staleTime: 60_000,
  });

  const activity = useQuery({
    queryKey: ["multichain-activity", address],
    queryFn: () => fetchMergedActivity(address),
    enabled: presence.isSuccess,
    staleTime: 60_000,
  });

  /**
   * Share of recent activity per chain, from the row counts the backend already
   * reports. Derived in render — never stored in a ref or an effect.
   */
  const shares = useMemo<Record<number, number>>(() => {
    const perChain = activity.data?.perChain ?? [];
    const total = perChain.reduce((sum, p) => sum + p.returned, 0);
    if (total === 0) return {};
    return Object.fromEntries(perChain.map((p) => [p.chainId, p.returned / total]));
  }, [activity.data]);

  if (presence.isError) {
    return (
      <p className="p-2 sm:p-4 theme-danger theme-mono text-sm shadow-[0_0_0_1px_var(--color-danger)]">
        {(presence.error as Error).message}
      </p>
    );
  }

  return (
    <div className="space-y-stack">
      <section>
        <h2 className="theme-text-muted text-xs uppercase tracking-wide font-semibold pb-1">
          Where this address lives
        </h2>
        {presence.isLoading ? (
          <p className="p-2 theme-text-muted theme-mono text-xs">Probing every chain…</p>
        ) : (
          <ChainPresenceStrip address={address} rows={presence.data ?? []} shares={shares} />
        )}
      </section>

      <section>
        <h2 className="theme-text-muted text-xs uppercase tracking-wide font-semibold pb-1">
          Activity · all chains
        </h2>
        {activity.isLoading ? (
          <p className="p-2 theme-text-muted theme-mono text-xs">Merging recent activity…</p>
        ) : (
          <MergedActivityFeed
            address={address}
            activity={activity.data ?? { rows: [], perChain: [] }}
          />
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Stop the redirect hook firing for addresses**

In `packages/web/src/lib/useResolvedChainRedirect.ts`, extend the signature and update the docblock. Do not touch the three invariants.

```ts
/**
 * …existing docblock…
 *
 * Third deliberate limit, added with the all-chain address view:
 *
 *   - It never fires for an ADDRESS. A tx hash lives on exactly one chain, so
 *     resolving it is answering a real question. An address is valid on every
 *     chain, so "which one?" has no correct answer — `/address/0x…` renders
 *     every chain instead, and redirecting it would replace a complete answer
 *     with an arbitrary one.
 */
export function useResolvedChainRedirect(
  query: string | null,
  kind: "entity" | "address" = "entity",
): ChainRedirectState {
  // …
  const enabled = !!query && !urlNamesChain && kind !== "address";
  // …everything else unchanged
}
```

- [ ] **Step 5: Wire it into `ExplorerPanel`**

In `packages/web/src/components/explorer/ExplorerPanel.tsx`:

```tsx
import { useChainScope } from "../../lib/activeChain";
import MultiChainAddressView from "./MultiChainAddressView";

// …inside the component, after `view` is computed:

const scope = useChainScope();
const showAllChains =
  scope.kind === "all" && (view.type === "address" || view.type === "contract");

// Pass the kind so the hook skips address resolves entirely.
const resolvingChain =
  useResolvedChainRedirect(
    resolveQuery,
    view.type === "address" || view.type === "contract" ? "address" : "entity",
  ) === "resolving";

// …in the render, before the existing per-view switch. Both the `address` and
// `contract` view shapes carry `.address`, so one branch serves both.
if (showAllChains && (view.type === "address" || view.type === "contract")) {
  return <MultiChainAddressView address={view.address} />;
}
```

- [ ] **Step 6: Run the whole web suite**

Run: `npm run test --workspace=packages/web`
Expected: PASS. Task 1's three invariant tests must still be green — they cover a `tx` query, which still resolves.

- [ ] **Step 7: Verify by running the app**

```bash
npm run dev
```

Open `http://localhost:5173/address/0x11490E0f8050FA8A3f40C5aA9bB20fB76B010b68`. Confirm:
- every chain with presence appears, with a balance
- the URL stays `/address/0x…` — no `chainid`, no `eip155` prefix
- clicking a chain row lands on `/eip155/<id>/address/0x…` and renders today's single-chain page
- `/tx/<a 943 hash>` still redirects to `/eip155/943/tx/…`

- [ ] **Step 8: Commit as two commits**

The hook change is isolated so it can be reverted without losing the view.

```bash
git add packages/web/src/lib/useResolvedChainRedirect.ts
git commit -m "fix(explorer): stop resolving a chain for chain-less address links

An address is valid on every chain, so picking one is answering a question
nobody asked. /address/0x… now renders every chain instead."

git add packages/web/src/components/explorer/MultiChainAddressView.tsx \
        packages/web/src/components/explorer/ExplorerPanel.tsx \
        packages/web/src/__tests__/multiChainAddressView.test.tsx
git commit -m "feat(explorer): render the all-chain address page"
```

---

## Phase 4 — Reuse

### Task 14: Add the global testnet toggle

**Files:**
- Create: `packages/web/src/lib/settings/testnets.ts`
- Create: `packages/web/src/components/settings/TestnetToggle.tsx`
- Modify: `packages/web/src/components/AppShell.tsx` (footer)
- Modify: `packages/web/src/components/settings/SettingsPanel.tsx`
- Modify: `packages/web/src/components/explorer/MultiChainAddressView.tsx`
- Test: `packages/web/src/__tests__/testnetToggle.test.tsx` (create)

**Interfaces:**
- Produces:
  - `getShowTestnets(): boolean` — non-reactive, for the fetch layer
  - `setShowTestnets(value: boolean): void`
  - `useShowTestnets(): [boolean, (v: boolean) => void]`
  - `visibleChainIds(): number[]`
  - `<TestnetToggle />`

- [ ] **Step 1: Write the failing tests**

```tsx
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  getShowTestnets,
  setShowTestnets,
  visibleChainIds,
} from "../lib/settings/testnets";
import TestnetToggle from "../components/settings/TestnetToggle";

beforeEach(() => {
  localStorage.clear();
});

describe("testnet setting", () => {
  it("defaults to showing testnets", () => {
    expect(getShowTestnets()).toBe(true);
    expect(visibleChainIds()).toEqual([1, 369, 943, 11155111]);
  });

  it("narrows the visible chain set when testnets are hidden", () => {
    setShowTestnets(false);
    expect(visibleChainIds()).toEqual([1, 369]);
  });

  it("persists across reads", () => {
    setShowTestnets(false);
    expect(getShowTestnets()).toBe(false);
  });

  it("falls back to the default when storage throws", () => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = () => {
      throw new Error("blocked");
    };
    try {
      expect(getShowTestnets()).toBe(true);
    } finally {
      Storage.prototype.getItem = original;
    }
  });
});

describe("TestnetToggle", () => {
  it("is not a native checkbox", () => {
    const { container } = render(<TestnetToggle />);
    expect(container.querySelector("input[type='checkbox']")).toBeNull();
    expect(screen.getByRole("switch")).toBeInTheDocument();
  });

  it("flips the setting and reports the new chain count", () => {
    render(<TestnetToggle />);
    const toggle = screen.getByRole("switch");
    expect(toggle).toHaveAttribute("aria-checked", "true");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(getShowTestnets()).toBe(false);
    expect(screen.getByText(/2 of 4 chains/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test --workspace=packages/web -- testnetToggle`
Expected: FAIL — cannot resolve the two new modules.

- [ ] **Step 3: Write the setting store**

```ts
import { useCallback, useSyncExternalStore } from "react";
import { CHAINS } from "../chains";

/**
 * Global "show testnets" setting.
 *
 * This looks like a display preference and is actually a cost control. With
 * testnets off, every chain-less page probes two chains instead of four, which
 * halves the RPC budget the multichain address view spends. Prod has 429'd on
 * Ethereum before, so that halving is the point.
 *
 * It therefore must live somewhere the FETCH layer can read, not in component
 * state — otherwise the server still probes every chain and the saving never
 * happens. Hence a module-level store with a non-reactive getter alongside the
 * hook.
 *
 * An explicit testnet URL still works. `/eip155/943/tx/0x…` is a stated scope
 * and outranks a display preference.
 */

const KEY = "explore.showTestnets";
const listeners = new Set<() => void>();

function read(): boolean {
  try {
    // Absent means "not yet chosen", which defaults to showing everything.
    return localStorage.getItem(KEY) !== "0";
  } catch {
    // A private window or blocked storage must not break the page.
    return true;
  }
}

let current = read();

export function getShowTestnets(): boolean {
  return current;
}

export function setShowTestnets(value: boolean): void {
  current = value;
  try {
    localStorage.setItem(KEY, value ? "1" : "0");
  } catch {
    // Storage is a convenience here; the in-memory value still drives the UI.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useShowTestnets(): [boolean, (value: boolean) => void] {
  const value = useSyncExternalStore(subscribe, getShowTestnets, () => true);
  const set = useCallback((next: boolean) => setShowTestnets(next), []);
  return [value, set];
}

/** The chain ids a chain-less page should probe, ascending. */
export function visibleChainIds(): number[] {
  return CHAINS.filter((c) => (getShowTestnets() ? true : !c.testnet))
    .map((c) => c.id)
    .sort((a, b) => a - b);
}
```

- [ ] **Step 4: Write the toggle control**

```tsx
import { useShowTestnets, visibleChainIds } from "../../lib/settings/testnets";
import { CHAINS } from "../../lib/chains";

/**
 * The testnet switch. Rendered in the app footer and in /settings; both read
 * and write the one store, so they can never disagree.
 *
 * Built from a button with role="switch" rather than a native checkbox —
 * native form controls are banned in this codebase because the browser owns
 * their appearance and they always read as foreign chrome.
 */
export default function TestnetToggle() {
  const [show, setShow] = useShowTestnets();
  const visible = visibleChainIds().length;

  return (
    <span className="inline-flex items-center gap-inline">
      <button
        type="button"
        role="switch"
        aria-checked={show}
        aria-label="Show testnets"
        onClick={() => setShow(!show)}
        className={`relative h-4 w-[30px] rounded-full shadow-[0_0_0_1px_var(--color-border-default)] ${
          show ? "bg-(--color-accent-muted)" : "theme-tertiary-bg"
        }`}
      >
        <span
          className={`absolute top-0.5 size-3 rounded-full transition-transform ${
            show ? "translate-x-[14px] bg-(--color-accent)" : "translate-x-0.5 bg-(--color-text-muted)"
          }`}
        />
      </button>
      <span className="theme-text-secondary theme-mono text-xs">Testnets</span>
      <span className="theme-text-muted theme-mono text-[10px] rounded px-1.5 shadow-[0_0_0_1px_var(--color-border-default)]">
        {visible} of {CHAINS.length} chains
      </span>
    </span>
  );
}
```

- [ ] **Step 5: Mount it and feed it to the fan-out**

In `AppShell.tsx`, add a footer row that renders `<TestnetToggle />`. Use `p-2 sm:p-4` and an outset top edge: `shadow-[0_-1px_0_0_var(--color-border-default)]`. In `SettingsPanel.tsx`, render the same component in a labelled row.

In `MultiChainAddressView.tsx`, pass the visible set to both queries and put it in the query keys, so flipping the toggle refetches rather than serving a stale four-chain answer:

```tsx
import { useShowTestnets, visibleChainIds } from "../../lib/settings/testnets";

const [showTestnets] = useShowTestnets();
const chainIds = useMemo(() => visibleChainIds(), [showTestnets]);

const presence = useQuery({
  queryKey: ["multichain-presence", address, chainIds],
  queryFn: () => fetchChainPresence(address, chainIds),
  staleTime: 60_000,
});

const activity = useQuery({
  queryKey: ["multichain-activity", address, chainIds],
  queryFn: () => fetchMergedActivity(address, chainIds),
  enabled: presence.isSuccess,
  staleTime: 60_000,
});
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm run test --workspace=packages/web`
Expected: PASS, whole suite.

- [ ] **Step 7: Verify by running the app**

```bash
npm run dev
```

On `/address/0x11490E0f8050FA8A3f40C5aA9bB20fB76B010b68`, flip the footer toggle. Confirm the testnet rows disappear, the badge reads "2 of 4 chains", and the network tab shows the next request carrying `chains=1,369`. Reload and confirm the setting survives. Then open `/eip155/943/tx/<a 943 hash>` with testnets hidden and confirm it still renders.

- [ ] **Step 8: Commit**

```bash
git add packages/web/src/lib/settings/ packages/web/src/components/settings/TestnetToggle.tsx \
        packages/web/src/components/AppShell.tsx \
        packages/web/src/components/settings/SettingsPanel.tsx \
        packages/web/src/components/explorer/MultiChainAddressView.tsx \
        packages/web/src/__tests__/testnetToggle.test.tsx
git commit -m "feat(web): add the global testnet toggle as a fan-out control"
```

---

### Task 15: Add the slim "also on" bar to scoped pages

**Files:**
- Create: `packages/web/src/components/explorer/AlsoOnBar.tsx`
- Modify: `packages/web/src/components/explorer/AddressView.tsx`
- Test: `packages/web/src/__tests__/alsoOnBar.test.tsx` (create)

**Interfaces:**
- Consumes: `fetchChainPresence`/`hasPresence` (Task 11), `scanPath` (Task 5), `visibleChainIds` (Task 14).
- Produces: `<AlsoOnBar address={string} activeChainId={number} />`

- [ ] **Step 1: Write the failing tests**

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AlsoOnBar from "../components/explorer/AlsoOnBar";

const ADDR = "0x11490e0f8050fa8a3f40c5aa9bb20fb76b010b68";

const presenceMock = vi.hoisted(() => vi.fn());
vi.mock("../api/multichain", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/multichain")>()),
  fetchChainPresence: presenceMock,
}));

function renderBar(activeChainId = 1) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AlsoOnBar address={ADDR} activeChainId={activeChainId} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  presenceMock.mockReset();
  presenceMock.mockResolvedValue([
    { chainId: 1, balance: "1", nonce: 1, isContract: false },
    { chainId: 369, balance: "1", nonce: 1, isContract: false },
    { chainId: 943, balance: "0", nonce: 0, isContract: false },
  ]);
});

describe("AlsoOnBar", () => {
  it("links every other chain with presence", async () => {
    renderBar(1);
    await waitFor(() =>
      expect(screen.getByRole("link", { name: /PulseChain/ })).toHaveAttribute(
        "href",
        `/eip155/369/address/${ADDR}`,
      ),
    );
  });

  it("marks the active chain and does not link it", async () => {
    renderBar(1);
    await waitFor(() => expect(screen.getByText("Ethereum")).toBeInTheDocument());
    expect(screen.queryByRole("link", { name: /Ethereum/ })).toBeNull();
  });

  it("offers a link to the all-chain page", async () => {
    renderBar(1);
    await waitFor(() =>
      expect(screen.getByRole("link", { name: /all/i })).toHaveAttribute(
        "href",
        `/address/${ADDR}`,
      ),
    );
  });

  it("renders nothing while the probe is in flight", () => {
    presenceMock.mockReturnValue(new Promise(() => {}));
    const { container } = renderBar(1);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the address is on one chain only", async () => {
    presenceMock.mockResolvedValue([
      { chainId: 1, balance: "1", nonce: 1, isContract: false },
      { chainId: 369, balance: "0", nonce: 0, isContract: false },
    ]);
    const { container } = renderBar(1);
    await waitFor(() => expect(presenceMock).toHaveBeenCalled());
    // A bar advertising no alternatives is noise.
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test --workspace=packages/web -- alsoOnBar`
Expected: FAIL — cannot resolve `AlsoOnBar`.

- [ ] **Step 3: Write the component**

```tsx
import { useQuery } from "@tanstack/react-query";
import { chainById, chainLogoUrl } from "../../lib/chains";
import { scanPath } from "../../lib/scanRoutes";
import { visibleChainIds } from "../../lib/settings/testnets";
import { fetchChainPresence, hasPresence } from "../../api/multichain";

/**
 * The slim form of the presence strip, for a page already scoped to one chain.
 *
 * Same data, same query key as the all-chain page — so opening a scoped page
 * after the aggregate one costs nothing. Renders nothing while probing and
 * nothing when there is only one chain to offer: a bar advertising no
 * alternatives is noise on every page that has none.
 */
interface Props {
  address: string;
  activeChainId: number;
}

export default function AlsoOnBar({ address, activeChainId }: Props) {
  const chainIds = visibleChainIds();
  const { data } = useQuery({
    queryKey: ["multichain-presence", address, chainIds],
    queryFn: () => fetchChainPresence(address, chainIds),
    staleTime: 60_000,
  });

  if (!data) return null;
  const present = data.filter(hasPresence);
  if (present.length < 2) return null;

  return (
    <div className="flex flex-wrap items-center gap-inline p-2 theme-card-bg shadow-[0_0_0_1px_var(--color-border-default)]">
      <span className="theme-text-muted text-xs uppercase tracking-wide font-semibold">
        Also on
      </span>
      {present.map((p) => {
        const chain = chainById(p.chainId);
        const label = chain?.name ?? String(p.chainId);
        const art = (
          <img
            src={chainLogoUrl(p.chainId)}
            alt=""
            width={14}
            height={14}
            className={`size-[14px] shrink-0 rounded-full ${chain?.testnet ? "grayscale opacity-60" : ""}`}
          />
        );
        return p.chainId === activeChainId ? (
          <span
            key={p.chainId}
            className="inline-flex items-center gap-tight rounded px-2 py-0.5 theme-mono text-xs theme-text shadow-[0_0_0_1px_var(--color-accent)] bg-(--color-accent-muted)"
          >
            {art}
            {label}
          </span>
        ) : (
          <a
            key={p.chainId}
            href={scanPath("address", address, p.chainId)}
            className="inline-flex items-center gap-tight rounded px-2 py-0.5 theme-mono text-xs theme-text shadow-[0_0_0_1px_var(--color-border-default)]"
          >
            {art}
            {label}
          </a>
        );
      })}
      <a
        href={scanPath("address", address)}
        className="rounded px-2 py-0.5 theme-mono text-xs theme-text-muted shadow-[0_0_0_1px_var(--color-border-muted)]"
      >
        all →
      </a>
    </div>
  );
}
```

- [ ] **Step 4: Mount it in `AddressView`**

Render `<AlsoOnBar address={address} activeChainId={chainId} />` directly beneath the address header, above the balance panel. `chainId` comes from the existing `useActiveChainId()` call.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test --workspace=packages/web -- alsoOnBar` then the full suite.
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/components/explorer/AlsoOnBar.tsx \
        packages/web/src/components/explorer/AddressView.tsx \
        packages/web/src/__tests__/alsoOnBar.test.tsx
git commit -m "feat(explorer): offer one-click chain flipping on a scoped address"
```

---

### Task 16: Add the block-height page and update CLAUDE.md

**Files:**
- Create: `packages/web/src/components/explorer/BlockHeightView.tsx`
- Create: `packages/api/src/routes/multichain/blockHeight.ts` (folded into the existing multichain router)
- Modify: `packages/api/src/routes/multichain/index.ts`
- Modify: `packages/web/src/components/explorer/ExplorerPanel.tsx`
- Modify: `CLAUDE.md`
- Test: `packages/web/src/__tests__/blockHeightView.test.tsx` (create)

**Interfaces:**
- Consumes: `EntityRow` (Task 10), `scanPath` (Task 5), `runWithChain`, `getBlockDetails` from `services/explorer/blocks.js`.
- Produces:
  - `GET /api/multichain/block/:number` → `{ ok, result: { height, chains: BlockAtHeight[] } }`
  - `interface BlockAtHeight { chainId: number; reached: boolean; head?: number; hash?: string; txCount?: number; gasUsed?: string; gasLimit?: string; timestamp?: number; error?: true }`
  - `<BlockHeightView height={string} />`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import BlockHeightView from "../components/explorer/BlockHeightView";

const heightMock = vi.hoisted(() => vi.fn());
vi.mock("../api/multichain", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/multichain")>()),
  fetchBlockAtHeight: heightMock,
}));

function renderView(height = "26923553") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <BlockHeightView height={height} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  heightMock.mockReset();
  heightMock.mockResolvedValue([
    { chainId: 1, reached: false, head: 21402118 },
    { chainId: 369, reached: true, hash: "0x8f21", txCount: 142, gasUsed: "22200000", gasLimit: "30000000", timestamp: 1700000000 },
    { chainId: 943, reached: true, hash: "0x21ab", txCount: 3, gasUsed: "1200000", gasLimit: "30000000", timestamp: 1699400000 },
    { chainId: 11155111, reached: false, head: 7118904 },
  ]);
});

describe("BlockHeightView", () => {
  it("links every chain that has reached the height", async () => {
    renderView();
    await waitFor(() =>
      expect(screen.getByRole("link", { name: /PulseChain$/ })).toHaveAttribute(
        "href",
        "/eip155/369/block/26923553",
      ),
    );
  });

  it("collapses chains that have not reached the height, naming their head", async () => {
    renderView();
    await waitFor(() => expect(screen.getByText(/not reached/i)).toBeInTheDocument());
    expect(screen.getByText(/21,402,118/)).toBeInTheDocument();
  });

  it("fills each row by gas used", async () => {
    const { container } = renderView();
    await waitFor(() => expect(screen.getByText(/142/)).toBeInTheDocument());
    const fills = container.querySelectorAll("[data-testid='row-fill']");
    expect((fills[0] as HTMLElement).style.width).toBe("74%");
    expect((fills[1] as HTMLElement).style.width).toBe("4%");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace=packages/web -- blockHeightView`
Expected: FAIL — cannot resolve `BlockHeightView`.

- [ ] **Step 3: Add the backend route**

Append to `packages/api/src/routes/multichain/index.ts`:

```ts
import { chainClient, runWithChain } from "../../services/chains/context.js";
import { listChains } from "../../services/chains/registry.js";

/**
 * GET /api/multichain/block/:number
 *
 * A block NUMBER is not chain-locatable — every chain past that height has one.
 * So rather than guessing, this reports the height on each chain: the block if
 * the chain has reached it, and the chain's own head if it has not. Chain-
 * agnostic like the address routes.
 */
router.get(
  "/block/:number",
  asyncRoute(async (req: Request, res: Response) => {
    const raw = String(req.params.number ?? "");
    if (!/^\d+$/.test(raw)) throw new ApiError(400, "Block number required");
    const height = BigInt(raw);

    const chains = parseChainsParam(
      typeof req.query.chains === "string" ? req.query.chains : undefined,
    ) ?? listChains().map((c) => c.chainId);

    const result = await Promise.all(
      chains.map((chainId) =>
        runWithChain(chainId, async () => {
          try {
            const client = chainClient();
            const head = await client.getBlockNumber();
            if (head < height) {
              return { chainId, reached: false, head: Number(head) };
            }
            const block = await client.getBlock({ blockNumber: height });
            return {
              chainId,
              reached: true,
              hash: block.hash,
              txCount: block.transactions.length,
              gasUsed: String(block.gasUsed),
              gasLimit: String(block.gasLimit),
              timestamp: Number(block.timestamp),
            };
          } catch {
            // Same rule as the address routes: unknown is not absent.
            return { chainId, reached: false, error: true as const };
          }
        }),
      ),
    );

    respond.ok(res, { result: { height: raw, chains: result } });
  }, "multichain/block"),
);
```

Add the matching client function to `packages/web/src/api/multichain.ts`:

```ts
export interface BlockAtHeight {
  chainId: number;
  reached: boolean;
  head?: number;
  hash?: string;
  txCount?: number;
  gasUsed?: string;
  gasLimit?: string;
  timestamp?: number;
  error?: true;
}

export async function fetchBlockAtHeight(
  height: string,
  chainIds?: number[],
): Promise<BlockAtHeight[]> {
  const result = await get<{ height: string; chains: BlockAtHeight[] }>(
    `${API_BASE}/block/${height}${chainsParam(chainIds)}`,
  );
  return result.chains;
}
```

- [ ] **Step 4: Write the view**

```tsx
import { useQuery } from "@tanstack/react-query";
import EntityRow from "../primitives/EntityRow";
import { chainById, chainLogoUrl } from "../../lib/chains";
import { scanPath } from "../../lib/scanRoutes";
import { visibleChainIds } from "../../lib/settings/testnets";
import { fetchBlockAtHeight } from "../../api/multichain";

/**
 * `/block/<number>` with no chain named.
 *
 * A height is not chain-locatable: every chain past it has a block there. So
 * this page reports the height on each chain rather than silently picking one.
 * Third use of the same two-line row — here the fill carries gas used, which
 * makes a full block and an empty one distinguishable at a glance.
 */
export default function BlockHeightView({ height }: { height: string }) {
  const chainIds = visibleChainIds();
  const { data } = useQuery({
    queryKey: ["multichain-block", height, chainIds],
    queryFn: () => fetchBlockAtHeight(height, chainIds),
    staleTime: 60_000,
  });

  if (!data) {
    return <p className="p-2 theme-text-muted theme-mono text-xs">Checking every chain…</p>;
  }

  const reached = data.filter((b) => b.reached);
  const notReached = data.filter((b) => !b.reached);

  return (
    <div className="flex flex-col gap-px">
      {reached.map((b) => {
        const chain = chainById(b.chainId);
        const used = Number(b.gasUsed ?? 0);
        const limit = Number(b.gasLimit ?? 0);
        return (
          <EntityRow
            key={b.chainId}
            href={scanPath("block", height, b.chainId)}
            share={limit > 0 ? used / limit : undefined}
            art={
              <img
                src={chainLogoUrl(b.chainId)}
                alt=""
                width={22}
                height={22}
                className={`size-[22px] shrink-0 rounded-full ${chain?.testnet ? "grayscale opacity-60" : ""}`}
              />
            }
            main={chain?.name ?? String(b.chainId)}
            sub={`${b.hash?.slice(0, 10) ?? "—"} · ${(used / 1e6).toFixed(1)}M / ${(limit / 1e6).toFixed(0)}M gas`}
            right={`${b.txCount ?? 0} txs`}
          />
        );
      })}

      {notReached.length > 0 && (
        <div className="flex flex-wrap items-center gap-inline p-2 theme-text-muted theme-mono text-xs shadow-[0_0_0_1px_var(--color-border-muted)]">
          <span className="uppercase tracking-wide font-semibold">Not reached</span>
          {notReached.map((b) => (
            <span key={b.chainId}>
              {chainById(b.chainId)?.name ?? b.chainId}
              {b.error ? " · unavailable" : ` · head ${(b.head ?? 0).toLocaleString()}`}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Wire it into `ExplorerPanel`**

Extend the `showAllChains` branch from Task 13:

```tsx
// A bare block NUMBER is not chain-locatable; a block HASH is. Only the number
// form gets the all-chain treatment.
const isBlockNumber = view.type === "block" && /^\d+$/.test(view.numberOrHash);

if (scope.kind === "all" && isBlockNumber) {
  return <BlockHeightView height={view.numberOrHash} />;
}
```

- [ ] **Step 6: Update `CLAUDE.md`**

The deep-link paragraph states invariants that this work changes. Replace the paragraph beginning "**Chain lives in `?chainid=N`, so deep links must resolve it.**" with:

```markdown
**Chain lives in the path as `/eip155/<id>/…`, and a chain-less URL is not a
bug.** The canonical scoped form is `/eip155/369/tx/0xabc` — two CAIP-2 segments,
never the colon form (`docs/GIB_SHOW.md` records `/image/eip155:369` returning
404 where the dash form returns 200). `packages/web/src/lib/chainScope.ts` is the
ONLY reader; `useActiveChainId()` delegates to it and keeps its old signature, so
its ~40 call sites never moved. `?chainid=N` survives as a legacy form that
`LegacyChainParamRedirect` rewrites once — it fires only when the path has no
prefix, and writing the prefix is what prevents a loop.

**An unscoped URL means "every chain" on exactly three routes** —
`/address/:addr`, `/token/:addr`, `/block/:number` — which render every chain and
never redirect. Every other route collapses "all" to `DEFAULT_CHAIN_ID`.
`useResolvedChainRedirect` still resolves a chain-less `/tx/0x…` and
`/debugger/0x…`, because a hash lives on exactly one chain; it deliberately does
NOT fire for an address, which is valid on all of them. Its three invariants
still hold and are pinned in `__tests__/routingCharacterization.test.tsx`: it runs
only when the scope is absent, its `"resolving"` state gates the entity fetch, and
it does not redirect when the entity is on the default chain.

**The API transport still uses `?chainid=N`.** Only the browser URL moved.
`scoped()` and `chainContext` are unchanged. The chain-agnostic endpoints
(`/api/resolve`, `/api/multichain/*`) ignore `chainid` by design and take an
optional `chains=1,369` allowlist, which is how the global testnet toggle
(`lib/settings/testnets.ts`) halves the fan-out.
```

- [ ] **Step 7: Run the full suite and both typechecks**

```bash
npm run test --workspace=packages/web
npm run test:unit --workspace=packages/api
npm run typecheck --workspace=packages/api
npm run build --workspace=packages/web
```

Expected: all PASS.

- [ ] **Step 8: Verify by running the app**

```bash
npm run dev
```

Walk the whole feature:
- `/address/0x11490E0f8050FA8A3f40C5aA9bB20fB76B010b68` — all chains, no redirect
- click a chain row → `/eip155/1/address/0x…`, with the "also on" bar
- `/block/26923553` — the height on each chain, gas fill visible
- `/tx/<a 943 hash>` — still redirects to `/eip155/943/tx/…`
- `/tx/<hash>?chainid=1` — rewrites to the path form
- `/settings` — still settings; the testnet toggle matches the footer
- resize to 375px and confirm no horizontal page scroll

- [ ] **Step 9: Commit**

```bash
git add packages/web/src/components/explorer/BlockHeightView.tsx \
        packages/web/src/components/explorer/ExplorerPanel.tsx \
        packages/web/src/api/multichain.ts \
        packages/api/src/routes/multichain/index.ts \
        packages/web/src/__tests__/blockHeightView.test.tsx \
        CLAUDE.md
git commit -m "feat(explorer): show a block height across every chain"
```
