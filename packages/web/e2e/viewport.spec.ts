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

/**
 * Routes that once overflowed their own content pane at 375px. All four are
 * fixed, so the set below is empty — keep it that way.
 *
 *   route             paneScrollWidth  paneClientWidth  overflow
 *   /                             412              375       37px   FIXED
 *   /explorer                     577              375      202px   FIXED
 *   /network-health               580              375      205px   FIXED
 *   /ui                           598              375      223px   FIXED
 *
 * A route listed here is wrapped in `test.fail()` so the suite stays green on
 * the truth (the route IS broken today) while still alerting the next person
 * the moment a fix lands: `test.fail()` runs the test as normal and only turns
 * the suite red if the test starts PASSING, which is the signal that the
 * route got fixed and the wrapper should come off. Do not use `test.skip()`
 * here — a skipped test stops running and stops watching for the fix.
 *
 * The four causes, so nobody re-derives them:
 *   /explorer        the gas strip was a no-wrap flex row of shrink-0 children,
 *                    and the tx hash could not wrap because EntityRow's main
 *                    line sets nowrap.
 *   /ui              the component showcase — the two /explorer fixes fixed it.
 *   /                Landing's search box is a `flex-1` item holding an
 *                    `<input>`. A flex item defaults to `min-width: auto` and
 *                    an input carries a browser intrinsic width, so the box
 *                    refused to shrink and shoved the Go button off screen.
 *                    `min-w-0` on the box and the input let it act.
 *   /network-health  InfoTip's popover was `position: absolute; left: 0;
 *                    width: 18rem`. An absolutely-positioned box still grows
 *                    its scroll container, so a trigger near the right edge
 *                    threw 288px of bubble past it. It now renders through a
 *                    portal at `position: fixed`, clamped on screen.
 */
const KNOWN_FAILING = new Set<string>([]);

for (const path of ROUTES) {
  const t = KNOWN_FAILING.has(path) ? test.fail : test;
  t(`no horizontal overflow at 375px: ${path}`, async ({ page }) => {
    await page.goto(path, { waitUntil: "networkidle" });
    // Give lazy route chunks a beat to mount.
    await page.waitForTimeout(300);
    const overflow = await page.evaluate(() => {
      const content = document.querySelector('[data-testid="app-content"]');
      return {
        docScrollWidth: document.documentElement.scrollWidth,
        docClientWidth: document.documentElement.clientWidth,
        paneScrollWidth: content?.scrollWidth ?? null,
        paneClientWidth: content?.clientWidth ?? null,
      };
    });
    expect(
      overflow.docScrollWidth,
      `${path} overflows the page shell (chrome-level regression): scrollWidth ${overflow.docScrollWidth} > 375`,
    ).toBeLessThanOrEqual(375);
    // The teeth of this spec. `AppShell`'s content pane
    // (`packages/web/src/components/AppShell.tsx`, `data-testid="app-content"`)
    // is a `flex-1` item with `overflow-auto` + `min-w-0` — a deliberate
    // horizontal-scroll CONTAINMENT boundary. Content that overflows inside
    // it grows the pane's own scrollWidth and becomes internally scrollable;
    // `document.documentElement.scrollWidth` never moves off 375. That means
    // the assertion above can only ever catch chrome (TopBar/Sidebar)
    // escaping normal flow — it structurally cannot see a content overflow
    // inside the routed view, which is the bug class this spec exists to
    // catch. See `viewport-params.spec.ts`'s file-level comment for the full
    // reasoning (it hit the same containment boundary building a sibling
    // spec for the parameterized routes, and cites a concrete rendered-audit
    // measurement of /explorer at scrollWidth 576 vs. clientWidth 365 — a
    // 211px overflow — while the document-level assertion alone passed).
    expect(
      overflow.paneScrollWidth,
      `${path} overflows its own content pane (internal horizontal scroll): ` +
        `scrollWidth ${overflow.paneScrollWidth} > clientWidth ${overflow.paneClientWidth}`,
    ).toBeLessThanOrEqual(overflow.paneClientWidth ?? 0);
  });
}
