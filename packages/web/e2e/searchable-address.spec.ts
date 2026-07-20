import { test, expect } from "@playwright/test";

// A syntactically valid PulseChain (chain 369) address with effectively no
// on-chain history. Deliberately NOT the WPLS token contract the brief
// originally suggested (0xA1077a...): that address has millions of chifra
// appearances, and /api/address/:addr/txs + /tokens each took ~30s to
// resolve against it (measured by hand, 2026-07-19) — workable once, but not
// something a "permanent CI gate" should wait on every run. A cold address
// resolves in a few seconds and exercises the exact same DOM path.
const ADDRESS = "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";

// This spec needs a live API (:10100, proxied through Vite's /health and
// /api). Verified by hand (2026-07-19): AddressView.tsx gates its entire
// render behind a loading/error state — AddressHeader (which prints the
// full, un-truncated `{address}` straight from the route param) only mounts
// once fetchAddressInfo/fetchAddressTransactions/etc. resolve. When the API
// is unreachable those calls reject, the page falls into the "Error / Failed
// to fetch" branch, and AddressHeader never mounts — so there is no
// backend-free element carrying the full address. The one address-shaped
// text that *does* survive (the breadcrumb chip, e.g. "0xA107...9a27") is
// real substring truncation via truncateAddr, not MiddleTruncate — it is
// deliberately NOT searchable, so it can't stand in for this assertion.
// Rather than false-fail the whole e2e gate in backend-less environments,
// skip with a clear reason when the API isn't up.
test("full address is present in the DOM even though it may render visually truncated (Ctrl+F works)", async ({ page, request }) => {
  // Use the `request` fixture (respects config's baseURL) rather than
  // `page.request`, which is an unconfigured APIRequestContext and rejects
  // relative URLs before the page has navigated anywhere.
  const health = await request.get("/health").catch(() => null);
  test.skip(
    health === null || !health.ok(),
    "searchable-address spec requires a live API on :10100 (AddressHeader only " +
      "renders once the address/tx/token fetches resolve — see AddressView.tsx)",
  );

  // Not "networkidle": the app holds a live alert WebSocket + TanStack Query
  // polling open for the lifetime of the page, so the network never goes
  // fully idle — that wait strategy timed out here in practice. Poll for the
  // text instead. Playwright's getByText matches on textContent, exactly
  // like browser find; if the address were JS-sliced into the DOM this would
  // never resolve.
  await page.goto(`/address/${ADDRESS}`);
  await expect(page.getByText(ADDRESS, { exact: false }).first()).toBeVisible({
    timeout: 20_000,
  });
});
