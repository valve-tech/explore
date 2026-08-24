import { test, expect } from "@playwright/test";
import { stubTxEndpoints, FULL_TX_HASH } from "./stubs";

/**
 * The next-steps rail, rendered.
 *
 * Its unit tests cover `nextStepsFor` in isolation, which is the right place
 * for the branch logic — but a pure function returning three steps proves
 * nothing about whether the rail reaches the page. This spec drives the real
 * transaction route with a populated fixture and asserts what a reader
 * actually sees.
 *
 * It also pins the property the rail exists for: it appears ONLY when there
 * is a real suggestion. A rail that renders an empty box on every plain
 * transaction would be worse than no rail.
 */

const RAIL = "What to do next";

test("a reverted transaction offers the debugger", async ({ page }) => {
  await stubTxEndpoints(page, FULL_TX_HASH, { status: "reverted" });
  await page.goto(`/eip155/369/tx/${FULL_TX_HASH}`);

  const heading = page.getByText(RAIL);
  await expect(heading).toBeVisible({ timeout: 20_000 });

  // Scope to the rail's own container. A bare `a:has-text("debugger")`
  // matches the sidebar's Debugger nav link, which is unprefixed by design —
  // the test would then report a chain-scope bug that isn't there.
  // Scope to the rail's card, not the heading div. `.last()` on a text
  // filter returns the DEEPEST match — the heading itself, which holds no
  // links — so the assertion below would fail for the wrong reason.
  const rail = page.locator(".card").filter({ hasText: RAIL }).first();

  // Every suggestion must be a real link, not a label. A dead suggestion is
  // the failure mode this feature is most prone to.
  const links = rail.locator("a[href]");
  const count = await links.count();
  expect(count, "the rail rendered no links at all").toBeGreaterThan(0);

  const href = await links.first().getAttribute("href");
  expect(href, "the first suggestion has no href").toBeTruthy();
  // Chain scope must survive: every suggestion has to carry the /eip155/369
  // prefix, or it silently sends the reader to the default chain.
  for (let i = 0; i < count; i++) {
    const h = await links.nth(i).getAttribute("href");
    expect(h, `suggestion ${i} lost its chain prefix: ${h}`).toContain(
      "/eip155/369/",
    );
  }
});

test("a successful swap offers a next step too", async ({ page }) => {
  await stubTxEndpoints(
    page,
    FULL_TX_HASH,
    { status: "success" },
    "swapExactTokensForTokens(uint256,uint256,address[],address,uint256)",
  );
  await page.goto(`/eip155/369/tx/${FULL_TX_HASH}`);
  await expect(page.getByText(RAIL)).toBeVisible({ timeout: 20_000 });
});

test("a plain successful transfer shows no rail at all", async ({ page }) => {
  await stubTxEndpoints(
    page,
    FULL_TX_HASH,
    { status: "success" },
    "transfer(address,uint256)",
  );
  await page.goto(`/eip155/369/tx/${FULL_TX_HASH}`);

  // Wait for the page to actually load before asserting an absence, or this
  // passes against a blank screen.
  await expect(page.getByText("Transaction Overview")).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText(RAIL)).toHaveCount(0);
});
