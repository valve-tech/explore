import { test, expect, type Page } from "@playwright/test";
import { stubAddressEndpoints, stubTxEndpoints } from "./stubs";
import fixture from "../src/__tests__/fixtures/bridgeValidatorTx.json" with { type: "json" };
import type { AddressTransaction, TransactionDetails } from "../src/api/explorer";

/*
 * The bridge-validator case that motivated the role icons: chain 1 address
 * 0x5ECfE77502317F3677f23C3b8Ab17929ACE3D74E appears in tx
 * 0x7fb3925046709b47703375493d7b64c3401c00199fa59a533e1e130c4dcc63d8 only as
 * an ecrecover result and an isValidator(address) argument.
 */
const VALIDATOR = "0x5ECfE77502317F3677f23C3b8Ab17929ACE3D74E";
const HASH = "0x7fb3925046709b47703375493d7b64c3401c00199fa59a533e1e130c4dcc63d8";
const SHOTS = process.env.SHOT_DIR;

function row(hash: string, relations: AddressTransaction["relations"], from: string): AddressTransaction {
  return {
    hash,
    relations,
    blockNumber: "26478264",
    timeStamp: String(Math.floor(Date.now() / 1000) - 600),
    from,
    to: "0xd0764fae29e0a6a96ff685f71cfc685456d5636c",
    value: "0",
    valuePLS: "0",
    gas: "310251",
    gasUsed: "243404",
    gasPrice: "2355186517",
    isError: "0",
    functionName: "safeExecuteSignaturesWithAutoGasLimit(bytes,bytes)",
    functionCandidates: 1,
    methodId: "0x23caab49",
    input: "0x23caab49",
    type: "eip1559",
    maxFeePerGas: null,
    maxPriorityFeePerGas: null,
  };
}

async function stubRows(page: Page) {
  await stubAddressEndpoints(page, VALIDATOR);
  await page.route(
    (url) => url.pathname === `/api/address/${VALIDATOR}/txs`,
    (route) =>
      route.fulfill({
        json: {
          ok: true,
          result: {
            transactions: [
              row(HASH, ["trace"], "0xe3c31dd2605bf50bfd4bbb39b5a84041aaa38695"),
              row("0x" + "1".repeat(64), ["trace"], "0x6dfcfe411c9a5bf7a42d43ef39dac78206c2db39"),
              row("0x" + "2".repeat(64), ["sender", "calldata"], VALIDATOR),
            ],
            total: 3,
          },
        },
      }),
  );
}

for (const width of [375, 1280]) {
  test(`role icons and filter render at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await stubRows(page);
    await page.goto(`/eip155/1/address/${VALIDATOR}`);
    const bar = page.getByRole("group", { name: /how this address takes part/i });
    await expect(bar).toBeVisible();
    await expect(bar.getByRole("button", { name: /event log/i })).toBeDisabled();
    await expect(page.getByTestId("relation-icons")).toHaveCount(3);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/address-${width}.png`, fullPage: true });

    await bar.getByRole("button", { name: /trace only/i }).click();
    await expect(page.getByTestId("relation-icons")).toHaveCount(1);
    await expect(page.getByText("Showing 1 of 3 on this page")).toBeVisible();
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/address-filtered-${width}.png`, fullPage: true });

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBe(0);
  });
}

test("the role strip opens the tx page naming the exact calls", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await stubRows(page);
  await stubTxEndpoints(page, HASH, fixture as unknown as Partial<TransactionDetails>);
  await page.goto(`/eip155/1/address/${VALIDATOR}`);
  await page.getByTestId("relation-icons").first().click();
  const focus = page.getByTestId("address-focus");
  await expect(focus).toContainText("ecrecover returns it, so it signed data this transaction checks.");
  await expect(focus).toContainText("an argument of isValidator(address)");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/tx-focus.png`, fullPage: false });
});
