# Mobile Responsiveness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the Explore web UI down to a 375px phone viewport with no page-level horizontal scroll, giving the explorer/read routes a real mobile layout and every other route a no-overflow baseline.

**Architecture:** One breakpoint (`sm:`, 640px) divides "phone" from "desktop". The sidebar becomes an off-canvas drawer below `sm:` (its width is inline-styled today, so layout moves to Tailwind classes and behavior moves to a new `useMediaQuery` hook). Dense tables render as stacked cards below `sm:` via a shared `DataTable` primitive that takes one column definition and picks its presentation by viewport. A Playwright gate asserts `scrollWidth <= 375` across all routes.

**Tech Stack:** React 19, React Router 7, Tailwind v4, Vitest + jsdom (unit), Playwright (viewport e2e).

## Global Constraints

- **375px is the hard floor.** Nothing may cause page-level horizontal scroll (`document.documentElement.scrollWidth <= 375`) at viewport 375×667.
- **Single breakpoint `sm:` (640px)** for the whole app. The **only** documented exception is `/debugger`, which keeps `lg:` (1024px) for pane splitting — do not harmonize it to `sm:`.
- **Spacing classes are lint-gated.** `gap-1/2/3/5` and `space-y-4..8` are banned by `npm run lint:spacing`. Use semantic tokens: `gap-tight` (4px), `gap-inline` (8px), `gap-row` (12px), `space-y-stack` (12px), `space-y-section` (24px). Half-steps like `gap-1.5` are allowed.
- **Borders are box-shadow, never CSS `border`.** Use the `bs-*` utilities from `index.css` (e.g. `bs-b-muted`, `bs-r`). Cards use `.card`.
- **Padding is `p-2` or `p-4`**, never `p-6`+ except deliberate special cases.
- **Colors come from CSS custom properties** (`var(--color-*)`), applied via `theme-*` classes or inline `style` where dynamic.
- **`void handler()`** on async event handlers; derive state in render; no refs to smuggle derived state across renders.
- All new `.ts`/`.tsx` under `packages/web/src` must pass `tsc -b` and existing `npm run test --workspace=packages/web`.

## File Structure

**New files:**
- `packages/web/src/hooks/useMediaQuery.ts` — `matchMedia`-backed boolean hook.
- `packages/web/src/lib/format/hash.ts` — `truncateMiddle` + `shortHash`/`shortAddress`.
- `packages/web/src/lib/format/__tests__/hash.test.ts` — unit tests for the above.
- `packages/web/src/components/primitives/DataTable.tsx` — table/card dual-presentation primitive.
- `packages/web/src/components/primitives/__tests__/DataTable.test.tsx` — unit tests.
- `packages/web/src/components/AppShell/useMobileNav.ts` — drawer open/close behavior state.
- `packages/web/playwright.config.ts` — Playwright config.
- `packages/web/e2e/viewport.spec.ts` — the 375px no-overflow gate.

**Modified (major):**
- `packages/web/src/components/AppShell.tsx` — wire drawer + backdrop.
- `packages/web/src/components/AppShell/Sidebar.tsx` — class-based width, drawer positioning.
- `packages/web/src/components/AppShell/TopBar.tsx` — demote wallet/sync/RPC into drawer footer below `sm:`.
- `packages/web/src/components/AppShell/useSidebarState.ts` — desktop-collapse only (unchanged responsibility, documented).
- Nine explorer/health tables (Task 5) — adopt `DataTable`.
- ~15 baseline sites (Task 6) — grid/popover/flex fixes.
- `packages/web/src/components/debugger/StepDebugger.tsx` + `StepDebugger/SourceOpcodeSplit.tsx` (Task 7).

---

## Task 1: `useMediaQuery` hook

**Files:**
- Create: `packages/web/src/hooks/useMediaQuery.ts`
- Test: `packages/web/src/hooks/__tests__/useMediaQuery.test.ts`

