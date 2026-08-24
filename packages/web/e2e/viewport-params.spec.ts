import { test, expect, type Page } from "@playwright/test";
import {
  stubAddressEndpoints,
  stubTxEndpoints,
  stubBlockEndpoints,
  stubTokenEndpoints,
  stubMultichainAddressEndpoints,
  stubMultichainBlockEndpoints,
  FROM_ADDRESS,
  FULL_TX_HASH,
  TOKEN_ADDRESS,
  BLOCK_NUMBER,
  BLOCK_HASH,
} from "./stubs";

/**
 * `viewport.spec.ts` gates every STATIC top-level route against horizontal
 * overflow at 375px, but it never visits the four PARAMETERIZED explorer
 * routes — /tx/:hash, /address/:address, /block/:id, /token/:address — which
 * is exactly the surface the DataTable migration redesigned (`DataTable`
 * primitive: a `<table>` on desktop, a card list on mobile — see
 * `packages/web/src/components/primitives/DataTable.tsx`). Backend-free, an
 * unmounted param route just renders its loading/error shell, so the
 * no-overflow gate never actually ran against a populated table/card
 * surface. This spec stubs each route's endpoints with a POPULATED,
 * real-shaped fixture (66-char hashes, 42-char addresses, per
 * `./stubs.ts`) so MiddleTruncate cells render as they do in production,
 * then checks for overflow at 375px.
 *
 * TWO checks, not one — deliberately, per an investigation while building
 * this spec (see the teeth-proof in the fix's report): `AppShell`'s content
 * pane (`packages/web/src/components/AppShell.tsx`, `data-testid=
 * "app-content"`) is a flex-1 item with `overflow-auto` + `min-w-0`. That
 * combination is a deliberate, correct horizontal-scroll CONTAINMENT
 * boundary — verified empirically, a wide DataTable cell inside it (even one
 * that bypasses `MiddleTruncate`'s own clipping, even `position: fixed`)
 * never inflates `document.documentElement.scrollWidth`; the pane just grows
 * its own internal `scrollWidth` and becomes horizontally scrollable in
 * place. So `document.documentElement.scrollWidth <= 375` alone — the
 * existing `viewport.spec.ts` convention — can only ever catch a CHROME-level
 * regression (TopBar/Sidebar escaping normal flow), never a cell/table
 * overflow bug in the routed content itself, which is exactly the surface
 * this spec exists to gate. The second assertion (`app-content`'s own
 * `scrollWidth <= clientWidth`) is the one with real teeth against that bug
 * class; the first is kept for parity with `viewport.spec.ts` and to still
 * catch chrome-level breakage.
 */
/**
 * `waitForText` is a substring unique to the route's LOADED (not loading/
 * error) state — e.g. the fixture's tx/block hash, or contract address,
 * rendered as plain text once the stubbed fetch resolves. Waiting on a fixed
 * timeout here previously raced the stub resolving + React committing before
 * the overflow measurement fired, which made the measurement flaky (it could
 * catch the loading spinner, not the populated table/card).
 */
async function assertNoOverflow(
  page: Page,
  path: string,
  waitForText: string,
): Promise<void> {
  await page.goto(path);
  await page.getByText(waitForText).first().waitFor({ state: "visible", timeout: 20_000 });
  const overflow = await page.evaluate(() => {
    const content = document.querySelector('[data-testid="app-content"]');
    return {
      docScrollWidth: document.documentElement.scrollWidth,
      contentScrollWidth: content?.scrollWidth ?? null,
      contentClientWidth: content?.clientWidth ?? null,
    };
  });
  expect(
    overflow.docScrollWidth,
    `${path} overflows the page shell: scrollWidth ${overflow.docScrollWidth} > 375`,
  ).toBeLessThanOrEqual(375);
  expect(
    overflow.contentScrollWidth,
    `${path} overflows its own content pane (internal horizontal scroll): ` +
      `scrollWidth ${overflow.contentScrollWidth} > clientWidth ${overflow.contentClientWidth}`,
  ).toBeLessThanOrEqual(overflow.contentClientWidth ?? 0);
}

