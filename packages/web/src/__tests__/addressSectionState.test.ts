import { describe, it, expect } from "vitest";
import {
  ADDRESS_SECTION_TIMEOUT_MS,
  ADDRESS_SECTION_TIMEOUT_SECONDS,
  addressSectionSignal,
} from "../components/explorer/AddressView/deadline";
import {
  describeFailure,
  failedLabels,
  holdingToToken,
  outstandingLabels,
  readyCount,
  resolveTokensSection,
  settleSection,
  toSectionState,
  type SectionSummary,
} from "../components/explorer/AddressView/sectionState";
import { normalizeTxPage } from "../components/explorer/AddressView/useAddressWorkspace";
import type { AddressToken } from "../api/explorer";
import type { HoldingsResult } from "../api/portfolio";

/**
 * The pure half of the address workspace's load. The rule these tests hold in
 * place: the client deadline sits ABOVE the server's own 30s bound, and no
 * single failed read can take a sibling down with it.
 */

/** What the backend bounds itself at: chifra 30s, viem 30s. */
const SERVER_BOUND_MS = 30_000;

const WPLS = "0xA1077a294dDE1B09bB078844df40758a5D0f9a27";

const rpcToken: AddressToken = {
  balance: "1000000000000000000",
  formattedBalance: "1.0",
  contractAddress: WPLS,
  name: "Wrapped Pulse (RPC list)",
  symbol: "WPLS",
  decimals: "18",
  type: "ERC-20",
};

const indexedHoldings: HoldingsResult = {
  chainId: 369,
  address: "0xabc",
  native: { symbol: "PLS", balance: "0" },
  indexed: true,
  holdings: [
    {
      tokenAddress: WPLS,
      symbol: "WPLS",
      name: "Wrapped Pulse",
      decimals: 18,
      balance: "5456507558918974858760",
    },
  ],
};

function fulfilled<T>(value: T): PromiseSettledResult<T> {
  return { status: "fulfilled", value };
}
function rejected<T>(reason: unknown): PromiseSettledResult<T> {
  return { status: "rejected", reason };
}

describe("address section deadline", () => {
  it("sits ABOVE the 30s server bound, not below it", () => {
    // A tighter deadline (the 8–10s used for cheap lookups) would abort reads
    // that were about to succeed — a regression, not a fix.
    expect(ADDRESS_SECTION_TIMEOUT_MS).toBeGreaterThan(SERVER_BOUND_MS);
    expect(ADDRESS_SECTION_TIMEOUT_MS).toBeGreaterThanOrEqual(35_000);
    expect(ADDRESS_SECTION_TIMEOUT_MS).toBeLessThanOrEqual(40_000);
  });

  it("still bounds the wait — it is a deadline, not 'forever'", () => {
    expect(Number.isFinite(ADDRESS_SECTION_TIMEOUT_MS)).toBe(true);
    expect(ADDRESS_SECTION_TIMEOUT_SECONDS).toBe(ADDRESS_SECTION_TIMEOUT_MS / 1000);
  });

  it("hands every call site its OWN signal", () => {
    // One shared signal would let the first section to time out abort its
    // healthy siblings.
    const a = addressSectionSignal();
    const b = addressSectionSignal();
    expect(a).not.toBe(b);
    expect(a.aborted).toBe(false);
  });
});

describe("describeFailure", () => {
  it("names our own deadline for a TimeoutError", () => {
    const err = new DOMException("signal timed out", "TimeoutError");
    expect(describeFailure(err)).toContain(`${ADDRESS_SECTION_TIMEOUT_SECONDS} seconds`);
  });

  it("treats Chromium's AbortError as the same deadline", () => {
    // Chromium rejects an AbortSignal.timeout abort with AbortError ("The user
    // aborted a request."), not the spec's TimeoutError. The user aborted
    // nothing — do not repeat the browser's story back to them.
    const chromiumAbort = new DOMException("The user aborted a request.", "AbortError");
    expect(describeFailure(chromiumAbort)).toContain(
      `${ADDRESS_SECTION_TIMEOUT_SECONDS} seconds`,
    );
    expect(describeFailure(chromiumAbort)).not.toContain("user aborted");
  });

  it("passes an upstream message straight through", () => {
    expect(describeFailure(new Error("chifra exited 1"))).toBe("chifra exited 1");
  });

  it("never renders an empty reason", () => {
    expect(describeFailure(new Error(""))).toMatch(/unknown reason/);
    expect(describeFailure(undefined)).toMatch(/unknown reason/);
  });
});

