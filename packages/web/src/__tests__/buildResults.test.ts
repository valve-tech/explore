import { describe, it, expect } from "vitest";
import { buildResults } from "../components/AppShell/buildResults";
import { parseInput } from "../components/AppShell/parseInput";
import type { RecentEntity } from "../lib/recentEntities";

/**
 * The command palette's "Pages" come from buildResults. Footer routes
 * (Settings / UI / Drafts) used to be reachable only by typing the URL; they're
 * now in UTILITY_PAGES and must show up as jumpable pages here.
 */
function pages(query: string) {
  return buildResults(query, parseInput(query), [], "pages").map((r) => r.to);
}

describe("buildResults — utility pages are jumpable", () => {
  it("surfaces Settings, UI gallery, and Drafts in the Pages tab", () => {
    expect(pages("settings")).toContain("/settings");
    expect(pages("ui")).toContain("/ui");
    expect(pages("draft")).toContain("/drafts");
  });

  it("still surfaces the regular feature pages", () => {
    expect(pages("explorer")).toContain("/explorer");
    expect(pages("monitor")).toContain("/monitoring");
  });

  it("includes utility pages in the 'all' tab when queried", () => {
    const all = buildResults("settings", parseInput("settings"), [], "all").map(
      (r) => r.to,
    );
    expect(all).toContain("/settings");
  });
});

/**
 * A palette row for a recent entity links to the chain that entity was seen
 * on, through the same `hrefFor` the recents rail uses. Two surfaces showing
 * different URLs for one entry would be the bug.
 */
describe("buildResults — recent rows name their chain", () => {
  function recent(over: Partial<RecentEntity> = {}): RecentEntity {
    return {
      kind: "tx",
      value: "0xabc",
      pinned: false,
      visits: 1,
      lastSeen: Date.now(),
      ...over,
    };
  }

  function rowsFor(entities: RecentEntity[]): string[] {
    return buildResults("", parseInput(""), entities, "recent").map((r) => r.to);
  }

  it("scopes a recent transaction to its chain", () => {
    expect(rowsFor([recent({ chainId: 369 })])).toEqual(["/eip155/369/tx/0xabc"]);
  });

  it("scopes a recent contract to its chain", () => {
    expect(rowsFor([recent({ kind: "contract", value: "0xbbb", chainId: 1 })])).toEqual([
      "/eip155/1/token/0xbbb",
    ]);
  });

  it("leaves a recent address bare — it is valid on every chain", () => {
    expect(rowsFor([recent({ kind: "address", value: "0xaaa", chainId: 369 })])).toEqual([
      "/address/0xaaa",
    ]);
  });

  it("leaves a legacy entry with no chain on the bare path", () => {
    expect(rowsFor([recent()])).toEqual(["/tx/0xabc"]);
  });
});
