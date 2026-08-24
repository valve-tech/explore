import { test, expect } from "@playwright/test";

/**
 * Geometry gate for the testnet switch.
 *
 * This exists because the switch shipped to production visibly broken and
 * every unit test passed. jsdom does no layout — `getBoundingClientRect`
 * returns zeros there — so a test that renders the component and clicks it
 * cannot see that the knob sits outside its own track. Only a real browser
 * can measure this, so the assertion lives here.
 *
 * Scoped to /settings by aria-label, not to a footer: the switch used to sit
 * in a footer bar on every page, which was more chrome than a rarely-touched
 * preference deserves. It lives in Settings only now.
 *
 * The original defect: the knob is absolutely positioned, and with no
 * explicit `left` the browser resolved its static position to 15px inside a
 * 30px track. `translate-x-[14px]` then put it at 29px, so it escaped the
 * track and overlapped the "Testnets" label beside it.
 */

/** Reads the switch, its knob, and the label that sits next to them. */
async function measure(page: import("@playwright/test").Page) {
  return await page.evaluate(() => {
    const track = document.querySelector<HTMLElement>(
      '[role="switch"][aria-label="Show testnets"]',
    );
    if (!track) throw new Error("no testnet switch on the page");
    const knob = track.firstElementChild as HTMLElement | null;
    if (!knob) throw new Error("switch has no knob element");
    const label = [...(track.parentElement?.children ?? [])].find(
      (c) => c.textContent?.trim() === "Testnets",
    );
    const box = (el: Element) => {
      const b = el.getBoundingClientRect();
      return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width };
    };
    return {
      track: box(track),
      knob: box(knob),
      label: label ? box(label) : null,
      checked: track.getAttribute("aria-checked") === "true",
    };
  });
}

for (const state of ["on", "off"] as const) {
  test(`testnet switch: the knob stays inside its track (${state})`, async ({ page }) => {
    await page.goto("/settings", { waitUntil: "networkidle" });
    const sw = page.locator('[role="switch"][aria-label="Show testnets"]');
    await sw.waitFor();

    // Drive the switch into the state under test.
    const want = state === "on";
    if ((await sw.getAttribute("aria-checked")) !== String(want)) {
      await sw.click();
      await expect(sw).toHaveAttribute("aria-checked", String(want));
    }
    // Let the knob's transform transition settle before measuring.
    await page.waitForTimeout(250);

    const m = await measure(page);
    expect(m.checked).toBe(want);

    expect(
      m.knob.left,
      `knob left ${m.knob.left} is left of track left ${m.track.left}`,
    ).toBeGreaterThanOrEqual(m.track.left);

    expect(
      m.knob.right,
      `knob right ${m.knob.right} escapes track right ${m.track.right}`,
    ).toBeLessThanOrEqual(m.track.right);

    expect(m.knob.top).toBeGreaterThanOrEqual(m.track.top);
    expect(m.knob.bottom).toBeLessThanOrEqual(m.track.bottom);
  });
}

test("testnet switch: the knob never overlaps the Testnets label", async ({ page }) => {
  await page.goto("/settings", { waitUntil: "networkidle" });
  await page.locator('[role="switch"][aria-label="Show testnets"]').waitFor();
  await page.waitForTimeout(250);

  const m = await measure(page);
  expect(m.label, 'no "Testnets" label found beside the switch').not.toBeNull();
  expect(
    m.knob.right,
    `knob right ${m.knob.right} overlaps label left ${m.label?.left}`,
  ).toBeLessThanOrEqual(m.label!.left);
});

test("testnet switch: the knob actually moves between states", async ({ page }) => {
  await page.goto("/settings", { waitUntil: "networkidle" });
  const sw = page.locator('[role="switch"][aria-label="Show testnets"]');
  await sw.waitFor();
  await page.waitForTimeout(250);

  const before = await measure(page);
  await sw.click();
  await expect(sw).toHaveAttribute("aria-checked", String(!before.checked));
  await page.waitForTimeout(250);
  const after = await measure(page);

  // A switch whose knob does not move reads as inert, whatever aria says.
  expect(
    Math.abs(after.knob.left - before.knob.left),
    "knob did not move when the switch was toggled",
  ).toBeGreaterThan(4);
});
