import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { feedHealth, FeedStatus } from "../components/explorer/ExplorerHome/FeedStatus";

/**
 * The signal that says whether the explorer is still hearing from its backend.
 *
 * The defect this answers, measured on production: with a warm cache, all four
 * home-page endpoints forced to 500 rendered a full, plausible page — real
 * hashes, real block numbers — while thirty fetches failed in fifteen seconds.
 * `staleTime: Infinity` plus IndexedDB persistence meant a live outage was
 * indistinguishable from a working explorer, and stayed that way.
 */
const NOW = 1_700_000_000_000;
const ok = (updatedAt = NOW) => ({ isError: false, hasData: true, dataUpdatedAt: updatedAt });
const failing = (updatedAt: number) => ({ isError: true, hasData: true, dataUpdatedAt: updatedAt });
const cold = { isError: true, hasData: false, dataUpdatedAt: 0 };

describe("feedHealth", () => {
  it("is live when every feed succeeded", () => {
    expect(feedHealth([ok(), ok(), ok()], NOW)).toEqual({ state: "live", ageMs: 0 });
  });

  it("is stale when a refetch fails but cached data is on screen", () => {
    // The whole point. `isError` and `data` are both truthy in TanStack v5
    // during a failing background refetch, and that pair is what separates
    // "showing you something old" from "showing you nothing".
    const health = feedHealth([ok(), failing(NOW - 45_000), ok()], NOW);
    expect(health.state).toBe("stale");
  });

  it("is down when nothing was ever cached", () => {
    expect(feedHealth([cold, cold, cold], NOW).state).toBe("down");
  });

  it("takes the worst verdict across feeds, not the average", () => {
    // Two healthy feeds must not vouch for a third that is failing.
    expect(feedHealth([ok(), ok(), failing(NOW - 1_000)], NOW).state).toBe("stale");
  });

  it("reports the age of the NEWEST success, not the oldest", () => {
    // The screen is as fresh as its freshest part; claiming otherwise would
    // overstate the problem and train people to ignore the warning.
    const health = feedHealth([ok(NOW - 10_000), failing(NOW - 90_000)], NOW);
    expect(health.ageMs).toBe(10_000);
  });

  it("never reports a negative age when a clock runs backwards", () => {
    expect(feedHealth([failing(NOW + 5_000)], NOW).ageMs).toBe(0);
  });
});

describe("<FeedStatus />", () => {
  it("says live quietly", () => {
    render(<FeedStatus health={{ state: "live", ageMs: 0 }} />);
    expect(screen.getByText("live")).toBeInTheDocument();
    // A healthy feed is not news. It must not claim a role="status", which
    // announces itself to a screen reader on every 5s refetch.
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("names the age of what you are reading when the refetch is failing", () => {
    render(<FeedStatus health={{ state: "stale", ageMs: 45_000 }} />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "not updating — showing data 45s old",
    );
  });

  it("rounds a long outage to minutes rather than counting seconds", () => {
    render(<FeedStatus health={{ state: "stale", ageMs: 20 * 60_000 }} />);
    expect(screen.getByRole("status")).toHaveTextContent("20m old");
  });

  it("says plainly that the backend is unreachable when there is no cache", () => {
    render(<FeedStatus health={{ state: "down", ageMs: 0 }} />);
    expect(screen.getByRole("status")).toHaveTextContent("cannot reach the backend");
  });
});
