import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import ChainPresenceStrip from "./MultiChainAddressView/ChainPresenceStrip";
import MergedActivityFeed from "./MultiChainAddressView/MergedActivityFeed";
import { fetchChainPresence, fetchMergedActivity } from "../../api/multichain";
import { useShowTestnets, visibleChainIds } from "../../lib/settings/testnets";

/**
 * The chain-less address page — `/address/0x…` with no chain named.
 *
 * This page is TERMINAL. It does not resolve to a chain and it does not
 * redirect, because "which chain is this address on?" is the wrong question: an
 * address is valid on all of them. The page answers the right question instead,
 * which is where the address has presence.
 *
 * Two queries, in sequence by design. The cheap presence probe decides which
 * chains are worth the expensive activity fetch, so a typical address costs
 * four cheap calls plus one or two real ones rather than four of each.
 */
interface Props {
  address: string;
}

export default function MultiChainAddressView({ address }: Props) {
  // The visible chain set follows the global testnet toggle. It sits in the
  // query key so flipping the toggle refetches, rather than serving a stale
  // four-chain answer cached under the old key.
  const [showTestnets] = useShowTestnets();
  // visibleChainIds() reads the same store `showTestnets` subscribes to, so
  // that dep is the real trigger even though eslint cannot see the link.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const chainIds = useMemo(() => visibleChainIds(), [showTestnets]);

  const presence = useQuery({
    queryKey: ["multichain-presence", address, chainIds],
    queryFn: () => fetchChainPresence(address, chainIds),
    staleTime: 60_000,
  });

  const activity = useQuery({
    queryKey: ["multichain-activity", address, chainIds],
    queryFn: () => fetchMergedActivity(address, chainIds),
    enabled: presence.isSuccess,
    staleTime: 60_000,
  });

  /**
   * Share of recent activity per chain, from the row counts the backend already
   * reports. Derived in render — never stored in a ref or an effect.
   */
  const shares = useMemo<Record<number, number>>(() => {
    // Chains whose activity fetch FAILED are dropped from both the total and
    // the result, so they end up with no entry at all. That matters: a share
    // of 0 is a finite number, and `EntityRow` only withholds the fill for a
    // non-finite one — so folding an errored chain in at `returned: 0` made
    // the strip claim "0% of recent" for a chain we never actually reached,
    // while the footer below it said that same chain was excluded. Two
    // contradictory statements about one chain, on one screen.
    //
    // Absent is the honest answer here: "we do not know", not "we know it is
    // zero". This is the same not-here-versus-could-not-check distinction the
    // presence strip makes; it has to hold on the activity path too.
    const perChain = (activity.data?.perChain ?? []).filter((p) => !p.error);
    const total = perChain.reduce((sum, p) => sum + p.returned, 0);
    if (total === 0) return {};
    return Object.fromEntries(perChain.map((p) => [p.chainId, p.returned / total]));
  }, [activity.data]);

  // Presence failing is fatal to the whole page — without it there is
  // nothing to scope the activity fetch to, so the page has no honest content
  // left to show.
  if (presence.isError) {
    return (
      <p className="p-2 sm:p-4 theme-danger theme-mono text-sm shadow-[0_0_0_1px_var(--color-danger)]">
        Could not check chain presence: {(presence.error as Error).message}
      </p>
    );
  }

  return (
    <div className="space-y-stack">
      {/*
       * Name the subject. This view returns before `ExplorerPanel` renders its
       * breadcrumb, so without this heading the address appeared NOWHERE on
       * its own page — every row named a chain, and nothing named what the
       * page was about. `break-all` because a 42-character address has to
       * wrap at 375px rather than clip its tail, which is the half that
       * identifies it.
       */}
      <header className="p-2 sm:p-4 shadow-[0_0_0_1px_var(--color-border-default)]">
        <div className="theme-text-muted text-xs uppercase tracking-wide">
          Address · all chains
        </div>
        <div className="theme-mono theme-text text-sm break-all">{address}</div>
      </header>

      <section>
        <h2 className="theme-text-muted text-xs uppercase tracking-wide font-semibold pb-1">
          Where this address lives
        </h2>
        {presence.isLoading ? (
          <p className="p-2 theme-text-muted theme-mono text-xs">Probing every chain…</p>
        ) : (
          <ChainPresenceStrip address={address} rows={presence.data ?? []} shares={shares} />
        )}
      </section>

      <section>
        <h2 className="theme-text-muted text-xs uppercase tracking-wide font-semibold pb-1">
          Activity · all chains
        </h2>
        {/* A failed activity fetch is NOT "no activity" — the presence strip
            above already distinguishes "not here" from "could not check", and
            the activity feed must keep that same distinction. Falling through
            to an empty result here would render as a false "no history"
            claim, exactly the failure mode this page exists to avoid. */}
        {activity.isError ? (
          <p className="p-2 theme-danger theme-mono text-xs shadow-[0_0_0_1px_var(--color-danger)]">
            Could not load activity: {(activity.error as Error).message}
          </p>
        ) : activity.isPending ? (
          // isPending, not isLoading: this query is `enabled: presence.isSuccess`,
          // and TanStack Query reports isLoading === false for a disabled query
          // (isLoading is isPending && isFetching, and a disabled query never
          // fetches). Checking isLoading let the ternary fall through to the
          // "no activity" branch while presence was still probing — a definitive
          // claim rendered under a page still admitting it hasn't looked yet.
          // isPending stays true until real data (or an error) lands, so it
          // covers both "waiting on presence" and "activity itself is fetching".
          <p className="p-2 theme-text-muted theme-mono text-xs">Merging recent activity…</p>
        ) : (
          <MergedActivityFeed
            address={address}
            activity={activity.data ?? { rows: [], perChain: [] }}
          />
        )}
      </section>
    </div>
  );
}
