# Progressive Transaction Decode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the explorer transaction page paint core facts immediately without waiting on ABI-decode from verified-source upstreams; decode arrives separately and swaps in.

**Architecture:** Opt-in split of `GET /api/tx/:hash`. The endpoint stays complete by default (`decode=0` returns core only, reusing the existing `skipDecode` seam); a new `GET /api/tx/:hash/decode` returns just `{ decodedInput, decodedLogs }`. The web tx page fetches core (fast) and decode (slow, non-blocking) as two requests and overlays decode when it lands.

**Tech Stack:** Express 4 + viem + Zod (API, `node:test`); React 19 + Vite + Vitest/Testing Library (web). ESM, `.js` import extensions in TS sources.

## Global Constraints

- **Response shape of `/api/tx/:hash` is unchanged.** `skipDecode` already yields `decodedInput: null` and `decodedLogs: []` — both valid values the page renders today. No new/optional fields on `TransactionDetails`.
- **Default stays complete.** Only `decode=0` opts out. Any other value (or absent) → full decode. No other `/api/tx` caller changes behavior.
- **`/decode` 504s on upstream failure — never returns `[]`.** Empty `decodedLogs` means "nothing to decode"; returning it for "upstream unreachable" is indistinguishable to the client and is forbidden.
- **Decode query stays OUT of TanStack Query.** The client persists to IndexedDB with `staleTime: Infinity`/`gcTime: Infinity`/`maxAge: Infinity` (`packages/web/src/main.tsx:50,100`); a failed decode would pin forever. Use a plain fetch hook mirroring `TxDetail`'s existing cancelled-flag effect. See `[[project-idb-cache-poisoning]]`.
- **BYO-RPC path is untouched.** `fetchTransaction` branches to `readTransactionViaRpc` when `isRpcOverridden(chainId)`; that path enriches on the user's node via `/from-raw` and is already complete + not our latency concern. The decode split applies to the standard (non-BYO) path only. In BYO mode the page must not issue the `/decode` fetch and must keep showing the complete payload.
- **ESM:** `.js` extensions on relative TS imports (API). BigInts already serialized to strings before JSON in the service layer.
- **Backend errors** use `ApiError` + `respond`/`asyncRoute` from `packages/api/src/lib/respond.ts`. Success envelope is `{ ok: true, ...body }`; error is `{ ok: false, error }`.

---

## File Structure

- `packages/api/src/routes/explorer.ts` — add `decode=0` handling to `GET /tx/:hash`; add `GET /tx/:hash/decode`. (Modify)
- `packages/api/tests/unit/explorerTxDecode.test.ts` — API tests for both behaviors. (Create)
- `packages/web/src/api/explorer.ts` — `fetchTransaction` gains a `{ decode?: boolean }` option; add `fetchTransactionDecode`. (Modify)
- `packages/web/src/hooks/useTxDecode.ts` — isolated fetch hook for the decode half. (Create)
- `packages/web/src/hooks/__tests__/useTxDecode.test.tsx` — hook tests. (Create)
- `packages/web/src/components/explorer/TxDetail.tsx` — request core-only (non-BYO), overlay decode, thread state to Events. (Modify)
- `packages/web/src/components/explorer/TxDetail/EventsSection.tsx` — "decoding…" / "unavailable" affordance. (Modify)
- `packages/web/src/components/explorer/__tests__/TxDetailProgressive.test.tsx` — page-level progressive-render tests. (Create)

---

## Task 1: `?decode=0` opt-out on `GET /api/tx/:hash`

**Files:**
- Modify: `packages/api/src/routes/explorer.ts` (the `GET /tx/:hash` handler, currently at lines 62-100)
- Test: `packages/api/tests/unit/explorerTxDecode.test.ts` (Create)

**Interfaces:**
- Consumes: `getTransactionDetails(hash, { skipDecode?: boolean })` from `../services/explorer.js` — already exists and already honored by the Etherscan handlers.
- Produces: `GET /api/tx/:hash?decode=0` → same envelope as today, but `decodedInput: null`, `decodedLogs: []`, and **zero ABI lookups**.

- [ ] **Step 1: Write the failing test**

The API unit tests hit a live server on :10100 (`node:test`). Add a file that asserts the opt-out returns core with empty decode. Use a known real PulseChain contract-call tx (reuse the swap tx used as a fixture elsewhere).

