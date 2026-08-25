import { test, expect, type Page } from "@playwright/test";

/**
 * Regression gate for a production overflow bug in `GasOracleWidget`
 * (`packages/web/src/components/explorer/GasOracleWidget.tsx`): the strip
 * was a single no-wrap flex row with nearly every child `shrink-0`, so it
 * could not compress. On chain 369 — whose gwei figures run into 5-6
 * digits — `app-content`'s own `scrollWidth` measured 211px past its
 * `clientWidth` at 375px, and the internal horizontal scrollbar clipped
 * the "STANDARD" tip value mid-digit.
 *
 * TWO assertions, not one — same rationale as `viewport-params.spec.ts`:
 * `AppShell`'s content pane (`data-testid="app-content"`) is a flex-1
 * `overflow-auto min-w-0` CONTAINMENT boundary. A wide child inside it
 * never inflates `document.documentElement.scrollWidth` — the pane just
 * grows its own `scrollWidth` and scrolls internally. So the document-level
 * check alone can only catch a chrome-level regression; the pane-level
 * check (`app-content`'s `scrollWidth <= clientWidth`) is the one with real
 * teeth against a widget overflowing sideways, which is exactly this bug.
 *
 * Every one of the four served chains is gated, per the report: chain 369
 * (PulseChain) carries the largest gwei magnitudes and is the hard case,
 * chain 1 and 943 exercise the sub-1-gwei subscript path, and 11155111
 * (Sepolia) is the plain mid-range case.
 *
 * ExplorerHome's other three queries (`/api/latest/summary`, `/api/blocks`,
 * `/api/txs/recent`) are stubbed with small, non-overflowing fixtures too —
 * that isolates the assertion to `GasOracleWidget` itself, which is the
 * surface this spec exists to gate, rather than picking up unrelated
 * overflow from the stat cards or the blocks/txs lists.
 */

interface TierFixture {
  maxPriorityFeePerGas: string;
  maxFeePerGas: string;
  gasPrice: string;
  maxFeePerBlobGas: string | null;
}

function tier(maxPriorityFeePerGas: string, maxFeePerGas: string): TierFixture {
  return { maxPriorityFeePerGas, maxFeePerGas, gasPrice: maxFeePerGas, maxFeePerBlobGas: null };
}

function history(baseWei: string, n = 21): string[] {
  const base = BigInt(baseWei);
  const step = base / 40n || 1n;
  return Array.from({ length: n }, (_, i) => String(base + (BigInt(i) - 10n) * step));
}

/**
 * Per-chain gas oracle fixtures. Chain 369 reproduces the documented hard
 * case (large gwei magnitudes: a 99,712 gwei standard tip, a 150,000 gwei
 * cap); chain 1 and 943 reproduce the production sub-1-gwei examples from
 * the bug report (0.11 gwei, and the deep-subscript 0.0₇7 gwei).
 */