// --- /tx/:hash — populated: core tx + decode (DecodedInputSection,
// EventsSection, InternalTxSection [DataTable], TokenTransfersSection
// [DataTable] all render non-empty). ---
test("no horizontal overflow at 375px: /tx/:hash (populated)", async ({ page }) => {
  await stubTxEndpoints(page);
  // OverviewSection renders `tx.hash` as plain text (not just a `title`
  // attr), so it's a reliable "core payload has loaded" marker.
  await assertNoOverflow(page, `/tx/${FULL_TX_HASH}`, FULL_TX_HASH);
});

// --- /address/:address — populated: one tx row (TxTable [DataTable]).
//
// CHAIN-SCOPED on purpose. An unscoped `/address/:a` now renders the
// all-chain `MultiChainAddressView` (an address is valid on every chain, so
// picking one silently was the bug that view exists to fix), and the
// single-chain `AddressView` this test gates is what a chain-scoped URL
// renders. The all-chain view gets its own test below — both surfaces need
// the 375px gate, so this spec covers both rather than swapping one for the
// other. ---
test("no horizontal overflow at 375px: /address/:address (populated)", async ({
  page,
}) => {
  await stubAddressEndpoints(page);
  // The balance card's "Balance" label is present as soon as AddressView's
  // loaded (non-loading, non-error) state renders.
  await assertNoOverflow(page, `/eip155/369/address/${FROM_ADDRESS}`, "Balance");
});

// --- /block/:id — populated: block info + one tx row (DataTable).
// Chain-scoped for the same reason as /address above: an unscoped block
// NUMBER now fans out to `BlockHeightView`. ---
test("no horizontal overflow at 375px: /block/:id (populated)", async ({ page }) => {
  await stubBlockEndpoints(page);
  // `block.hash` renders as plain text in the Block Info card.
  await assertNoOverflow(page, `/eip155/369/block/${BLOCK_NUMBER}`, BLOCK_HASH);
});

// --- /token/:address — populated: verified contract (ContractHeader,
// SubTabBar, read-function list). Not a DataTable surface (ABI function
// lists render as cards, not tabular rows), but still real, non-empty,
// interactive content rather than the loading/error shell. ---
test("no horizontal overflow at 375px: /token/:address (populated)", async ({
  page,
}) => {
  await stubTokenEndpoints(page);
  // ContractHeader renders `address` as plain text once `info` loads.
  // Chain-scoped: `/token/:a` maps to the `contract` view shape, which the
  // all-chain branch also claims when the URL names no chain.
  await assertNoOverflow(page, `/eip155/369/token/${TOKEN_ADDRESS}`, TOKEN_ADDRESS);
});

// --- The all-chain views. These are what an UNSCOPED entity URL renders, and
// they are the widest new surface this app has: a per-chain presence strip and
// a merged feed whose rows carry a chain name, a function signature, and a
// 66-char hash on one line. Nothing gated them at 375px before. ---

test("no horizontal overflow at 375px: /address/:address (all chains)", async ({
  page,
}) => {
  await stubMultichainAddressEndpoints(page);
  // The strip's section heading renders as soon as presence resolves.
  await assertNoOverflow(page, `/address/${FROM_ADDRESS}`, "WHERE THIS ADDRESS LIVES");
});

test("no horizontal overflow at 375px: /token/:address (all chains)", async ({
  page,
}) => {
  await stubMultichainAddressEndpoints(page, TOKEN_ADDRESS);
  await assertNoOverflow(page, `/token/${TOKEN_ADDRESS}`, "WHERE THIS ADDRESS LIVES");
});

test("no horizontal overflow at 375px: /block/:id (all chains)", async ({ page }) => {
  await stubMultichainBlockEndpoints(page);
  // The view now names the height it is describing, so that is the marker.
  // It did not when this test was written, which is why it used to wait on a
  // chain name instead.
  await assertNoOverflow(page, `/block/${BLOCK_NUMBER}`, "Block height");
});
