import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  fetchAppearances,
  isCompleteAnswer,
  isReaderAppearance,
  parseReaderResult,
  readerUrl,
} from "../../src/services/chifra/appearanceReader.js";

const BASE = "https://chifra.example";
const ADDR = "0xA1077a294dDE1B09bB078844df40758a5D0f9a27";

/** A well-formed sidecar body. */
function body(over: Record<string, unknown> = {}) {
  return {
    appearances: [
      { blockNumber: 27384722, transactionIndex: 32 },
      { blockNumber: 27384722, transactionIndex: 29 },
    ],
    total: 224843859,
    totalIsExact: true,
    coverage: {
      monitorLastBlock: 27383882,
      finalizedEnd: 27382782,
      head: 27384722,
      gap: null,
      complete: true,
    },
    ...over,
  };
}

const okFetch = (payload: unknown, status = 200) =>
  (async () =>
    ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => payload,
    }) as unknown as Response) as unknown as typeof fetch;

describe("readerUrl", () => {
  it("builds the query the sidecar expects", () => {
    const u = new URL(readerUrl("pulsechain", ADDR, 2, 25, BASE));
    assert.equal(u.pathname, "/appearances");
    assert.equal(u.searchParams.get("chain"), "pulsechain");
    assert.equal(u.searchParams.get("page"), "2");
    assert.equal(u.searchParams.get("perPage"), "25");
  });

  it("lowercases the address, because the index files are lowercase", () => {
    const u = new URL(readerUrl("pulsechain", ADDR, 1, 25, BASE));
    assert.equal(u.searchParams.get("address"), ADDR.toLowerCase());
  });
});

describe("isReaderAppearance", () => {
  it("accepts an integer pair", () => {
    assert.equal(isReaderAppearance({ blockNumber: 1, transactionIndex: 0 }), true);
  });

  it("rejects the shapes that would render as undefined", () => {
    assert.equal(isReaderAppearance({ blockNumber: "1", transactionIndex: 0 }), false);
    assert.equal(isReaderAppearance({ blockNumber: 1.5, transactionIndex: 0 }), false);
    assert.equal(isReaderAppearance({ blockNumber: 1 }), false);
    assert.equal(isReaderAppearance(null), false);
  });
});

/**
 * The distinction the whole fallback rests on: a body we cannot read must be
 * `null` (fall through to chifra), never an empty list (render "no history").
 */
describe("parseReaderResult", () => {
  it("reads a well-formed body", () => {
    const r = parseReaderResult(body());
    assert.equal(r?.total, 224843859);
    assert.equal(r?.totalIsExact, true);
    assert.equal(r?.appearances.length, 2);
    assert.equal(r?.coverage.head, 27384722);
  });

  it("keeps a genuinely empty page as an empty page", () => {
    const r = parseReaderResult(body({ appearances: [], total: 0 }));
    assert.deepEqual(r?.appearances, []);
    assert.equal(r?.total, 0);
  });

  it("is null when the body is not a sidecar response", () => {
    assert.equal(parseReaderResult(null), null);
    assert.equal(parseReaderResult({}), null);
    assert.equal(parseReaderResult({ appearances: "nope", total: 1 }), null);
    assert.equal(parseReaderResult(body({ total: "many" })), null);
  });

  it("is null when any row is unreadable, rather than dropping it", () => {
    const r = parseReaderResult(
      body({ appearances: [{ blockNumber: 1, transactionIndex: 0 }, { block: 2 }] }),
    );
    assert.equal(r, null, "a short page would silently lose a transaction");
  });

  it("treats a missing totalIsExact as not exact", () => {
    assert.equal(parseReaderResult(body({ totalIsExact: undefined }))?.totalIsExact, false);
  });

  it("carries a reported gap through", () => {
    const gap = { firstBlock: 26842835, lastBlock: 27382782, blocks: 539948 };
    const r = parseReaderResult(
      body({ totalIsExact: false, coverage: { gap, complete: false } }),
    );
    assert.deepEqual(r?.coverage.gap, gap);
    assert.equal(r?.coverage.complete, false);
  });
});

describe("fetchAppearances", () => {
  it("returns the parsed page on success", async () => {
    const r = await fetchAppearances("pulsechain", ADDR, 1, 25, {
      fetch: okFetch(body()),
      base: BASE,
    });
    assert.equal(r?.appearances.length, 2);
  });

  it("is null on a 404, so an unindexed chain falls through to chifra", async () => {
    const r = await fetchAppearances("pulsechain", ADDR, 1, 25, {
      fetch: okFetch({ error: "no index" }, 404),
      base: BASE,
    });
    assert.equal(r, null);
  });

  it("is null on a 500", async () => {
    const r = await fetchAppearances("pulsechain", ADDR, 1, 25, {
      fetch: okFetch({ error: "boom" }, 500),
      base: BASE,
    });
    assert.equal(r, null);
  });

  it("never throws when the sidecar is unreachable", async () => {
    const r = await fetchAppearances("pulsechain", ADDR, 1, 25, {
      fetch: (() => Promise.reject(new Error("ECONNREFUSED"))) as unknown as typeof fetch,
      base: BASE,
    });
    assert.equal(r, null);
  });

  it("never throws when the body is not JSON", async () => {
    const r = await fetchAppearances("pulsechain", ADDR, 1, 25, {
      fetch: (async () =>
        ({
          ok: true,
          status: 200,
          json: async () => {
            throw new Error("unexpected token <");
          },
        }) as unknown as Response) as unknown as typeof fetch,
      base: BASE,
    });
    assert.equal(r, null);
  });
});

/**
 * The gate that decides fast-versus-wrong. Shipping without it served an empty
 * list as fact for every address chifra had never been asked about.
 */
describe("isCompleteAnswer", () => {
  const result = (over: Record<string, unknown> = {}) =>
    parseReaderResult(body(over))!;

  it("accepts an answer that read the whole range", () => {
    assert.equal(isCompleteAnswer(result()), true);
  });

  it("rejects an address with no monitor, whose gap is the whole chain", () => {
    // The live 0x5182…22e2 case on mainnet: chifra had two appearances,
    // the sidecar had none, and the page said "no transactions".
    const r = result({
      appearances: [],
      total: 0,
      totalIsExact: false,
      coverage: {
        monitorLastBlock: null,
        gap: { firstBlock: 0, lastBlock: 25846659, blocks: 25846660 },
        complete: false,
      },
    });
    assert.equal(isCompleteAnswer(r), false);
  });

  it("rejects a stale monitor even though its total looks plausible", () => {
    // Binance 14: reports 50,291,073 appearances but has not read the gap.
    const r = result({
      total: 50291073,
      totalIsExact: false,
      coverage: { monitorLastBlock: 25306821, complete: false },
    });
    assert.equal(isCompleteAnswer(r), false);
  });

  it("rejects when either signal says incomplete", () => {
    assert.equal(
      isCompleteAnswer(result({ totalIsExact: false })),
      false,
      "an inexact total alone is enough to fall back",
    );
    assert.equal(
      isCompleteAnswer(result({ coverage: { complete: false } })),
      false,
    );
  });

  it("still accepts a genuinely empty history that was fully read", () => {
    // An address with a monitor, no gap, and nothing in it really has none.
    const r = result({ appearances: [], total: 0 });
    assert.equal(isCompleteAnswer(r), true);
  });
});