const GAS_FIXTURES: Record<number, unknown> = {
  1: {
    chainId: 1,
    blockNumber: "21000000",
    baseFee: "110000000", // 0.11 gwei
    baseFeeTrend: "rising",
    baseFeeHistory: history("110000000"),
    mempool: { pendingCount: "142", queuedCount: "3", pendingGasDemand: "0", blockGasLimit: "30000000" },
    tiers: {
      slow: tier("1000000000", "1500000000"),
      standard: tier("1500000000", "2000000000"),
      fast: tier("2000000000", "3000000000"),
      instant: tier("3000000000", "4500000000"),
    },
  },
  369: {
    chainId: 369,
    blockNumber: "26804492",
    baseFee: "85000000000000", // 85,000 gwei
    baseFeeTrend: "falling",
    baseFeeHistory: history("85000000000000"),
    mempool: { pendingCount: "18432", queuedCount: "204", pendingGasDemand: "0", blockGasLimit: "30000000" },
    tiers: {
      slow: tier("50000000000000", "70000000000000"),
      standard: tier("99712000000000", "150000000000000"), // the documented "99,7…" cut-off case
      fast: tier("120000000000000", "180000000000000"),
      instant: tier("160000000000000", "220000000000000"),
    },
  },
  943: {
    chainId: 943,
    blockNumber: "1234567",
    baseFee: "70", // 0.00000007 gwei -> deep subscript "0.0₇7"
    baseFeeTrend: "stable",
    baseFeeHistory: history("70"),
    mempool: { pendingCount: "0", queuedCount: "0", pendingGasDemand: "0", blockGasLimit: "30000000" },
    tiers: {
      slow: tier("100", "200"),
      standard: tier("150", "250"),
      fast: tier("200", "300"),
      instant: tier("300", "450"),
    },
  },
  11155111: {
    chainId: 11155111,
    blockNumber: "7000000",
    baseFee: "2500000000", // 2.5 gwei
    baseFeeTrend: "stable",
    baseFeeHistory: history("2500000000"),
    mempool: { pendingCount: "12", queuedCount: "0", pendingGasDemand: "0", blockGasLimit: "30000000" },
    tiers: {
      slow: tier("1000000000", "1500000000"),
      standard: tier("1500000000", "2500000000"),
      fast: tier("2000000000", "3500000000"),
      instant: tier("3000000000", "5000000000"),
    },
  },
};

async function stubExplorerHome(page: Page, chainId: number): Promise<void> {
  await page.route(
    (url) => url.pathname === "/api/gas/oracle",
    (route) => route.fulfill({ json: { ok: true, result: GAS_FIXTURES[chainId] } }),
  );
  await page.route(
    (url) => url.pathname === "/api/latest/summary",
    (route) =>
      route.fulfill({
        json: {
          ok: true,
          result: {
            latestBlock: {
              number: "1",
              hash: `0x${"1".repeat(64)}`,
              timestamp: Math.floor(Date.now() / 1000),
              miner: `0x${"2".repeat(40)}`,
              transactionCount: 1,
              gasUsed: "1",
              gasLimit: "1",
              baseFeePerGas: "1000000000",
            },
            finalizedBlock: {
              number: "1",
              hash: `0x${"1".repeat(64)}`,
              timestamp: Math.floor(Date.now() / 1000),
              lagBlocks: 1,
            },
            gasPrice: { baseFeePerGas: "1000000000", suggestedPriorityFee: "1000000000" },
            network: { chainId, name: "test" },
          },
        },
      }),
  );
  await page.route(
    (url) => url.pathname === "/api/blocks",
    (route) => route.fulfill({ json: { ok: true, result: { blocks: [], cursor: null } } }),
  );
  await page.route(
    (url) => url.pathname === "/api/txs/recent",
    (route) => route.fulfill({ json: { ok: true, result: { transactions: [] } } }),
  );
}

async function assertPaneNoOverflow(page: Page, chainId: number): Promise<void> {
  await stubExplorerHome(page, chainId);
  await page.goto(`/eip155/${chainId}/explorer`);
  // "base" (lowercase, exact) is unique to the widget's loaded state — the
  // stat card above renders "BASE FEE" (its own separate label), never
  // this bare lowercase span.
  await page.getByText("base", { exact: true }).first().waitFor({ state: "visible", timeout: 20_000 });

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
    `chain ${chainId} overflows the page shell: scrollWidth ${overflow.docScrollWidth} > 375`,
  ).toBeLessThanOrEqual(375);
  expect(
    overflow.contentScrollWidth,
    `chain ${chainId} GasOracleWidget overflows its content pane: ` +
      `scrollWidth ${overflow.contentScrollWidth} > clientWidth ${overflow.contentClientWidth}`,
  ).toBeLessThanOrEqual(overflow.contentClientWidth ?? 0);
}

for (const chainId of [1, 369, 943, 11155111]) {
  test(`GasOracleWidget: no horizontal overflow at 375px on chain ${chainId}`, async ({ page }) => {
    await assertPaneNoOverflow(page, chainId);
  });
}
