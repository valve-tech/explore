import { test, expect } from "@playwright/test";
import { stubAddressEndpoints, FROM_ADDRESS, FULL_TX_HASH } from "./stubs";

// The value whose full-string searchability we're proving: TxTable renders
// it through MiddleTruncate (two child spans, CSS-clipped), never as plain
// text. Shared with the parameterized viewport gate (`viewport-params.spec.ts`)
// via `./stubs` so both specs exercise the exact same fixture shape.
const FULL_HASH = FULL_TX_HASH;

test("full tx hash in a MiddleTruncate'd table cell is present in the DOM even though it renders visually truncated (Ctrl+F works)", async ({
  page,
}) => {
  await stubAddressEndpoints(page);

  // Not "networkidle": the app holds a live alert WebSocket + TanStack Query
  // polling open for the lifetime of the page, so the network never goes
  // fully idle — that wait strategy timed out here in practice (see prior
  // version of this spec). Navigate, then wait for the specific element.
  await page.goto(`/address/${FROM_ADDRESS}`);

  // MiddleTruncate sets `title={value}` on its outer span (see
  // packages/web/src/components/primitives/MiddleTruncate.tsx) — this proves
  // the full value is attached to the element regardless of visual clipping.
  const truncatedHash = page.getByTitle(FULL_HASH);
  await expect(truncatedHash).toBeVisible({ timeout: 20_000 });

  // The real Ctrl+F proof: the full 66-char hash must appear as CONTIGUOUS
  // text in the rendered DOM, even though MiddleTruncate splits it across two
  // child spans (`.mt-lead` + `.mt-tail`) with the middle CSS-clipped away.
  // `textContent` concatenates a node's descendant text nodes in document
  // order with no separator — exactly what browser find-in-page scans — so
  // this only passes if the two spans' text is truly the unbroken original
  // string, not a JS-truncated `"…"` ellipsis.
  const bodyText = await page.locator("body").textContent();
  expect(bodyText).toContain(FULL_HASH);
});
