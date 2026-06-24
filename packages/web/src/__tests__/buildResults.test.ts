import { describe, it, expect } from "vitest";
import { buildResults } from "../components/AppShell/buildResults";
import { parseInput } from "../components/AppShell/parseInput";

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
