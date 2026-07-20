# Mobile responsiveness — collapsing Explore to phone width

**Date:** 2026-07-20
**Status:** Approved design, pending implementation plan

## Problem

Explore is desktop-only in practice. Of 327 `.tsx` files in `packages/web/src`,
25 carry any responsive prefix at all. The remaining ~300 render their desktop
layout verbatim at every width.

The compounding offender is the sidebar. `AppShell/Sidebar.tsx` sets its width
via an inline `style={{ width: collapsed ? 56 : 240 }}` — an inline style no
media query can override — and `useSidebarState.ts` defaults to expanded with no
viewport check. A first-time phone visitor therefore gets a 240px sidebar
against a 375px viewport, leaving ~126px of content width on **every** route.

## Target

**375px is the hard floor** (iPhone SE / mini). Narrower widths are a bonus, not
a requirement. Nothing may cause page-level horizontal scrolling at 375px.

## Scope

**Explorer-first.** Full mobile treatment for the read/browse surfaces people
actually reach from a shared link:

`/` (Landing), `/explorer`, `/tx/:hash`, `/address/:address`, `/block/:id`,
`/token/:address`, `/network-health`

Everything else — `/debugger`, `/fork`, `/bundle`, `/build`, `/storage`,
`/diff`, `/verify`, `/monitoring`, `/actions`, `/testnets`, `/workspace`,
`/mempool`, `/settings` — receives the **global baseline** (§3) only: it must
not break, but it is not redesigned. `/debugger` additionally gets the
navigability workarounds in §5.

## Breakpoints

**`sm:` (640px) is the single global breakpoint.** Below it is "phone". 375 and
639 both land in the base branch, so mobile is one thing to reason about, not a
matrix.

**One documented exception: `/debugger` keeps `lg:` (1024px)** for pane
splitting. A source/opcode split genuinely needs ~1024px of width; flipping it
at 640 would produce two unusable columns. This is deliberate, not drift. Do not
"harmonize" it to `sm:`.

## 1. Shell — CSS owns layout, JS owns behavior

The sidebar becomes an off-canvas drawer below `sm:`.

**Layout moves to Tailwind classes.** Replace the inline `style={{ width }}`
with `w-14` / `w-60` so breakpoints can reach it. Below `sm:` the sidebar leaves
the flex row entirely — `max-sm:fixed max-sm:inset-y-0 max-sm:left-0
max-sm:z-40` plus a translate for the open/closed transition — so the content
pane gets the full 375px.

**Behavior gets one `useMediaQuery` hook** (new: `hooks/useMediaQuery.ts`,
`matchMedia`-backed, subscribe/unsubscribe, returns boolean).

This is necessary because `collapsed` and `drawerOpen` are **different states**
sharing one boolean today:

| State | Scope | Persisted | Reset on navigate |
|---|---|---|---|
| `collapsed` | desktop rail width | yes (`localStorage`) | no |
| `drawerOpen` | mobile overlay | **no** | **yes** |

They must not be merged. The hamburger in `TopBar` toggles whichever is live for
the current viewport.

Drawer requirements:

- Backdrop overlay; tapping it closes the drawer
- Closes on route change and on `Escape`
- `aria-modal`, focus moves into the drawer on open and returns to the hamburger
  on close
- Body scroll lock while open
- All 16 nav items and 4 groups from `lib/navGroups.ts` render unchanged — one
  nav source of truth, no primary/secondary split

Derive state in render; do not use refs to carry derived state across renders.

### TopBar demotion

`TopBar` currently carries back/forward, brand, ⌘K, wallet connect, sync status,
RPC source chip, and a status dot in one row. That does not fit 375px.

Below `sm:` the top bar keeps: **hamburger · brand mark · ⌘K · status dot.**

Wallet connect, workspace sync status, and the RPC source chip move into a
**drawer footer section**, visible when the drawer is open.

## 2. `DataTable` primitive — one column definition, two presentations

New `components/primitives/DataTable.tsx`:

```ts
interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  primary?: boolean;  // becomes the card heading below sm:
}
```

- At `sm:` and above: renders the semantic `<table>` that exists today.
- Below `sm:`: renders one stacked card per row. The `primary` column is the
  card heading; remaining columns become label/value pairs — **reusing the same
  `cell` renderers**.

Callers declare columns once. There is no second render path to drift out of
sync.

**Converted (explorer-first scope):**

- `explorer/AddressView/TxTable.tsx` — 9 columns, the worst offender
- `explorer/AddressView/TokensTab.tsx`
- `explorer/BlockView.tsx`
- `explorer/TxDetail/TokenTransfersSection.tsx`
- `explorer/TxDetail/InternalTxSection.tsx`
- `explorer/TxDetail/DecodedInputSection.tsx`
- `networkHealth/BlockTable.tsx`
- `networkHealth/MinersPanel.tsx`
- `workspace/PortfolioPanel.tsx`

**Not converted** — contained-scroll wrapper only (§3): `StorageLayoutViewer`,
`ForkSimulator/DiffTables`, `monitoring/AlertHistory`, `actions/ActionLogs`,
`debugger/GasProfiler/GasTable`, `debugger/GasProfiler/TopExpensiveOps`,
`StateDiffPanel`, `drafts/WorkspaceDraft`, `mempool/MempoolView`.

### Truncation consolidation

New `lib/format/hash.ts` exporting `truncateMiddle(value, { lead, tail })` plus
`shortHash` / `shortAddress` presets.

This is load-bearing for the cards, not incidental cleanup: a 66-character
`font-mono` tx hash under `whitespace-nowrap` is ~450px on its own — wider than
the entire target viewport. 18 files apply `whitespace-nowrap` to row cells.

There are currently six divergent inline copies to replace:

