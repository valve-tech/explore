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
      `${path} overflows: scrollWidth ${overflow.scrollWidth} > 375`,
    ).toBeLessThanOrEqual(375);
  });
}