```ts
// packages/api/tests/unit/explorerTxDecode.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

const BASE = process.env.API_BASE ?? "http://localhost:10100";
// A real PulseChain (369) contract call with several log emitters.
const TX = "0x2765c1209a69ed019ca52b5f5fdbf46c4276dcd2b72d28d7ef434fbe31c9c03d";

test("GET /api/tx/:hash?decode=0 returns core with empty decode", async () => {
  const res = await fetch(`${BASE}/api/tx/${TX}?chainid=369&decode=0`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  // Core facts present…
  assert.equal(typeof body.result.from, "string");
  assert.equal(typeof body.result.gasUsed, "string");
  assert.ok(Array.isArray(body.result.rawLogs) && body.result.rawLogs.length > 0);
  // …decode intentionally absent.
  assert.equal(body.result.decodedInput, null);
  assert.deepEqual(body.result.decodedLogs, []);
});

test("GET /api/tx/:hash (no flag) still decodes", async () => {
  const res = await fetch(`${BASE}/api/tx/${TX}?chainid=369`);
  const body = await res.json();
  assert.equal(body.result.decodedInput?.functionName, "swap");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run dev` in one shell (API on :10100), then `node --test packages/api/tests/unit/explorerTxDecode.test.ts`
Expected: the `decode=0` test FAILS — the current handler ignores the query and decodes anyway, so `decodedInput` is non-null / `decodedLogs` non-empty.

- [ ] **Step 3: Implement the opt-out**

In `packages/api/src/routes/explorer.ts`, the handler currently calls `getTransactionDetails(hash)` inside the `Promise.all` at line ~77. Parse the flag and thread `skipDecode`:

```ts
router.get(
  "/tx/:hash",
  asyncRoute(async (req: Request, res: Response) => {
    const hash = String(req.params.hash ?? "");
    if (!HASH_RE.test(hash)) {
      throw new ApiError(400, "Invalid transaction hash");
    }

    // Opt-out: `?decode=0` returns core facts only (no ABI lookups), so the
    // page can paint without waiting on a verified-source upstream. Anything
    // other than "0" keeps the default complete behavior — no other caller of
    // /api/tx changes. Decode is fetched separately via /tx/:hash/decode.
    const skipDecode = req.query.decode === "0";

    const [details, internalTxs, tokenTransfers] = await Promise.all([
      withTimeout(
        getTransactionDetails(hash, { skipDecode }),
        15_000,
        null as Awaited<ReturnType<typeof getTransactionDetails>> | null,
      ),
      withTimeout(getInternalTransactions(hash).catch(() => []), 10_000, []),
      withTimeout(getTokenTransfers(hash).catch(() => []), 10_000, []),
    ]);

    if (!details) {
      throw new ApiError(
        504,
        "Transaction fetch timed out — the node may be slow",
      );
    }

    respond.ok(res, {
      result: {
        ...details,
        internalTransactions: internalTxs,
        tokenTransfers,
      },
    });
  }, "explorer/tx"),
);
```