**Interfaces:**
- Produces: `useMediaQuery(query: string): boolean`, and a convenience `useIsMobile(): boolean` that calls `useMediaQuery("(max-width: 639px)")` (639 = one below Tailwind's `sm` 640 breakpoint, so it flips in lockstep with `sm:` classes).

- [ ] **Step 1: Write the failing test**

```ts
// packages/web/src/hooks/__tests__/useMediaQuery.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useMediaQuery, useIsMobile } from "../useMediaQuery";

/** Build a controllable matchMedia mock. */
function installMatchMedia(initialMatches: boolean) {
  let matches = initialMatches;
  const listeners = new Set<(e: MediaQueryListEvent) => void>();
  const mql = {
    get matches() {
      return matches;
    },
    media: "",
    addEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) =>
      listeners.add(cb),
    removeEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) =>
      listeners.delete(cb),
  };
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => mql),
  );
  return {
    setMatches(next: boolean) {
      matches = next;
      listeners.forEach((cb) => cb({ matches } as MediaQueryListEvent));
    },
  };
}

describe("useMediaQuery", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("returns the initial match value", () => {
    installMatchMedia(true);
    const { result } = renderHook(() => useMediaQuery("(max-width: 639px)"));
    expect(result.current).toBe(true);
  });

  it("updates when the media query changes", () => {
    const ctl = installMatchMedia(false);
    const { result } = renderHook(() => useMediaQuery("(max-width: 639px)"));
    expect(result.current).toBe(false);
    act(() => ctl.setMatches(true));
    expect(result.current).toBe(true);
  });

  it("useIsMobile is true below sm", () => {
    installMatchMedia(true);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=packages/web -- useMediaQuery`
Expected: FAIL — cannot resolve `../useMediaQuery`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/web/src/hooks/useMediaQuery.ts
import { useSyncExternalStore } from "react";

/**
 * Subscribe to a CSS media query. `useSyncExternalStore` gives us a tear-free
 * read with no `setState`-in-effect chain — the store IS `matchMedia`.
 * SSR/`matchMedia`-less environments fall back to `false`.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof matchMedia !== "function") return () => {};
      const mql = matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () => (typeof matchMedia === "function" ? matchMedia(query).matches : false),
    () => false,
  );
}

/** True below Tailwind's `sm` breakpoint (640px) — i.e. phone width. */
export function useIsMobile(): boolean {
  return useMediaQuery("(max-width: 639px)");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=packages/web -- useMediaQuery`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/hooks/useMediaQuery.ts packages/web/src/hooks/__tests__/useMediaQuery.test.ts
git commit -m "feat(web): add useMediaQuery/useIsMobile hook"
```

---

## Task 2: `lib/format/hash.ts` truncation helpers

Consolidates six divergent inline hash-truncators. Load-bearing for the card layout — a 66-char nowrap mono hash is ~450px, wider than the target viewport.

**Files:**
- Create: `packages/web/src/lib/format/hash.ts`
- Test: `packages/web/src/lib/format/__tests__/hash.test.ts`

**Interfaces:**
- Produces:
  - `truncateMiddle(value: string, opts?: { lead?: number; tail?: number }): string` — defaults `lead: 6, tail: 4`; returns `value` unchanged if `value.length <= lead + tail + 1`.
  - `shortAddress(addr: string): string` — `truncateMiddle(addr, { lead: 6, tail: 4 })`.
  - `shortHash(hash: string): string` — `truncateMiddle(hash, { lead: 8, tail: 6 })`.
  - Uses the ellipsis character `…` (U+2026), not `...`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/web/src/lib/format/__tests__/hash.test.ts
import { describe, it, expect } from "vitest";
import { truncateMiddle, shortAddress, shortHash } from "../hash";

describe("truncateMiddle", () => {
  it("truncates a long value keeping lead and tail", () => {
    expect(truncateMiddle("0x" + "a".repeat(40), { lead: 6, tail: 4 })).toBe(
      "0xaaaa…aaaa",
    );
  });

  it("returns short values unchanged", () => {
    expect(truncateMiddle("0x1234", { lead: 6, tail: 4 })).toBe("0x1234");
  });

  it("returns the value unchanged when exactly at the threshold", () => {
    // length 11 == lead(6) + tail(4) + 1 → no truncation
    expect(truncateMiddle("0x12345678x", { lead: 6, tail: 4 })).toBe(
      "0x12345678x",
    );
  });

  it("defaults to lead 6 / tail 4", () => {
    expect(truncateMiddle("0x" + "b".repeat(40))).toBe("0xbbbb…bbbb");
  });
});

describe("shortAddress / shortHash presets", () => {
  it("shortAddress uses 6/4", () => {
    const addr = "0x1234567890abcdef1234567890abcdef12345678";
    expect(shortAddress(addr)).toBe("0x1234…5678");
  });

  it("shortHash uses 8/6", () => {
    const hash = "0x" + "1234567890".repeat(6) + "abcd";
    expect(shortHash(hash)).toBe("0x123456…7890abcd".slice(0, 8) + "…" + hash.slice(-6));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=packages/web -- format/hash`
Expected: FAIL — cannot resolve `../hash`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/web/src/lib/format/hash.ts

/**
 * Middle-truncate a hex string (address, tx/block hash, storage slot) for
 * display: keep `lead` leading chars and `tail` trailing chars, join with a
 * single ellipsis. Values already short enough are returned unchanged.
 *
 * This is display-only. Never truncate a value you will hand back to the API
 * or use as a key.
 */
export function truncateMiddle(
  value: string,
  { lead = 6, tail = 4 }: { lead?: number; tail?: number } = {},
): string {
  if (!value || value.length <= lead + tail + 1) return value;
  return `${value.slice(0, lead)}…${value.slice(-tail)}`;
}

/** Address preset: `0x1234…5678`. */
export function shortAddress(addr: string): string {
  return truncateMiddle(addr, { lead: 6, tail: 4 });
}

/** Hash preset: a little more context than an address. */
export function shortHash(hash: string): string {
  return truncateMiddle(hash, { lead: 8, tail: 6 });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=packages/web -- format/hash`
Expected: PASS (6 tests).

- [ ] **Step 5: Replace the six inline copies with imports**

Update each call site to import from `../../lib/format/hash` (adjust relative depth per file) and delete the local helper:

- `components/explorer/format.ts:1-4` — replace the body of `truncateAddr` with `return shortAddress(addr);` (keep the export name so its callers are untouched), add `import { shortAddress } from "../../lib/format/hash";`.
- `components/explorer/ExplorerHome.tsx:406` — the local `short` helper → `shortHash`.
- `components/AppShell/buildResults.ts:47` — local `slice(0,8)…slice(-6)` → `shortHash`.
- `components/networkHealth/FeeLadder.tsx:65` — local `slice(0,6)…slice(-4)` → `shortAddress`.
- `components/networkHealth/MinersPanel.tsx:89` — local → `shortAddress`.
- `components/StorageLayoutViewer.tsx:546` — `slice(0,8)…slice(-4)` → `truncateMiddle(slot, { lead: 8, tail: 4 })`.

- [ ] **Step 6: Verify types + existing tests still pass**

Run: `npm run --workspace=packages/web build && npm run test --workspace=packages/web`
Expected: `tsc -b` clean; all tests PASS (the explorer mop-up tests exercising `truncateAddr`/`short` still pass because output is byte-identical).

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/lib/format/hash.ts packages/web/src/lib/format/__tests__/hash.test.ts packages/web/src/components
git commit -m "refactor(web): consolidate hash truncation into lib/format/hash"
```

---

## Task 3: Shell drawer — behavior state + wiring

Splits the overloaded `collapsed` boolean into desktop-collapse (persisted) and mobile-drawer (ephemeral), and converts the sidebar to an off-canvas drawer below `sm:`.

**Files:**
- Create: `packages/web/src/components/AppShell/useMobileNav.ts`
- Test: `packages/web/src/components/AppShell/__tests__/useMobileNav.test.ts`
- Modify: `packages/web/src/components/AppShell.tsx`
- Modify: `packages/web/src/components/AppShell/Sidebar.tsx`
- Modify: `packages/web/src/components/AppShell/TopBar.tsx`

**Interfaces:**
- Consumes: `useIsMobile` (Task 1).
- Produces:
  - `useMobileNav(): { drawerOpen: boolean; openDrawer: () => void; closeDrawer: () => void }` — `drawerOpen` resets to `false` on `location.pathname` change.
  - `Sidebar` gains props: `asDrawer: boolean`, `drawerOpen: boolean`, `onNavigate: () => void`. Existing `collapsed` prop stays (desktop rail width). When `asDrawer` is true the aside renders full-label (never collapsed), `fixed inset-y-0 left-0 z-40 w-72`, translated off-canvas when `!drawerOpen`.
  - `TopBar` gains prop `onOpenDrawer: () => void`; the leftmost button calls `onOpenDrawer` below `sm:` and `onToggleCollapse` at `sm:`+ (two buttons, one `sm:hidden`, one `hidden sm:flex`).

- [ ] **Step 1: Write the failing test for `useMobileNav`**

```ts
// packages/web/src/components/AppShell/__tests__/useMobileNav.test.ts
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { useMobileNav } from "../useMobileNav";

function wrapper({ children }: { children: React.ReactNode }) {
  return <MemoryRouter initialEntries={["/a"]}>{children}</MemoryRouter>;
}

describe("useMobileNav", () => {
  it("starts closed and opens/closes", () => {
    const { result } = renderHook(() => useMobileNav(), { wrapper });
    expect(result.current.drawerOpen).toBe(false);
    act(() => result.current.openDrawer());
    expect(result.current.drawerOpen).toBe(true);
    act(() => result.current.closeDrawer());
    expect(result.current.drawerOpen).toBe(false);
  });

  it("closes automatically when the route changes", () => {
    const { result } = renderHook(
      () => {
        const nav = useMobileNav();
        const navigate = useNavigate();
        return { nav, navigate };
      },
      { wrapper },
    );
    act(() => result.current.nav.openDrawer());
    expect(result.current.nav.drawerOpen).toBe(true);
    act(() => result.current.navigate("/b"));
    expect(result.current.nav.drawerOpen).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=packages/web -- useMobileNav`
Expected: FAIL — cannot resolve `../useMobileNav`.

- [ ] **Step 3: Implement `useMobileNav`**

```ts
// packages/web/src/components/AppShell/useMobileNav.ts
import { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";

/**
 * Owns the mobile drawer's open/closed state. This is deliberately separate
 * from `useSidebarState` (desktop rail collapse): the drawer is ephemeral and
 * resets on navigation, whereas the collapse is persisted and sticky. Merging
 * them into one boolean is what made the sidebar un-responsive to begin with.
 */
export function useMobileNav() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { pathname } = useLocation();

  // Close on route change. Depending on pathname keeps this a pure reaction to
  // navigation, not a click-time side effect threaded through every NavLink.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  return {
    drawerOpen,
    openDrawer: () => setDrawerOpen(true),
    closeDrawer: () => setDrawerOpen(false),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=packages/web -- useMobileNav`
Expected: PASS (2 tests).

- [ ] **Step 5: Convert `Sidebar` to accept drawer mode**

In `Sidebar.tsx`, change the signature and the `<aside>` wrapper. Add props and compute width by class, not inline style:

```tsx
export function Sidebar({
  collapsed,
  asDrawer = false,
  drawerOpen = false,
  onNavigate,
}: {
  collapsed: boolean;
  asDrawer?: boolean;
  drawerOpen?: boolean;
  onNavigate?: () => void;
}) {
  // In drawer mode the aside is always full-label (never the icon rail) and is
  // positioned off-canvas, sliding in when open.
  const effectiveCollapsed = asDrawer ? false : collapsed;

  const wrapperClass = asDrawer
    ? `fixed inset-y-0 left-0 z-40 w-72 flex flex-col theme-secondary-bg bs-r transition-transform duration-150 ${
        drawerOpen ? "translate-x-0" : "-translate-x-full"
      }`
    : "flex flex-col transition-[width] duration-150 shrink-0 theme-secondary-bg bs-r";

  // ...
  return (
    <aside
      className={wrapperClass}
      style={asDrawer ? undefined : { width: collapsed ? 56 : 240 }}
      aria-hidden={asDrawer && !drawerOpen ? true : undefined}
    >
      {/* existing <nav> … but every NavLink gets onClick={onNavigate} so a tap
          in the drawer closes it, and all `collapsed` reads use
          `effectiveCollapsed`. */}
    </aside>
  );
}
```

Concretely inside the file: replace every use of the `collapsed` prop **inside the render** with `effectiveCollapsed`, and add `onClick={onNavigate}` to the `<NavLink>` at the current line ~60. Leave the `useWatchRules`/badge logic untouched.

- [ ] **Step 6: Add the drawer-footer controls to `Sidebar` (mobile only)**

At the bottom of the `<aside>`, after `</nav>`, render the demoted top-bar controls only in drawer mode:

```tsx
{asDrawer && (
  <div className="bs-t-muted p-4 flex flex-col gap-row">
    <RpcSourceChip />
    <WorkspaceSyncStatus />
    <WalletConnectButton />
  </div>
)}
```

Add the three imports at the top of `Sidebar.tsx`:
```tsx
import { RpcSourceChip } from "../settings/RpcSourceChip";
import { WorkspaceSyncStatus } from "../wallet/WorkspaceSyncStatus";
import { WalletConnectButton } from "../wallet/WalletConnectButton";
```

- [ ] **Step 7: Update `TopBar` — hamburger below `sm:`, hide demoted controls**

In `TopBar.tsx`:
- Add `onOpenDrawer: () => void` to the props.
- Replace the single leftmost toggle button with two:

```tsx
{/* Mobile: opens the drawer. */}
<button
  onClick={onOpenDrawer}
  aria-label="Open menu"
  className={`${control} sm:hidden hover:opacity-80 theme-text-secondary bs-r-muted bg-transparent`}
>
  <Icon icon="heroicons:bars-3" className="w-5 h-5" />
</button>
{/* Desktop: collapses/expands the rail. */}
<Tooltip label={toggleTitle} className="hidden sm:flex">
  <button
    onClick={onToggleCollapse}
    aria-label={toggleTitle}
    className={`${control} hover:opacity-80 theme-text-secondary bs-r-muted bg-transparent`}
  >
    <Icon
      icon={collapsed ? "heroicons:bars-3" : "heroicons:chevron-double-left"}
      className="w-5 h-5"
    />
  </button>
</Tooltip>
```

- Wrap the RPC/sync/wallet cluster so it hides below `sm:` (it lives in the drawer footer there):

```tsx
<div className="hidden sm:flex items-center gap-inline px-2 shrink-0">
  <RpcSourceChip />
  <WorkspaceSyncAutoPush />
  <WorkspaceSyncStatus />
  <WalletConnectButton />
</div>
```

(`WorkspaceSyncAutoPush` is a headless auto-push effect with no visible UI; leaving it desktop-only is fine — the drawer footer omits it intentionally.)

- [ ] **Step 8: Wire the drawer in `AppShell`**

Replace the body of `AppShell.tsx` with the drawer-aware version:

```tsx
import { useState, type ReactNode } from "react";
import { useSidebarState } from "./AppShell/useSidebarState";
import { useMobileNav } from "./AppShell/useMobileNav";
import { useCommandPaletteShortcut } from "./AppShell/useCommandPaletteShortcut";
import { useIsMobile } from "../hooks/useMediaQuery";
import { TopBar } from "./AppShell/TopBar";
import { Sidebar } from "./AppShell/Sidebar";
import { CommandPalette } from "./AppShell/CommandPalette";
import type { ApiStatus } from "./AppShell/types";

export default function AppShell({
  apiStatus,
  children,
}: {
  apiStatus: ApiStatus;
  children: ReactNode;
}) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const { collapsed, onToggleCollapse } = useSidebarState();
  const { drawerOpen, openDrawer, closeDrawer } = useMobileNav();
  const isMobile = useIsMobile();

  useCommandPaletteShortcut(setPaletteOpen);

  return (
    <div className="h-full flex flex-col min-h-0 theme-primary-bg">
      <TopBar
        collapsed={collapsed}
        onToggleCollapse={onToggleCollapse}
        onOpenDrawer={openDrawer}
        apiStatus={apiStatus}
        onOpenPalette={() => setPaletteOpen(true)}
      />

      <div className="flex-1 flex min-h-0">
        {isMobile ? (
          <>
            {drawerOpen && (
              <button
                aria-label="Close menu"
                onClick={closeDrawer}
                className="fixed inset-0 z-30 bg-black/50"
              />
            )}
            <Sidebar
              collapsed={collapsed}
              asDrawer
              drawerOpen={drawerOpen}
              onNavigate={closeDrawer}
            />
          </>
        ) : (
          <Sidebar collapsed={collapsed} />
        )}
        <div className="flex-1 overflow-auto min-w-0 p-3 md:p-4">{children}</div>
      </div>

      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}
    </div>
  );
}
```

- [ ] **Step 9: Add Escape-to-close**

The backdrop covers tap-to-close and route-change auto-close. Add keyboard close by extending `useMobileNav` with an Escape listener gated on `drawerOpen`:

```ts
// inside useMobileNav, after the pathname effect:
useEffect(() => {
  if (!drawerOpen) return;
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") setDrawerOpen(false);
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}, [drawerOpen]);
```

- [ ] **Step 10: Document `useSidebarState` as desktop-only**

Append one sentence to the existing block comment in `useSidebarState.ts`: `Mobile uses a separate ephemeral drawer (useMobileNav); this collapse is desktop-only.`

- [ ] **Step 11: Add a shell render test**

```tsx
// packages/web/src/components/AppShell/__tests__/shellDrawer.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AppShell from "../../AppShell";

// Force the mobile branch.
beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: true,
      addEventListener: () => {},
      removeEventListener: () => {},
    })),
  );
});

it("opens the drawer from the hamburger and closes on backdrop tap", () => {
  render(
    <MemoryRouter>
      <AppShell apiStatus="connected">
        <div>content</div>
      </AppShell>
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByLabelText("Open menu"));
  // Backdrop is now present.
  const backdrop = screen.getByLabelText("Close menu");
  expect(backdrop).toBeInTheDocument();
  fireEvent.click(backdrop);
  expect(screen.queryByLabelText("Close menu")).not.toBeInTheDocument();
});
```

- [ ] **Step 12: Run tests + typecheck**

Run: `npm run --workspace=packages/web build && npm run test --workspace=packages/web`
Expected: `tsc -b` clean; all tests PASS.

- [ ] **Step 13: Run the spacing lint**

Run: `npm run lint:spacing --workspace=packages/web`
Expected: no output, exit 0.

- [ ] **Step 14: Commit**

```bash
git add packages/web/src/components/AppShell.tsx packages/web/src/components/AppShell/
git commit -m "feat(web): off-canvas sidebar drawer below sm: with demoted top-bar controls"
```

---

## Task 4: `DataTable` primitive

**Files:**
- Create: `packages/web/src/components/primitives/DataTable.tsx`
- Test: `packages/web/src/components/primitives/__tests__/DataTable.test.tsx`

**Interfaces:**
- Consumes: `useIsMobile` (Task 1).
- Produces:
```ts
export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => React.ReactNode;
  primary?: boolean;      // card heading below sm:; the FIRST primary wins
  hideLabelOnCard?: boolean; // omit the label in card mode (e.g. action cells)
}
export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string | number;
  className?: string;      // applied to the <table> in table mode
  emptyLabel?: string;
}
export function DataTable<T>(props: DataTableProps<T>): React.ReactElement;
```
- Table mode (`sm:`+): a `<table className="w-full text-sm">` with `<thead>` from `column.header` and one `<tr>` per row, cells rendered via `column.cell`. Each `<td>` carries `px-3 py-2`.
- Card mode (below `sm:`): a `<ul>` of cards (`.card p-4 flex flex-col gap-tight`). The primary column renders as the heading row; each non-primary column renders a `flex items-center justify-between gap-inline` row with the `header` as a muted label (`text-xs theme-text-muted`) and the `cell` output right-aligned — unless `hideLabelOnCard`.

- [ ] **Step 1: Write the failing test**

```tsx
// packages/web/src/components/primitives/__tests__/DataTable.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { DataTable, type Column } from "../DataTable";

interface Row { hash: string; block: number; }
const rows: Row[] = [
  { hash: "0xabc", block: 10 },
  { hash: "0xdef", block: 11 },
];
const columns: Column<Row>[] = [
  { key: "hash", header: "Tx Hash", cell: (r) => <span>{r.hash}</span>, primary: true },
  { key: "block", header: "Block", cell: (r) => <span>{r.block}</span> },
];

function mockMobile(isMobile: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: isMobile,
      addEventListener: () => {},
      removeEventListener: () => {},
    })),
  );
}

