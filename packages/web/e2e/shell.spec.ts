import { test, expect } from "@playwright/test";

/**
 * Regression for the responsive-hidden-Tooltip bug: `TopBar.tsx`'s desktop
 * "collapse sidebar" control is wrapped `<Tooltip className="hidden sm:flex">`.
 * The Tooltip primitive (`primitives/Tooltip.tsx`) always renders its own
 * wrapper `inline-flex ${className}`, so the DOM class list became
 * `"inline-flex hidden sm:flex"` — and in this Tailwind v4 build's generated
 * CSS layer order, `inline-flex` wins over `hidden`, so the button never
 * actually hid below the `sm:` breakpoint. Fixed by moving `hidden sm:flex`
 * onto a plain `<span>` wrapper around the Tooltip instead of onto the
 * Tooltip's own className. This spec runs backend-free against `/`, per the
 * config's default 375×667 ("iPhone SE (3rd gen)") viewport.
 */
test("mobile top bar: hamburger shows, desktop collapse-toggle stays hidden at 375px", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "networkidle" });

  await expect(page.getByLabel("Open menu")).toBeVisible();
  await expect(page.getByLabel(/Collapse sidebar|Expand sidebar/)).toBeHidden();
});
