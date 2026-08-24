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
    const perChain = activity.data?.perChain ?? [];
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
        ) : activity.isLoading ? (
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