| File | Current form |
|---|---|
| `explorer/format.ts:3` | `slice(0,6)...slice(-4)` |
| `explorer/ExplorerHome.tsx:406` | `slice(0,8)…slice(-6)` |
| `AppShell/buildResults.ts:47` | `slice(0,8)…slice(-6)` |
| `networkHealth/FeeLadder.tsx:65` | `slice(0,6)…slice(-4)` |
| `networkHealth/MinersPanel.tsx:89` | `slice(0,6)…slice(-4)` |
| `StorageLayoutViewer.tsx:546` | `slice(0,8)…slice(-4)` |

## 3. Global no-overflow baseline

Applies to every route, including out-of-scope ones.

**Flex overflow.** Audit flex children for missing `min-w-0` — the standard
cause of a flex child refusing to shrink below its content width.

**Unprefixed grids** → `grid-cols-1 sm:grid-cols-N`:

- `grid-cols-3`: `actions/ActionsDashboard.tsx:136`,
  `monitoring/AlertDashboard.tsx:169`, `BundleSimulator/TxCard.tsx:93`
- `grid-cols-2`: `StateOverrides.tsx:133`, `SimulationForm.tsx:189`,
  `BundleSimulator/TxCard.tsx:48`, `monitoring/AlertBuilder/ConditionsCard.tsx:116`,
  `monitoring/AlertBuilder/BasicInfoCard.tsx:52`, `workspace/previews/PreviewShell.tsx:36`

**Inline grid templates** → Tailwind classes, so breakpoints reach them:
`ContractDiff/InputCard.tsx:76` (`"1fr 1fr"`), `networkHealth/FeeLadder.tsx:363`
(`"auto 1fr"`).

**Popovers clamped to the viewport** — currently they can render off-screen:

- `settings/RpcSourceChip.tsx:71` — `w-[320px]` → `w-[min(320px,calc(100vw-1rem))]`
- `ChainSelector.tsx:81` — `min-w-[200px]`, `left-0` → clamp and reposition
- `mempool/MempoolView.tsx:328` — `min-w-[180px]` filter chips → full width below `sm:`
- `workspace/watcher/WatchRuleForm.tsx:225` — `min-w-[12rem]` → full width below `sm:`
- `gallery/ComponentGallery.tsx:127` — `w-[300px]` → `max-w-full`

**Tables not converted in §2** get a shared contained-scroll wrapper, so a wide
table scrolls inside itself and never scrolls the page.

**Touch targets** reach 44×44 minimum below `sm:`. Sidebar nav rows are
currently 40×36 (`Sidebar.tsx`, the collapsed-state inline style).

## 4. Landing and Explorer home

Already partially adapted (`Landing.tsx`, `explorer/ExplorerHome.tsx` both use
responsive prefixes). Verify against the 375px gate and fix what the gate
catches; no redesign anticipated.

## 5. `/debugger` — degrade, but navigable

Out of scope for redesign. The goal is that it can be *navigated* on a phone,
not that it is pleasant. The pattern already exists in the file:
`StepDebugger.tsx:873-883` hides the drag-resize call tree below `lg:` and swaps
in a `CollapsiblePanel`. Extend that convention.

**`StepDebugger/SourceOpcodeSplit.tsx`** — below `lg:`, replace the stacked
panes with a segmented **Source | Opcodes** tab so each gets full width and
height. Today both stack at `min-h-[240px]` inside a `min-h-[480px]` parent,
producing two cramped panes with no way to dismiss either — the collapse rail is
`hidden lg:flex`, so the escape hatch is desktop-only.

**Height constraints** — drop below `lg:`: `min-h-[480px]`
(`SourceOpcodeSplit.tsx:86`) and the inline `minHeight: "500px"`
(`StepDebugger.tsx:869`).

**`ResizablePanel`** — drag handles hidden below `lg:` (call-tree usage already
is); clamp its inline `style={{ width }}` so it cannot exceed the viewport.

**Storage / Stack / Memory panels** — these already stack acceptably; they are
*not* a side column and do **not** need an accordion. Their actual defect is
that 32-byte words render as 64-character hex strings that overflow
horizontally. Give them contained scroll or `break-all`.

## 6. Verification

`vitest` + `jsdom` cannot measure layout, so the gate requires a real browser.

**Add Playwright as a devDependency of `packages/web`**, with
`e2e/viewport.spec.ts`:

> For each of the ~20 routes, at viewport 375×667, assert
> `document.documentElement.scrollWidth <= 375`.

This converts "did we regress mobile" from a manual re-check into a permanent CI
answer, and it is the single highest-leverage artifact in this spec — it guards
the ~300 files that are out of scope today and will be touched later.

**Manual visual pass** on the explorer-first routes at 375px, against a **cold
Vite server** — restart Vite and clear `.vite` before trusting any browser
check, since HMR can serve stale transforms.

## Out of scope

- Landscape-orientation-specific layouts
- Tablet-specific (`md:`) tuning beyond what falls out of `sm:`
- Redesigning any out-of-scope route's information architecture
- PWA / installability / offline
- Touch gesture affordances beyond tap target sizing (no swipe-to-navigate)

## Risks

- **`DataTable` retrofit is the bulk of the work.** Nine call sites, each with
  bespoke cell rendering. Mitigation: the `cell` renderers port over unchanged;
  only the surrounding structure moves.
- **The `sm:`/`lg:` split invites future "cleanup"** that would break the
  debugger. Mitigation: documented above and to be commented at the call site.
- **The 375px gate will fail on out-of-scope routes initially.** The baseline in
  §3 exists specifically to get them passing; if any route cannot be made to
  pass cheaply, that is a signal to widen scope deliberately rather than to
  weaken the assertion.
