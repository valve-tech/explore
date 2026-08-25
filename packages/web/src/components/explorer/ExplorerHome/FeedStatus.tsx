import { Icon } from "@iconify/react";

/**
 * Whether the page is still hearing from the backend.
 *
 * This exists because of a specific, measured failure. The home page's three
 * queries use `staleTime: Infinity` and persist to IndexedDB, so on a return
 * visit React Query serves the cache immediately and refetches behind it. An
 * audit forced all four endpoints to 500 with a warm cache: the page rendered
 * a full, plausible list of blocks and transactions — real hashes, real
 * numbers — while thirty fetches failed silently in fifteen seconds. A live
 * outage looked exactly like a working explorer, indefinitely.
 *
 * A blockchain explorer showing confidently wrong data is worse than one
 * showing an error, because the whole reason to open it is to trust what it
 * says. So when the refetch is failing, the page says so, and says how old
 * what you are reading actually is.
 *
 * Three states, and the middle one is the point:
 *   live     — the last fetch succeeded.
 *   stale    — we have data, but the refetch is failing. Named and dated.
 *   down     — the fetch is failing and there is nothing cached to show.
 */
export type FeedState = "live" | "stale" | "down";

export interface FeedHealth {
  state: FeedState;
  /** ms since the newest successful fetch across the feeds. 0 when never. */
  ageMs: number;
}

/**
 * Fold several queries into one health verdict, worst case wins.
 *
 * Pure, and takes plain values rather than query objects so it can be tested
 * without a QueryClient. `isError` in TanStack v5 stays true while cached
 * `data` is still served, which is exactly the "stale" case — the two flags
 * together are what distinguishes it from a cold failure.
 */
export function feedHealth(
  feeds: { isError: boolean; hasData: boolean; dataUpdatedAt: number }[],
  now: number,
): FeedHealth {
  const failing = feeds.filter((f) => f.isError);
  const newest = Math.max(0, ...feeds.map((f) => f.dataUpdatedAt));
  if (failing.length === 0) return { state: "live", ageMs: 0 };
  // Any cached data at all means the screen is showing something, and the
  // honest complaint is its age — not that the page is empty.
  const anyData = feeds.some((f) => f.hasData);
  return {
    state: anyData ? "stale" : "down",
    ageMs: newest > 0 ? Math.max(0, now - newest) : 0,
  };
}

/** Coarse age. Precision past a minute is not the point; the alarm is. */
function agoLabel(ms: number): string {
  if (ms <= 0) return "unknown age";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s old`;
  if (s < 3600) return `${Math.floor(s / 60)}m old`;
  return `${Math.floor(s / 3600)}h old`;
}

export function FeedStatus({ health }: { health: FeedHealth }) {
  if (health.state === "live") {
    return (
      <span className="flex items-center gap-tight text-xs theme-text-muted">
        <span
          aria-hidden="true"
          className="size-1.5 shrink-0 bg-(--color-success)"
        />
        live
      </span>
    );
  }

  const down = health.state === "down";
  return (
    <span
      role="status"
      className={`flex items-center gap-tight text-xs ${
        down ? "theme-danger" : "theme-warning"
      }`}
    >
      <Icon
        icon="heroicons:exclamation-triangle"
        className="w-3.5 h-3.5 shrink-0"
        aria-hidden="true"
      />
      {down
        ? "cannot reach the backend"
        : `not updating — showing data ${agoLabel(health.ageMs)}`}
    </span>
  );
}
