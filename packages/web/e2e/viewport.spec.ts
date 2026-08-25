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
 * Routes measured to overflow their own content pane at 375px, as of the
 * investigation that added the pane-level assertion below (see the fix's
 * report for the full 19-route table, including the routes that pass):
 *
 *   route             paneScrollWidth  paneClientWidth  overflow
 *   /                             412              375       37px
 *   /explorer                     577              375      202px   FIXED
 *   /network-health               580              375      205px
 *   /ui                           598              375      223px   FIXED
 *
 * Each is wrapped in `test.fail()` so the suite stays green on the truth
 * (these routes ARE broken today) while still alerting the next person the
 * moment a fix lands: `test.fail()` runs the test as normal and only turns
 * the suite red if the test starts PASSING, which is the signal that the
 * route got fixed and the wrapper should come off. Do not use `test.skip()`
 * here — a skipped test stops running and stops watching for the fix.
 */
// /explorer and /ui both came off this list the same day they went on.
// /explorer had two causes: the gas strip was a no-wrap flex row of shrink-0
// children, and the tx hash could not wrap because EntityRow's main line sets
// nowrap. /ui is the component showcase, so fixing EntityRow's right column
// and the gas strip fixed it too — which is exactly the signal test.fail()
// exists to give: it went red for PASSING. / and /network-health remain.
const KNOWN_FAILING = new Set(["/", "/network-health"]);

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