describe("DataTable", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("renders a real <table> at desktop width", () => {
    mockMobile(false);
    const { container } = render(
      <DataTable columns={columns} rows={rows} rowKey={(r) => r.hash} />,
    );
    expect(container.querySelector("table")).toBeInTheDocument();
    expect(screen.getByText("Tx Hash")).toBeInTheDocument();
    expect(screen.getAllByText(/0x/).length).toBe(2);
  });

  it("renders cards (no <table>) at phone width, with labels for non-primary columns", () => {
    mockMobile(true);
    const { container } = render(
      <DataTable columns={columns} rows={rows} rowKey={(r) => r.hash} />,
    );
    expect(container.querySelector("table")).not.toBeInTheDocument();
    // Header label appears once per card as a field label.
    expect(screen.getAllByText("Block").length).toBe(2);
    expect(screen.getByText("0xabc")).toBeInTheDocument();
  });

  it("renders the empty label when there are no rows", () => {
    mockMobile(false);
    render(
      <DataTable
        columns={columns}
        rows={[]}
        rowKey={(r) => r.hash}
        emptyLabel="No transactions"
      />,
    );
    expect(screen.getByText("No transactions")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=packages/web -- DataTable`
Expected: FAIL — cannot resolve `../DataTable`.

- [ ] **Step 3: Implement `DataTable`**

```tsx
// packages/web/src/components/primitives/DataTable.tsx
import type { ReactNode, ReactElement } from "react";
import { useIsMobile } from "../../hooks/useMediaQuery";

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** Below sm:, the first column flagged primary becomes the card heading. */
  primary?: boolean;
  /** Below sm:, omit the field label for this column (e.g. an action button). */
  hideLabelOnCard?: boolean;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string | number;
  className?: string;
  emptyLabel?: string;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  className,
  emptyLabel = "Nothing to show",
}: DataTableProps<T>): ReactElement {
  const isMobile = useIsMobile();

  if (rows.length === 0) {
    return (
      <div className="px-3 py-6 text-sm text-center theme-text-muted">
        {emptyLabel}
      </div>
    );
  }

  if (!isMobile) {
    return (
      <table className={className ?? "w-full text-sm"}>
        <thead>
          <tr className="theme-secondary-bg">
            {columns.map((c) => (
              <th
                key={c.key}
                className="text-left px-3 py-2.5 text-xs font-medium theme-text-secondary"
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={rowKey(row, i)} className="bs-t-muted hover:opacity-80">
              {columns.map((c) => (
                <td key={c.key} className="px-3 py-2">
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  const primary = columns.find((c) => c.primary) ?? columns[0];
  const rest = columns.filter((c) => c !== primary);

  return (
    <ul className="flex flex-col gap-row">
      {rows.map((row, i) => (
        <li key={rowKey(row, i)} className="card p-4 flex flex-col gap-tight">
          <div className="min-w-0">{primary.cell(row)}</div>
          {rest.map((c) => (
            <div
              key={c.key}
              className="flex items-center justify-between gap-inline min-w-0"
            >
              {!c.hideLabelOnCard && (
                <span className="text-xs shrink-0 theme-text-muted">
                  {c.header}
                </span>
              )}
              <span className="min-w-0 text-right">{c.cell(row)}</span>
            </div>
          ))}
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=packages/web -- DataTable`
Expected: PASS (3 tests).

- [ ] **Step 5: Add to the component gallery (optional smoke surface)**

Skip if time-constrained — not required for the gate. If done, add one `DataTable` demo block to `components/gallery/ComponentGallery.tsx` following the existing demo pattern there.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/components/primitives/DataTable.tsx packages/web/src/components/primitives/__tests__/DataTable.test.tsx
git commit -m "feat(web): DataTable primitive — table above sm:, stacked cards below"
```

---

## Task 5: Migrate the explorer/health tables to `DataTable`

Nine tables. Each is the same mechanical move: extract the existing per-cell JSX into `Column.cell` renderers, pick a `primary` column, delete the hand-rolled `<table>`. Do them **one commit per table** so a reviewer can reject one without the others.

**Files (modify, with the primary column called out):**
- `components/explorer/AddressView/TxTable.tsx` — primary: Tx Hash; action cell (`TxRowActions`) gets `hideLabelOnCard`.
- `components/explorer/AddressView/TokensTab.tsx` — primary: token name/symbol.
- `components/explorer/BlockView.tsx` — primary: Tx Hash.
- `components/explorer/TxDetail/TokenTransfersSection.tsx` — primary: token.
- `components/explorer/TxDetail/InternalTxSection.tsx` — primary: To/type.
- `components/explorer/TxDetail/DecodedInputSection.tsx` — primary: param name.
- `components/networkHealth/BlockTable.tsx` — primary: block number.
- `components/networkHealth/MinersPanel.tsx` — primary: miner address.
- `components/workspace/PortfolioPanel.tsx` — primary: token.

**Interfaces:**
- Consumes: `DataTable`, `Column` (Task 4); `shortAddress`/`shortHash` (Task 2).

**Worked example — `TxTable.tsx` (the 9-column worst case).** Replace the whole file body with a columns array + `DataTable`. The existing `LinkButton`, `DirectionBadge`, `TxGasInfo`, `TxRowActions`, `formatPLS`, `formatRelativeTimestamp`, `truncateAddr` usages move verbatim into `cell` closures:

```tsx
import type { AddressTransaction } from "../../../api/explorer";
import { formatPLS, truncateAddr } from "../format";
import { useActiveChainId } from "../../../lib/activeChain";
import { chainSymbol } from "../../../lib/chains";
import { formatRelativeTimestamp } from "./formatRelative";
import type { AddressNavTarget } from "./TransactionsTab";
import TxRowActions from "../TxRowActions";
import { ExplorerLink } from "../ExplorerLink";
import { TxGasInfo } from "../TxGasInfo";
import { Tooltip } from "../../primitives/Tooltip";
import { DataTable, type Column } from "../../primitives/DataTable";

interface Props {
  txs: AddressTransaction[];
  ownerAddress: string;
  onNavigate: (target: AddressNavTarget) => void;
}

export function TxTable({ txs, ownerAddress, onNavigate }: Props) {
  const symbol = chainSymbol(useActiveChainId());

  const columns: Column<AddressTransaction>[] = [
    {
      key: "hash",
      header: "Tx Hash",
      primary: true,
      cell: (tx) => (
        <LinkButton target={{ type: "tx", value: tx.hash }} onNavigate={onNavigate} title={tx.hash}>
          {truncateAddr(tx.hash)}
        </LinkButton>
      ),
    },
    {
      key: "block",
      header: "Block",
      cell: (tx) => (
        <LinkButton target={{ type: "block", value: tx.blockNumber }} onNavigate={onNavigate}>
          {Number(tx.blockNumber).toLocaleString()}
        </LinkButton>
      ),
    },
    {
      key: "age",
      header: "Age",
      cell: (tx) => (
        <span className="text-xs whitespace-nowrap theme-text-secondary">
          {formatRelativeTimestamp(tx.timeStamp)}
        </span>
      ),
    },
    {
      key: "from",
      header: "From",
      cell: (tx) => (
        <LinkButton target={{ type: "address", value: tx.from }} onNavigate={onNavigate} title={tx.from}>
          {truncateAddr(tx.from)}
        </LinkButton>
      ),
    },
    {
      key: "to",
      header: "To",
      cell: (tx) => <ToCell tx={tx} ownerAddress={ownerAddress} onNavigate={onNavigate} />,
    },
    {
      key: "value",
      header: "Value",
      cell: (tx) => (
        <span className="font-mono text-xs whitespace-nowrap theme-text">
          {formatPLS(tx.valuePLS, symbol)}
        </span>
      ),
    },
    {
      key: "gas",
      header: "Gas / Type",
      cell: (tx) => (
        <TxGasInfo
          type={tx.type}
          gasPrice={tx.gasPrice}
          maxFeePerGas={tx.maxFeePerGas}
          maxPriorityFeePerGas={tx.maxPriorityFeePerGas}
        />
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (tx) => (
        <Tooltip label={tx.isError === "0" ? "Success" : "Error"}>
          <span
            className="inline-block w-2 h-2 rounded-full"
            style={{ backgroundColor: tx.isError === "0" ? "var(--color-success)" : "var(--color-danger)" }}
          />
        </Tooltip>
      ),
    },
    {
      key: "actions",
      header: "",
      hideLabelOnCard: true,
      cell: (tx) => {
        const isCreation = !tx.to || tx.to === "0x";
        return <TxRowActions hash={tx.hash} contractAddress={isCreation ? null : tx.to} compact />;
      },
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={txs}
      rowKey={(tx, i) => `${tx.hash}-${i}`}
      emptyLabel="No transactions"
    />
  );
}

// LinkButton, DirectionBadge unchanged from the original file; ToCell wraps the
// contract-creation / IN-OUT badge logic that used to live inline in the To <td>.
```

Keep `LinkButton` and `DirectionBadge` as they are; extract the old "To" `<td>` inner logic into a small `ToCell` component in the same file.

- [ ] **Step 1: Migrate `TxTable.tsx`** per the worked example above.

- [ ] **Step 2: Verify the address view still renders**

Run: `npm run test --workspace=packages/web -- explorer`
Expected: PASS. The `explorerMopUp` / address tests assert on rendered hashes and the Create/IN-OUT rows; output is unchanged at desktop width (tests run in jsdom where `matchMedia` is mocked/absent → `useIsMobile` returns `false` → table mode).

- [ ] **Step 3: Commit `TxTable`**

```bash
git add packages/web/src/components/explorer/AddressView/TxTable.tsx
git commit -m "refactor(web): TxTable via DataTable (stacked cards below sm:)"
```

- [ ] **Step 4: Migrate the remaining eight tables**, one commit each, following the same pattern. For each: read the existing `<table>`, move each `<td>` body into a `Column.cell`, choose the `primary` column named in the Files list, set a sensible `emptyLabel`, run the nearest test file, commit.

Per-table test commands:
- `BlockView.tsx` → `npm run test --workspace=packages/web -- BlockView explorerMopUp`
- `TokensTab.tsx` → `npm run test --workspace=packages/web -- explorer`
- `TxDetail/*` → `npm run test --workspace=packages/web -- TxDetail explorer`
- `networkHealth/*` → `npm run test --workspace=packages/web -- networkHealth`
- `PortfolioPanel.tsx` → `npm run test --workspace=packages/web -- Portfolio workspace`

If a given table has no existing test, run the full suite (`npm run test --workspace=packages/web`) before committing.

- [ ] **Step 5: Full typecheck + test + spacing lint after all nine**

Run: `npm run --workspace=packages/web build && npm run test --workspace=packages/web && npm run lint:spacing --workspace=packages/web`
Expected: all green.

---

## Task 6: Global no-overflow baseline

Applies to every route, including out-of-scope ones. Pure Tailwind edits — no new tests; the Playwright gate (Task 8) proves them.

**Files (modify):**

- [ ] **Step 1: Unprefixed 3-col grids → `grid-cols-1 sm:grid-cols-3`**
  - `components/actions/ActionsDashboard.tsx:136`
  - `components/monitoring/AlertDashboard.tsx:169`
  - `components/BundleSimulator/TxCard.tsx:93`

- [ ] **Step 2: Unprefixed 2-col grids → `grid-cols-1 sm:grid-cols-2`**
  - `components/StateOverrides.tsx:133`
  - `components/SimulationForm.tsx:189`
  - `components/BundleSimulator/TxCard.tsx:48`
  - `components/monitoring/AlertBuilder/ConditionsCard.tsx:116`
  - `components/monitoring/AlertBuilder/BasicInfoCard.tsx:52`
  - `components/workspace/previews/PreviewShell.tsx:36`

- [ ] **Step 3: Inline grid templates → responsive classes**
  - `components/ContractDiff/InputCard.tsx:76` — replace `style={{ gridTemplateColumns: "1fr 1fr" }}` with `className="... grid-cols-1 sm:grid-cols-2"` (keep the rest of the className).
  - `components/networkHealth/FeeLadder.tsx:363` — `"auto 1fr"` → keep as-is if it is a label/value pair that fits (verify at 375 in Task 9); otherwise `grid-cols-[auto_1fr]`. This one is a two-column micro-layout, not full-width; leave unless the gate flags it.

- [ ] **Step 4: Clamp popovers to the viewport**
  - `components/settings/RpcSourceChip.tsx:71` — `w-[320px]` → `w-[min(320px,calc(100vw-1rem))]`
  - `components/ChainSelector.tsx:81` — `min-w-[200px]` → `w-[min(200px,calc(100vw-1rem))]`; if it is `left-0` absolute, add `max-sm:left-0 max-sm:right-0` so it can't overflow the right edge.
  - `components/gallery/ComponentGallery.tsx:127` — `w-[300px]` → `w-full max-w-[300px]`

- [ ] **Step 5: Full-width form fields / filter chips below `sm:`**
  - `components/mempool/MempoolView.tsx:328` — `flex-1 min-w-[180px]` → `w-full sm:flex-1 sm:min-w-[180px]`
  - `components/workspace/watcher/WatchRuleForm.tsx:225` — `min-w-[12rem]` → `w-full sm:min-w-[12rem]`

- [ ] **Step 6: Contained-scroll wrapper on the non-migrated tables**

For each of these, ensure the `<table>` is wrapped in `<div className="overflow-x-auto">` (several already are — only add where missing): `StorageLayoutViewer.tsx`, `ForkSimulator/DiffTables.tsx`, `monitoring/AlertHistory.tsx`, `actions/ActionLogs.tsx`, `debugger/GasProfiler/GasTable.tsx`, `debugger/GasProfiler/TopExpensiveOps.tsx`, `StateDiffPanel.tsx`, `drafts/WorkspaceDraft.tsx`. (Grep each file for `overflow-x-auto` first; skip if present.)

- [ ] **Step 7: Typecheck + test + spacing lint**

Run: `npm run --workspace=packages/web build && npm run test --workspace=packages/web && npm run lint:spacing --workspace=packages/web`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add packages/web/src
git commit -m "fix(web): global no-overflow baseline — responsive grids, clamped popovers, contained-scroll tables"
```

---

## Task 7: `/debugger` navigability workarounds

Degrade-only, but navigable. Keeps `lg:` (1024px) as the documented exception. Extends the existing `hidden lg:flex` call-tree fallback pattern already in `StepDebugger.tsx`.

**Files (modify):**
- `components/debugger/StepDebugger/SourceOpcodeSplit.tsx`
- `components/debugger/StepDebugger.tsx`
- `components/debugger/StepDebugger/StoragePanel.tsx` / `StackPanel.tsx` / `MemoryPanel.tsx` (contained scroll)

- [ ] **Step 1: Source | Opcodes segmented tabs below `lg:`**

In `SourceOpcodeSplit.tsx`, add local tab state and render only one pane below `lg:` while keeping the side-by-side split at `lg:`+:

```tsx
const [mobilePane, setMobilePane] = useState<"source" | "opcodes">("source");
```

Wrap the two existing pane `<div>`s so that below `lg:` visibility is driven by `mobilePane` (e.g. `className={mobilePane === "source" ? "flex-1 min-w-0" : "hidden"} lg:flex ...`), and add a segmented control that is `lg:hidden`:

```tsx
<div className="flex lg:hidden bs-b-muted">
  <button
    onClick={() => setMobilePane("source")}
    className={`flex-1 px-3 py-2 text-xs ${mobilePane === "source" ? "theme-accent-bg theme-accent" : "theme-text-secondary"}`}
  >
    Source
  </button>
  <button
    onClick={() => setMobilePane("opcodes")}
    className={`flex-1 px-3 py-2 text-xs ${mobilePane === "opcodes" ? "theme-accent-bg theme-accent" : "theme-text-secondary"}`}
  >
    Opcodes
  </button>
</div>
```

- [ ] **Step 2: Relax the desktop-only height minimums below `lg:`**
  - `SourceOpcodeSplit.tsx:86` — `min-h-[480px]` → `lg:min-h-[480px]`; and the parent `h-[calc(100vh-260px)]` → `lg:h-[calc(100vh-260px)]` so the stacked-tab layout isn't force-shrunk.
  - `StepDebugger.tsx:869` — inline `style={{ minHeight: "500px" }}` → `className="lg:min-h-[500px]"` (drop the inline style).

- [ ] **Step 3: Clamp `ResizablePanel` width**

In `StepDebugger/ResizablePanel.tsx`, the drag handle is already `hidden lg:flex` at the call sites; ensure the panel wrapper's inline `style={{ width }}` cannot exceed the viewport by adding `maxWidth: "100%"` to the style object. (Below `lg:` the call-tree usage is already replaced by `CollapsiblePanel`, so this only guards the source/opcode usage.)

- [ ] **Step 4: Contained scroll on Storage/Stack/Memory word rows**

These panels stack fine but render 64-char hex words that overflow. In `StoragePanel.tsx`, `StackPanel.tsx`, `MemoryPanel.tsx`, add `break-all` (or wrap the scroll body in `overflow-x-auto`) on the element rendering the hex word. Grep each for the `font-mono` word cell and apply `break-all`.

- [ ] **Step 5: Typecheck + test + spacing lint**

Run: `npm run --workspace=packages/web build && npm run test --workspace=packages/web && npm run lint:spacing --workspace=packages/web`
Expected: all green (debugger has existing tests under `__tests__`; confirm they pass).

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/components/debugger
git commit -m "feat(web): make /debugger navigable below lg: (segmented panes, contained scroll)"
```

---

## Task 8: Playwright 375px gate

The permanent CI answer to "did we regress mobile". This is the highest-leverage artifact — it guards the ~300 out-of-scope files against future regressions.

**Files:**
- Create: `packages/web/playwright.config.ts`
- Create: `packages/web/e2e/viewport.spec.ts`
- Modify: `packages/web/package.json` (add devDep + scripts)

- [ ] **Step 1: Install Playwright as a web devDependency**

```bash
npm install --workspace=packages/web --save-dev @playwright/test
npx --workspace=packages/web playwright install chromium
```

- [ ] **Step 2: Add scripts to `packages/web/package.json`**

Add to `"scripts"`:
```json
"test:e2e": "playwright test",
"test:e2e:ui": "playwright test --ui"
```

- [ ] **Step 3: Write `playwright.config.ts`**

```ts
// packages/web/playwright.config.ts
import { defineConfig, devices } from "@playwright/test";

/**
 * Viewport-regression gate. Boots the Vite dev server and drives every route
 * at iPhone-SE width, asserting no page-level horizontal scroll. The API is
 * NOT required — routes must render their shell/empty state without a backend,
 * which is what we're measuring (layout, not data).
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  use: {
    baseURL: "http://localhost:11800",
    ...devices["iPhone SE"], // 375×667, mobile viewport
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:11800",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
```

- [ ] **Step 4: Write the gate spec**

```ts
// packages/web/e2e/viewport.spec.ts
import { test, expect } from "@playwright/test";

/** Every top-level route. Parameterized paths use representative values. */
const ROUTES = [
  "/",
  "/simulate",
  "/fork",
  "/build",
  "/bundle",
  "/monitoring",
  "/testnets",
  "/explorer",
  "/mempool",
  "/network-health",
  "/debugger",
  "/actions",
  "/storage",
  "/verify",
  "/diff",
  "/settings",
  "/ui",
  "/drafts",
  "/workspace",
];

for (const path of ROUTES) {
  test(`no horizontal overflow at 375px: ${path}`, async ({ page }) => {
    await page.goto(path, { waitUntil: "networkidle" });
    // Give lazy route chunks a beat to mount.
    await page.waitForTimeout(300);
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(
      overflow.scrollWidth,
      `${document.location?.pathname ?? ""} overflows: scrollWidth ${overflow.scrollWidth} > 375`,
    ).toBeLessThanOrEqual(375);
  });
}
```

- [ ] **Step 5: Run the gate**

Run: `npm run test:e2e --workspace=packages/web`
Expected: all route tests PASS. If a route fails, note its `scrollWidth`, find the offending element (`document.querySelectorAll` with a width probe, or Playwright's trace viewer), and fix it under the relevant task's approach (grid → §6, table → §5, popover → §6). Re-run until green.

- [ ] **Step 6: Commit**

```bash
git add packages/web/playwright.config.ts packages/web/e2e/ packages/web/package.json packages/web/package-lock.json ../../package-lock.json
git commit -m "test(web): Playwright gate — assert no horizontal overflow at 375px across all routes"
```

---

## Task 9: Cold-server visual verification of the explorer-first routes

vitest and Playwright confirm *no overflow*; this confirms the explorer routes are actually *usable*, not merely non-broken. Must run against a cold Vite server — HMR can serve stale transforms.

- [ ] **Step 1: Cold-restart Vite**

```bash
rm -rf packages/web/node_modules/.vite
npm run dev:web
```

- [ ] **Step 2: Verify each explorer-first route at 375px**

Using the Playwright MCP browser (or Chrome devtools device mode at 375×667), visit and eyeball:
- `/` — Landing: hero and cards stack, no clipped text.
- `/explorer` — search + home render full-width.
- `/address/<a real address>` — the **TxTable renders as stacked cards**; hashes middle-truncated; From/To/Value/Status labels present; no sideways scroll.
- `/tx/<a real tx hash>` — decoded input, token transfers, internal txs all render as cards.
- `/block/<a real block>` — block tx list as cards.
- `/token/<a real token>` — token page renders.
- `/network-health` — summary cards + block/miners tables as cards.
- Drawer: hamburger opens the sidebar over content; backdrop tap, a nav tap, and Escape each close it; wallet/sync/RPC controls appear in the drawer footer.

Use representative live PulseChain values (chain 369) for the parameterized routes.

- [ ] **Step 3: Fix anything the eyeball catches**, committing per fix with a `fix(web): …` message describing the specific route/element.

- [ ] **Step 4: Final full green**

Run: `npm run --workspace=packages/web build && npm run test --workspace=packages/web && npm run lint:spacing --workspace=packages/web && npm run test:e2e --workspace=packages/web`
Expected: all green.

---

## Self-Review

**Spec coverage:**
- §1 Shell drawer + TopBar demotion → Task 3. ✓
- §2 DataTable + truncation → Tasks 4, 2. ✓ (nine converted tables → Task 5)
- §3 Global baseline (grids, popovers, flex, contained scroll, touch targets) → Task 6. Touch-target 44px: partially covered — the drawer nav rows render full-label (comfortable tap height); explicit 44px min on desktop-rail rows is desktop-only and out of the 375 concern. Noted, not a separate task.
- §4 Landing/Explorer home → Task 9 visual pass (already responsive; gate + eyeball). ✓
- §5 Debugger → Task 7. ✓
- §6 Verification (Playwright + cold visual) → Tasks 8, 9. ✓

**Placeholder scan:** No TBD/TODO. Every code step shows code. Table-migration steps 5.4 reference the worked 5.1 example rather than repeating nine near-identical blocks — acceptable because the pattern is fully shown once and each target's primary column is named explicitly.

**Type consistency:** `useIsMobile` (Task 1) consumed by `DataTable` (4) and `AppShell` (3). `Column<T>`/`DataTableProps<T>` names stable across Tasks 4–5. `shortAddress`/`shortHash`/`truncateMiddle` stable across Tasks 2, 5. `useMobileNav` return shape (`drawerOpen`/`openDrawer`/`closeDrawer`) stable across Task 3 steps.

**Known soft spot:** `FeeLadder.tsx:363` (§6 step 3) is left conditional on the gate rather than pre-decided — flagged inline, resolved by Task 8's measurement.
