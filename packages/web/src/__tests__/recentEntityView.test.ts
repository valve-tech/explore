import { describe, it, expect } from "vitest";
import {
  chainForHref,
  dotColor,
  hrefFor,
  primaryLabel,
  secondaryLabel,
} from "../lib/recentEntityView";
import type { RecentEntity } from "../lib/recentEntities";

function entity(overrides: Partial<RecentEntity> = {}): RecentEntity {
  return {
    kind: "address",
    value: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984",
    pinned: false,
    visits: 1,
    lastSeen: Date.now(),
    ...overrides,
  };
}

describe("dotColor", () => {
  it("colours a tx by execution status", () => {
    expect(dotColor(entity({ kind: "tx", status: "success" }))).toContain("success");
    expect(dotColor(entity({ kind: "tx", status: "reverted" }))).toContain("danger");
    expect(dotColor(entity({ kind: "tx" }))).toContain("muted");
  });
  it("colours addresses green and contracts accent", () => {
    expect(dotColor(entity({ kind: "address" }))).toContain("success");
    expect(dotColor(entity({ kind: "contract" }))).toContain("accent");
    expect(dotColor(entity({ kind: "block" }))).toContain("muted");
  });
});

describe("hrefFor", () => {
  it("names the chain the entry was seen on, in CAIP-2 path form", () => {
    expect(hrefFor(entity({ kind: "tx", value: "0xabc", chainId: 369 })))
      .toBe("/eip155/369/tx/0xabc");
    expect(hrefFor(entity({ kind: "block", value: "42", chainId: 1 })))
      .toBe("/eip155/1/block/42");
    expect(hrefFor(entity({ kind: "contract", value: "0xbbb", chainId: 11155111 })))
      .toBe("/eip155/11155111/token/0xbbb");
  });

  it("leaves an address bare, because an address is valid on every chain", () => {
    expect(hrefFor(entity({ kind: "address", value: "0xaaa", chainId: 369 })))
      .toBe("/address/0xaaa");
  });

  it("falls back to the bare path for a legacy entry with no chain", () => {
    // Entries written before the store recorded a chain. The bare path is
    // exactly what shipped before, so an old entry still resolves; it must
    // never produce `/eip155/undefined/…`.
    expect(hrefFor(entity({ kind: "tx", value: "0xabc" }))).toBe("/tx/0xabc");
    expect(hrefFor(entity({ kind: "block", value: "42" }))).toBe("/block/42");
    expect(hrefFor(entity({ kind: "address", value: "0xaaa" }))).toBe("/address/0xaaa");
    expect(hrefFor(entity({ kind: "contract", value: "0xbbb" }))).toBe("/token/0xbbb");
  });

  it("falls back to the bare path for a chain we do not serve", () => {
    // `chainRoutePrefix` returns "" for an unregistered chain, so the caller
    // gets a route that resolves rather than one that renders nothing.
    expect(hrefFor(entity({ kind: "tx", value: "0xabc", chainId: 8453 })))
      .toBe("/tx/0xabc");
  });
});

describe("chainForHref", () => {
  it("reports the chain for every kind but an address", () => {
    expect(chainForHref(entity({ kind: "tx", chainId: 369 }))).toBe(369);
    expect(chainForHref(entity({ kind: "block", chainId: 369 }))).toBe(369);
    expect(chainForHref(entity({ kind: "contract", chainId: 369 }))).toBe(369);
    expect(chainForHref(entity({ kind: "address", chainId: 369 }))).toBeUndefined();
  });
});

describe("primaryLabel", () => {
  it("prefers an explicit label", () => {
    expect(primaryLabel(entity({ label: "UniswapV3Pool" }))).toBe("UniswapV3Pool");
  });
  it("truncates a long 0x value in the middle", () => {
    const label = primaryLabel(entity({ value: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984" }));
    expect(label).toBe("0x1f9840…01F984");
  });
  it("prefixes a block number with #", () => {
    expect(primaryLabel(entity({ kind: "block", value: "23481902" }))).toBe("#23481902");
  });
});

describe("secondaryLabel", () => {
  it("includes tx status and visit count when revisited", () => {
    const label = secondaryLabel(entity({ kind: "tx", status: "reverted", visits: 3 }));
    expect(label).toBe("tx · reverted · 3 visits");
  });
  it("falls back to a relative time on first visit", () => {
    const label = secondaryLabel(entity({ kind: "address", visits: 1, lastSeen: Date.now() }));
    expect(label).toBe("address · just now");
  });
  it("formats minute, hour, and day-scale relative times", () => {
    const min = secondaryLabel(entity({ visits: 1, lastSeen: Date.now() - 5 * 60_000 }));
    const hr = secondaryLabel(entity({ visits: 1, lastSeen: Date.now() - 3 * 3_600_000 }));
    const day = secondaryLabel(entity({ visits: 1, lastSeen: Date.now() - 2 * 86_400_000 }));
    expect(min).toBe("address · 5m ago");
    expect(hr).toBe("address · 3h ago");
    expect(day).toBe("address · 2d ago");
  });
});
