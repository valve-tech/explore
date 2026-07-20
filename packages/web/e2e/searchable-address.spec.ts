import { test, expect, type Page } from "@playwright/test";
import type { AddressTransaction } from "../src/api/explorer";

// Deliberately not a real on-chain address — every backend call this page
// makes is stubbed below, so nothing here ever needs to resolve against a
// live chain. Fixed length/shape only matters for the assertions.
const FROM_ADDRESS = "0x1111111111111111111111111111111111111111";
const TO_ADDRESS = "0x2222222222222222222222222222222222222222";
// A syntactically valid 66-char (0x + 64 hex) tx hash. This is the value
// whose full-string searchability we're proving: TxTable renders it through
// MiddleTruncate (two child spans, CSS-clipped), never as plain text.
const FULL_HASH =
  "0x3333333333333333333333333333333333333333333333333333333333333333".slice(
    0,
    66,
  );

const FIXTURE_TX: AddressTransaction = {
  hash: FULL_HASH,
  blockNumber: "12345",
  timeStamp: String(Math.floor(Date.now() / 1000) - 60),
  from: FROM_ADDRESS,
  to: TO_ADDRESS,
  value: "1000000000000000000",
  valuePLS: "1",
  gas: "21000",
  gasUsed: "21000",
  gasPrice: "1000000000",
  isError: "0",
  functionName: "",
  methodId: "0x",
  input: "0x",
  type: "0",
  maxFeePerGas: null,
  maxPriorityFeePerGas: null,
};

/**
 * Stub every network call AddressView.tsx fires on mount (see
 * `packages/web/src/components/explorer/AddressView.tsx`, the
 * `Promise.all([fetchAddressInfo, fetchAddressTransactions, fetchAddressTokens,
 * fetchHoldings])` effect) so the page reaches its loaded state with zero
 * backend involvement. Matched by exact pathname + query param rather than a
 * glob, since `/api` is a single dispatcher path disambiguated by
 * `module`/`action` query params (see `packages/web/src/api/explorer.ts`).
 */
async function stubAddressEndpoints(page: Page): Promise<void> {
  // fetchAddressInfo -> readAddressViaDispatcher: two parallel dispatcher
  // reads, `module=account&action=balance` and `module=proxy&action=eth_getCode`.
  await page.route(
    (url) => url.pathname === "/api" && url.searchParams.get("action") === "balance",
    (route) => route.fulfill({ json: { status: "1", message: "OK", result: "0" } }),
  );
  await page.route(
    (url) => url.pathname === "/api" && url.searchParams.get("action") === "eth_getCode",
    (route) =>
      route.fulfill({ json: { jsonrpc: "2.0", id: 1, result: "0x" } }),
  );

  // fetchAddressTransactions -> GET /api/address/:addr/txs?page=&limit=
  // apiFetch() unwraps `{ ok, result }`; `result` is `{ transactions, total }`.
  await page.route(
    (url) => url.pathname === `/api/address/${FROM_ADDRESS}/txs`,
    (route) =>
      route.fulfill({
        json: { ok: true, result: { transactions: [FIXTURE_TX], total: 1 } },
      }),
  );

  // fetchAddressTokens -> GET /api/address/:addr/tokens
  await page.route(
    (url) => url.pathname === `/api/address/${FROM_ADDRESS}/tokens`,
    (route) => route.fulfill({ json: { ok: true, result: [] } }),
  );

  // fetchHoldings -> GET /api/portfolio/holdings?address=. AddressView
  // `.catch(() => null)`s this one, but stub it too so the page reaches its
  // loaded state deterministically rather than depending on catch-path timing.
  await page.route(
    (url) => url.pathname === "/api/portfolio/holdings",
    (route) =>
      route.fulfill({
        json: {
          ok: true,
          result: {
            chainId: 369,
            address: FROM_ADDRESS,
            native: { symbol: "PLS", balance: "0" },
            holdings: [],
            indexed: false,
          },
        },
      }),
  );
}

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