describe("toSectionState / settleSection", () => {
  it("maps a fulfilled result to ready", () => {
    expect(toSectionState(fulfilled(42))).toEqual({ status: "ready", data: 42 });
  });

  it("maps a rejected result to failed WITH a reason", () => {
    expect(toSectionState(rejected(new Error("boom")))).toEqual({
      status: "failed",
      reason: "boom",
    });
  });

  it("never rejects — allSettled semantics, so one read cannot take siblings down", async () => {
    const failing = settleSection(Promise.reject(new Error("upstream down")));
    const passing = settleSection(Promise.resolve("data"));
    await expect(failing).resolves.toEqual({
      status: "failed",
      reason: "upstream down",
    });
    await expect(passing).resolves.toEqual({ status: "ready", data: "data" });
  });

  it("settles each read independently, in its OWN time", async () => {
    const order: string[] = [];
    const slow = new Promise((resolve) => setTimeout(() => resolve("slow"), 20));
    void settleSection(slow).then(() => order.push("slow"));
    await settleSection(Promise.reject(new Error("fast failure"))).then(() =>
      order.push("fast"),
    );
    // The fast FAILURE lands first; the slow success is still in flight.
    expect(order).toEqual(["fast"]);
  });
});

describe("resolveTokensSection", () => {
  it("prefers the indexed gateway", () => {
    const state = resolveTokensSection(fulfilled([rpcToken]), fulfilled(indexedHoldings));
    expect(state).toMatchObject({ status: "ready" });
    if (state.status !== "ready") throw new Error("unreachable");
    expect(state.data.indexed).toBe(true);
    expect(state.data.tokens[0]!.name).toBe("Wrapped Pulse");
  });

  it("falls back to the RPC list when the gateway REJECTS", () => {
    const state = resolveTokensSection(
      fulfilled([rpcToken]),
      rejected(new Error("gateway 502")),
    );
    expect(state).toEqual({
      status: "ready",
      data: { tokens: [rpcToken], indexed: false },
    });
  });

  it("falls back to the RPC list when the chain is not indexed", () => {
    const state = resolveTokensSection(
      fulfilled([rpcToken]),
      fulfilled({ ...indexedHoldings, indexed: false }),
    );
    expect(state).toMatchObject({ status: "ready", data: { indexed: false } });
  });

  it("fails LOUDLY when both reads fail — never an empty table", () => {
    const state = resolveTokensSection(
      rejected(new DOMException("signal timed out", "TimeoutError")),
      rejected(new Error("gateway 502")),
    );
    expect(state.status).toBe("failed");
    if (state.status !== "failed") throw new Error("unreachable");
    expect(state.reason).toContain(`${ADDRESS_SECTION_TIMEOUT_SECONDS} seconds`);
  });
});

describe("holdingToToken", () => {
  it("scales a raw balance at the render edge", () => {
    const token = holdingToToken(indexedHoldings.holdings[0]!);
    expect(token.formattedBalance).toBe("5,456.5076");
    expect(token.balance).toBe("5456507558918974858760");
  });

  it("shows the raw string rather than crashing on a non-numeric balance", () => {
    const token = holdingToToken({ ...indexedHoldings.holdings[0]!, balance: "not-a-number" });
    expect(token.formattedBalance).toBe("not-a-number");
  });
});

describe("normalizeTxPage", () => {
  it("keeps the reported total", () => {
    expect(normalizeTxPage({ transactions: [], total: 42 })).toEqual({
      transactions: [],
      total: 42,
    });
  });

  it("falls back to the page length when the backend omits the total", () => {
    const rows = [{}, {}] as never[];
    expect(normalizeTxPage({ transactions: rows }).total).toBe(2);
  });
});

describe("section summaries", () => {
  const sections: SectionSummary[] = [
    { label: "Overview", state: { status: "ready", data: null } },
    { label: "Transactions", state: { status: "loading" } },
    { label: "Token balances", state: { status: "failed", reason: "boom" } },
  ];

  it("names what is still outstanding", () => {
    expect(outstandingLabels(sections)).toEqual(["Transactions"]);
  });

  it("names what gave up", () => {
    expect(failedLabels(sections)).toEqual(["Token balances"]);
  });

  it("counts what has landed", () => {
    expect(readyCount(sections)).toBe(1);
  });
});