(Only two lines change vs. today: the `const skipDecode = …` line and passing `{ skipDecode }` to `getTransactionDetails`. The error copy tweak — "the node" instead of "PulseChain RPC" — corrects the misdiagnosis noted in `[[project-verified-source-upstreams]]`; leave the rest of the handler as-is.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test packages/api/tests/unit/explorerTxDecode.test.ts`
Expected: both tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/routes/explorer.ts packages/api/tests/unit/explorerTxDecode.test.ts
git commit -m "feat(api): decode=0 opt-out on GET /api/tx/:hash"
```

---

## Task 2: `GET /api/tx/:hash/decode` endpoint

**Files:**
- Modify: `packages/api/src/routes/explorer.ts` (add a route directly after the `GET /tx/:hash` handler)
- Test: `packages/api/tests/unit/explorerTxDecode.test.ts` (extend from Task 1)

**Interfaces:**
- Consumes: `getTransactionDetails(hash)` (full decode) from `../services/explorer.js`.
- Produces: `GET /api/tx/:hash/decode` → `{ ok: true, result: { decodedInput, decodedLogs } }` on success; **504** `{ ok: false, error }` when decode can't complete within budget; 404 on unknown hash (propagated from the service).

- [ ] **Step 1: Write the failing test**

Append to `packages/api/tests/unit/explorerTxDecode.test.ts`:

```ts
test("GET /api/tx/:hash/decode returns only the decoded fields", async () => {
  const res = await fetch(`${BASE}/api/tx/${TX}/decode?chainid=369`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.result.decodedInput?.functionName, "swap");
  assert.ok(Array.isArray(body.result.decodedLogs));
  // Core facts are NOT duplicated onto this response.
  assert.equal(body.result.from, undefined);
  assert.equal(body.result.rawLogs, undefined);
});

test("GET /api/tx/:hash/decode 400s on a malformed hash", async () => {
  const res = await fetch(`${BASE}/api/tx/0xnothex/decode?chainid=369`);
  assert.equal(res.status, 400);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test packages/api/tests/unit/explorerTxDecode.test.ts`
Expected: the `/decode` test FAILS with 404 (route doesn't exist yet).

- [ ] **Step 3: Implement the route**

In `packages/api/src/routes/explorer.ts`, add directly after the `GET /tx/:hash` handler (before `POST /tx/:hash/from-raw`):

```ts
// ---------------------------------------------------------------------------
// GET /api/tx/:hash/decode
// ---------------------------------------------------------------------------
//
// The decode half of the tx page, split off so the page can paint core facts
// (GET /tx/:hash?decode=0) without waiting on a verified-source upstream.
// Returns ONLY the two decoded fields. On a decode timeout this 504s rather
// than returning an empty decodedLogs — empty means "nothing to decode", and
// returning it for "upstream unreachable" is a lie the client can't tell apart.
router.get(
  "/tx/:hash/decode",
  asyncRoute(async (req: Request, res: Response) => {
    const hash = String(req.params.hash ?? "");
    if (!HASH_RE.test(hash)) {
      throw new ApiError(400, "Invalid transaction hash");
    }

    // Budget: sized against the upstream deadlines this waits on
    // (SOURCIFY_FETCH_TIMEOUT 8s + BLOCKSCOUT_FETCH_TIMEOUT 3s = 11s), plus
    // headroom for the cheap tx+receipt re-read. `null` sentinel → 504.
    const details = await withTimeout(
      getTransactionDetails(hash),
      13_000,
      null as Awaited<ReturnType<typeof getTransactionDetails>> | null,
    );

    if (!details) {
      throw new ApiError(504, "Decode timed out — verified-source upstream slow or unavailable");
    }

    respond.ok(res, {
      result: {
        decodedInput: details.decodedInput,
        decodedLogs: details.decodedLogs,
      },
    });
  }, "explorer/tx-decode"),
);
```

Note: a genuinely unknown hash makes `getTransactionDetails` throw `ApiError(404)`, which `asyncRoute` surfaces as 404 — so no extra handling is needed for that case, and the 404 test in Task 1's file (`0xnothex`) is a 400 from the regex, distinct from a 404.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test packages/api/tests/unit/explorerTxDecode.test.ts`
Expected: all Task 1 + Task 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/routes/explorer.ts packages/api/tests/unit/explorerTxDecode.test.ts
git commit -m "feat(api): GET /api/tx/:hash/decode returns decode-only, 504 on timeout"
```

---

## Task 3: Web API client — `decode` option + `fetchTransactionDecode`

**Files:**
- Modify: `packages/web/src/api/explorer.ts` (`fetchTransaction` at ~203; types near line 50)
- Test: covered indirectly by Task 4's hook test + Task 5's page test (no separate client test — these are thin wrappers over `apiFetch`, exercised by consumers).

**Interfaces:**
- Consumes: `apiUrl`, `scoped`, `apiFetch<T>`, `isRpcOverridden`, `DEFAULT_CHAIN_ID`, `TransactionDetails` — all already in this file.
- Produces:
  - `fetchTransaction(hash, chainId?, opts?: { decode?: boolean })` — when `opts.decode === false` **and not** BYO-overridden, appends `decode=0`. BYO path unchanged (always complete).
  - `fetchTransactionDecode(hash, chainId?)`: `Promise<Pick<TransactionDetails, "decodedInput" | "decodedLogs">>`.

- [ ] **Step 1: Add a decode-only response type near the other types (~line 60)**

```ts
export type TransactionDecode = Pick<
  TransactionDetails,
  "decodedInput" | "decodedLogs"
>;
```

- [ ] **Step 2: Thread the `decode` option through `fetchTransaction`**

Replace the existing `fetchTransaction` (lines 203-214) with:

```ts
export async function fetchTransaction(
  hash: string,
  chainId: number = DEFAULT_CHAIN_ID,
  opts: { decode?: boolean } = {},
): Promise<TransactionDetails> {
  // Bring-your-own-RPC: enriches on the user's node via /from-raw and is
  // already complete — the decode split does not apply, so ignore `decode`.
  if (isRpcOverridden(chainId)) return readTransactionViaRpc(hash, chainId);

  // `decode: false` → core only (decode=0); the page fetches decode separately
  // via fetchTransactionDecode so it can paint without waiting on it.
  const base = `${API_BASE}/tx/${hash}`;
  const url = opts.decode === false ? `${base}?decode=0` : base;
  return apiFetch<TransactionDetails>(scoped(url, chainId));
}
```

Note `scoped(url, chainId)` appends `chainid` correctly whether or not `?decode=0` is already present (it uses URL parsing, same as every other call site). Verify by reading `scoped` if unsure.

- [ ] **Step 3: Add `fetchTransactionDecode` directly below**

```ts
/**
 * The decode half of the tx page. Hits GET /api/tx/:hash/decode, which returns
 * only { decodedInput, decodedLogs } and 504s (rather than returning empty)
 * when a verified-source upstream is unavailable — so the caller can tell
 * "nothing to decode" from "couldn't decode".
 */
export async function fetchTransactionDecode(
  hash: string,
  chainId: number = DEFAULT_CHAIN_ID,
): Promise<TransactionDecode> {
  return apiFetch<TransactionDecode>(scoped(`${API_BASE}/tx/${hash}/decode`, chainId));
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc -b --force packages/web`
Expected: exit 0. (No behavior change for existing callers — the new param is optional.)

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/api/explorer.ts
git commit -m "feat(web): fetchTransaction decode opt-out + fetchTransactionDecode"
```

---

## Task 4: `useTxDecode` hook

**Files:**
- Create: `packages/web/src/hooks/useTxDecode.ts`
- Test: `packages/web/src/hooks/__tests__/useTxDecode.test.tsx`

**Interfaces:**
- Consumes: `fetchTransactionDecode`, `TransactionDecode` from `../api/explorer`; `isRpcOverridden` from `../lib/rpcEndpoint`.
- Produces: `useTxDecode(hash, chainId, enabled?: boolean)` → `{ decodedInput, decodedLogs, state }` where `state: "pending" | "ready" | "unavailable"`. When `enabled === false` (BYO mode) it never fetches and reports `state: "ready"` with `null`/`[]` so the caller falls back to the complete payload.

- [ ] **Step 1: Write the failing test**

```tsx
// packages/web/src/hooks/__tests__/useTxDecode.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useTxDecode } from "../useTxDecode";
import * as api from "../../api/explorer";

describe("useTxDecode", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("starts pending, then ready with decode", async () => {
    vi.spyOn(api, "fetchTransactionDecode").mockResolvedValue({
      decodedInput: { functionName: "swap", args: [] },
      decodedLogs: [],
    });
    const { result } = renderHook(() => useTxDecode("0xabc", 369));
    expect(result.current.state).toBe("pending");
    await waitFor(() => expect(result.current.state).toBe("ready"));
    expect(result.current.decodedInput?.functionName).toBe("swap");
  });

  it("reports unavailable when the decode fetch rejects", async () => {
    vi.spyOn(api, "fetchTransactionDecode").mockRejectedValue(new Error("504"));
    const { result } = renderHook(() => useTxDecode("0xabc", 369));
    await waitFor(() => expect(result.current.state).toBe("unavailable"));
    expect(result.current.decodedInput).toBeNull();
    expect(result.current.decodedLogs).toEqual([]);
  });

  it("does not fetch when disabled (BYO mode)", async () => {
    const spy = vi.spyOn(api, "fetchTransactionDecode").mockResolvedValue({
      decodedInput: null,
      decodedLogs: [],
    });
    const { result } = renderHook(() => useTxDecode("0xabc", 369, false));
    expect(result.current.state).toBe("ready");
    expect(spy).not.toHaveBeenCalled();
  });

  it("ignores a stale response after the hash changes", async () => {
    const slow = { decodedInput: { functionName: "old", args: [] }, decodedLogs: [] };
    const fast = { decodedInput: { functionName: "new", args: [] }, decodedLogs: [] };
    vi.spyOn(api, "fetchTransactionDecode")
      .mockResolvedValueOnce(slow as never)
      .mockResolvedValueOnce(fast as never);
    const { result, rerender } = renderHook(
      ({ h }) => useTxDecode(h, 369),
      { initialProps: { h: "0xold" } },
    );
    rerender({ h: "0xnew" });
    await waitFor(() => expect(result.current.state).toBe("ready"));
    expect(result.current.decodedInput?.functionName).toBe("new");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test --workspace=packages/web -- run src/hooks/__tests__/useTxDecode.test.tsx`
Expected: FAIL — module `../useTxDecode` does not exist.

- [ ] **Step 3: Implement the hook**

```ts
// packages/web/src/hooks/useTxDecode.ts
import { useEffect, useState } from "react";
import {
  fetchTransactionDecode,
  type TransactionDecode,
} from "../api/explorer";
import { isRpcOverridden } from "../lib/rpcEndpoint";

export type TxDecodeState = "pending" | "ready" | "unavailable";

export interface TxDecodeResult extends TransactionDecode {
  state: TxDecodeState;
}

const EMPTY: TransactionDecode = { decodedInput: null, decodedLogs: [] };

/**
 * Fetches the decode half of the tx page (GET /api/tx/:hash/decode) separately
 * from core, so the page paints without waiting on a verified-source upstream.
 *
 * Deliberately a plain fetch hook, NOT TanStack Query: the app persists queries
 * to IndexedDB with staleTime/gcTime/maxAge all Infinity, which would pin a
 * decode that failed during an upstream outage forever. A reload must retry.
 *
 * `enabled === false` (BYO-RPC, where the complete payload already carries
 * decode) short-circuits to a ready/empty result and issues no request.
 */
export function useTxDecode(
  hash: string,
  chainId: number,
  enabled: boolean = !isRpcOverridden(chainId),
): TxDecodeResult {
  const [result, setResult] = useState<TxDecodeResult>({
    ...EMPTY,
    state: enabled ? "pending" : "ready",
  });

  useEffect(() => {
    if (!enabled) {
      setResult({ ...EMPTY, state: "ready" });
      return;
    }
    let cancelled = false;
    setResult({ ...EMPTY, state: "pending" });

    fetchTransactionDecode(hash, chainId)
      .then((decode) => {
        if (!cancelled) setResult({ ...decode, state: "ready" });
      })
      .catch(() => {
        if (!cancelled) setResult({ ...EMPTY, state: "unavailable" });
      });

    return () => {
      cancelled = true;
    };
  }, [hash, chainId, enabled]);

  return result;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace=packages/web -- run src/hooks/__tests__/useTxDecode.test.tsx`
Expected: all 4 PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/hooks/useTxDecode.ts packages/web/src/hooks/__tests__/useTxDecode.test.tsx
git commit -m "feat(web): useTxDecode — non-persisted progressive decode hook"
```

---

## Task 5: Wire `TxDetail` for progressive render + Events affordance

**Files:**
- Modify: `packages/web/src/components/explorer/TxDetail.tsx`
- Modify: `packages/web/src/components/explorer/TxDetail/EventsSection.tsx`
- Test: `packages/web/src/components/explorer/__tests__/TxDetailProgressive.test.tsx` (Create)

**Interfaces:**
- Consumes: `fetchTransaction(hash, chainId, { decode: false })`, `useTxDecode(hash, chainId)`, `isRpcOverridden`.
- Produces: a tx page that renders core immediately and overlays decode. `EventsSection` gains an optional `decodeState?: "pending" | "ready" | "unavailable"` prop (defaulting to `"ready"` so no other caller changes).

- [ ] **Step 1: Write the failing page test**

```tsx
// packages/web/src/components/explorer/__tests__/TxDetailProgressive.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import TxDetail from "../TxDetail";
import * as api from "../../../api/explorer";

const CORE = {
  hash: "0xabc", blockNumber: "1", blockHash: "0x0", transactionIndex: 0,
  from: "0xfrom0000000000000000000000000000000000aa",
  to: "0xto000000000000000000000000000000000000bb",
  value: "0", valuePLS: "0", gas: "100000", gasPrice: "1", gasUsed: "50000",
  effectiveGasPrice: "1", nonce: 0, input: "0x38ed1739", status: "success",
  timestamp: 1, decodedInput: null, decodedLogs: [],
  rawLogs: [{ address: "0xemit", topics: ["0xddf252ad"], data: "0x", logIndex: 0 }],
  internalTransactions: [], tokenTransfers: [],
} as unknown as api.TransactionDetails;

describe("TxDetail progressive decode", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("renders core facts while decode is still pending", async () => {
    vi.spyOn(api, "fetchTransaction").mockResolvedValue(CORE);
    let resolveDecode!: (d: api.TransactionDecode) => void;
    vi.spyOn(api, "fetchTransactionDecode").mockReturnValue(
      new Promise((r) => { resolveDecode = r; }),
    );

    render(<TxDetail hash="0xabc" onNavigate={() => {}} />);

    // Core is on screen before decode resolves.
    await waitFor(() => expect(screen.getByText(/50000|50,000/)).toBeInTheDocument());
    expect(api.fetchTransaction).toHaveBeenCalledWith("0xabc", expect.any(Number), { decode: false });

    // Decode swaps in.
    resolveDecode({ decodedInput: { functionName: "swap", args: [] }, decodedLogs: [] });
    await waitFor(() => expect(screen.getByText(/swap/)).toBeInTheDocument());
  });

  it("keeps the page usable when decode is unavailable", async () => {
    vi.spyOn(api, "fetchTransaction").mockResolvedValue(CORE);
    vi.spyOn(api, "fetchTransactionDecode").mockRejectedValue(new Error("504"));

    render(<TxDetail hash="0xabc" onNavigate={() => {}} />);
    await waitFor(() => expect(screen.getByText(/decoding unavailable/i)).toBeInTheDocument());
    // Raw log still shown.
    expect(screen.getByText(/0xddf252ad/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test --workspace=packages/web -- run src/components/explorer/__tests__/TxDetailProgressive.test.tsx`
Expected: FAIL — `fetchTransaction` is called without `{ decode: false }`, and there's no "decoding unavailable" text.

- [ ] **Step 3: Update `TxDetail.tsx`**

At the top of the component add the decode hook and pass `{ decode: false }` to the core fetch. The core `useEffect` (lines ~26-48) changes only its `fetchTransaction` call:

```tsx
import { fetchTransaction, type TransactionDetails } from "../../api/explorer";
import { useActiveChainId } from "../../lib/activeChain";
import { useTxDecode } from "../../hooks/useTxDecode";
// …existing imports…

export default function TxDetail({ hash, onNavigate }: TxDetailProps) {
  const [tx, setTx] = useState<TransactionDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const chainId = useActiveChainId();

  const decode = useTxDecode(hash, chainId);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setTx(null);

    // Core only — decode arrives via useTxDecode so the page never waits on a
    // verified-source upstream to paint.
    fetchTransaction(hash, chainId, { decode: false })
      .then((data) => { if (!cancelled) setTx(data); })
      .catch((err) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [hash, chainId]);
```

Then in the render, overlay decode. Find the block (lines ~117-121) that renders `DecodedInputSection` and `EventsSection` and replace with:

```tsx
      {(() => {
        // Overlay: prefer freshly-fetched decode, fall back to whatever the
        // core payload carried (populated only in BYO mode).
        const decodedInput = decode.decodedInput ?? tx.decodedInput;
        const decodedLogs =
          decode.decodedLogs.length > 0 ? decode.decodedLogs : tx.decodedLogs;
        return (
          <>
            {decodedInput && <DecodedInputSection decoded={decodedInput} />}
            {(decodedLogs.length > 0 || tx.rawLogs.length > 0) && (
              <EventsSection
                decodedLogs={decodedLogs}
                rawLogs={tx.rawLogs}
                onNavigate={onNavigate}
                decodeState={decode.state}
              />
            )}
          </>
        );
      })()}
```

(If those two sections are not adjacent in the current file, apply the same `decodedInput`/`decodedLogs`/`decodeState` substitution in place — do not move unrelated sections.)

- [ ] **Step 4: Add the affordance to `EventsSection.tsx`**

Add the optional prop and a one-line note. Replace the signature + opening of the returned card:

```tsx
export function EventsSection({
  decodedLogs,
  rawLogs,
  onNavigate,
  decodeState = "ready",
}: {
  decodedLogs: TransactionDetails["decodedLogs"];
  rawLogs: TransactionDetails["rawLogs"];
  onNavigate: AddressNavigate;
  decodeState?: "pending" | "ready" | "unavailable";
}) {
  return (
    <SectionCard title="Events / Logs" count={rawLogs.length}>
      {decodeState === "pending" && (
        <div className="pt-2 text-xs theme-text-secondary">decoding…</div>
      )}
      {decodeState === "unavailable" && (
        <div className="pt-2 text-xs theme-text-secondary">
          decoding unavailable — showing raw logs
        </div>
      )}
      <div className="pt-3 space-y-2">
```

(Leave the rest of the component — the `rawLogs.map` body — unchanged.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test --workspace=packages/web -- run src/components/explorer/__tests__/TxDetailProgressive.test.tsx`
Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/components/explorer/TxDetail.tsx packages/web/src/components/explorer/TxDetail/EventsSection.tsx packages/web/src/components/explorer/__tests__/TxDetailProgressive.test.tsx
git commit -m "feat(web): progressive decode on the tx page + Events affordance"
```

---

## Task 6: Full-suite verification + real-app check

**Files:** none (verification only)

- [ ] **Step 1: API + web suites green**

Run:
```
npm run test:unit --workspace=packages/api
npm run test --workspace=packages/web -- run
npx tsc -b --force packages/api packages/web
```
Expected: all pass; typecheck exit 0. (Existing `EventsSection` callers compile unchanged because `decodeState` is optional and defaults to `"ready"`.)

- [ ] **Step 2: Drive the real page on a cold API**

With `npm run dev` running, in a browser load a chain-369 contract-call tx (e.g. `/tx/0x2765c1209a69ed019ca52b5f5fdbf46c4276dcd2b72d28d7ef434fbe31c9c03d`). Confirm: core facts + raw logs paint in well under a second; "decoding…" appears; decoded names swap in. Then verify the network tab shows two requests — `…/tx/<hash>?…decode=0` and `…/tx/<hash>/decode`.

Fall back to `curl` timing if no browser is available:
```bash
curl -s -o /dev/null -w 'core:   %{http_code} %{time_total}s\n' 'http://localhost:10100/api/tx/0x2765c1209a69ed019ca52b5f5fdbf46c4276dcd2b72d28d7ef434fbe31c9c03d?chainid=369&decode=0'
curl -s -o /dev/null -w 'decode: %{http_code} %{time_total}s\n' 'http://localhost:10100/api/tx/0x2765c1209a69ed019ca52b5f5fdbf46c4276dcd2b72d28d7ef434fbe31c9c03d/decode?chainid=369'
```
Expected: `core` ~0.3-0.4s and 200; `decode` slower (or 504 if upstreams are down) — and crucially the page is usable either way.

- [ ] **Step 3: Confirm no other `/api/tx` consumer regressed**

Run: `git grep -n "fetchTransaction(" packages/web/src packages/sdk/src`
Confirm every call other than `TxDetail`'s passes no `decode` option (so they still get the complete payload). Spot-check `TxPreview` and the debugger still show decoded data in the running app.

- [ ] **Step 4: Commit any doc/status touch-ups (if needed)**

```bash
git commit --allow-empty -m "chore: progressive tx decode verified end-to-end"
```

---

## Self-Review Notes

- **Spec coverage:** `?decode=0` (Task 1), `/decode` endpoint + 504-not-`[]` (Task 2), client wrappers (Task 3), non-persisted hook (Task 4), progressive render + honesty affordance (Task 5), zero-ABI regression + no-consumer-regression (Task 6). BYO-RPC untouched is enforced in Tasks 3-4.
- **Type consistency:** `TransactionDecode = Pick<TransactionDetails, "decodedInput" | "decodedLogs">` defined in Task 3, consumed by Tasks 4-5. `state`/`decodeState` union is spelled identically (`"pending" | "ready" | "unavailable"`) in the hook (Task 4) and the prop (Task 5).
- **No placeholders:** every code step shows complete code; every run step names the command and expected result.
