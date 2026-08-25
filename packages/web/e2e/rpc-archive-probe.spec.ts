import { test, expect } from "@playwright/test";

/**
 * The archive probe on the Settings page, at 375px.
 *
 * jsdom covers the behaviour (`src/__tests__/RpcAlternatives.test.tsx`) but it
 * does no layout, so nothing there can see the chip row after a probe adds a
 * verdict to every label. "rpc.builder0x69.io · recent blocks only" is roughly
 * three times the width of "rpc.builder0x69.io", and this row holds seven of
 * them beside a Test button — exactly the shape that clips or pushes the page
 * sideways on a phone.
 *
 * Every RPC call is stubbed. A real probe would reach seven third parties per
 * chain and make the result depend on their uptime.
 */
const PRUNED = {
  jsonrpc: "2.0",
  id: 1,
  error: { code: -32000, message: "missing trie node d67e4d450343046425ae" },
};

test.describe("RPC archive probe", () => {
  test.beforeEach(async ({ page }) => {
    // Every off-origin request, not just the probes — the settings page also
    // pulls chain logos from gib.show, and letting those out would make the
    // run depend on a third party. Only a POST is an RPC call.
    await page.route(
      (url) => !url.hostname.includes("localhost"),
      (route) =>
        route.request().method() === "POST"
          ? route.fulfill({ json: PRUNED })
          : route.fulfill({ status: 200, body: "" }),
    );
  });

  test("probes nothing until the button is pressed", async ({ page }) => {
    const rpcCalls: string[] = [];
    page.on("request", (r) => {
      if (!r.url().includes("localhost") && r.method() === "POST") {
        rpcCalls.push(r.url());
      }
    });

    await page.goto("/settings");
    await page.getByText("No-log options").first().waitFor();
    // Opening Settings must not announce the reader to seven third parties.
    expect(rpcCalls).toEqual([]);
  });

  test("labels every endpoint and keeps the row inside 375px", async ({ page }) => {
    await page.goto("/settings");
    // `exact` matters: several suggested hosts are testnet endpoints, so a
    // substring match on "Test" also selects chips named
    // "eth-sepolia-testnet.api.pocket.network".
    await page
      .getByRole("button", { name: "Test", exact: true })
      .first()
      .click();

    // The count line is the probe's own summary, so it only appears once
    // every endpoint in the row has answered.
    await expect(page.getByText(/0 of \d+ can read state at block 1/).first()).toBeVisible();

    const overflow = await page.evaluate(() => {
      const content = document.querySelector('[data-testid="app-content"]');
      const chips = [...document.querySelectorAll("button")].filter((b) =>
        b.textContent?.includes("recent blocks only"),
      );
      const widest = Math.max(...chips.map((c) => c.getBoundingClientRect().right));
      return {
        doc: document.documentElement.scrollWidth,
        pane: content ? content.scrollWidth - content.clientWidth : 0,
        chipCount: chips.length,
        widestChipRight: Math.round(widest),
      };
    });

    expect(overflow.chipCount).toBeGreaterThan(0);
    expect(overflow.doc, "page scrolls sideways after probing").toBeLessThanOrEqual(375);
    expect(overflow.pane, "content pane scrolls sideways after probing").toBeLessThanOrEqual(0);
    expect(
      overflow.widestChipRight,
      "a verdict chip runs past the viewport",
    ).toBeLessThanOrEqual(375);
  });
});
