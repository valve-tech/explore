import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import ChainPresenceStrip from "./MultiChainAddressView/ChainPresenceStrip";
import MergedActivityFeed from "./MultiChainAddressView/MergedActivityFeed";
import { fetchChainPresence, fetchMergedActivity } from "../../api/multichain";

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
  const presence = useQuery({
    queryKey: ["multichain-presence", address],
    queryFn: () => fetchChainPresence(address),
    staleTime: 60_000,
  });

  const activity = useQuery({
    queryKey: ["multichain-activity", address],
    queryFn: () => fetchMergedActivity(address),
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

  if (presence.isError) {
    return (
      <p className="p-2 sm:p-4 theme-danger theme-mono text-sm shadow-[0_0_0_1px_var(--color-danger)]">
        {(presence.error as Error).message}
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
        {activity.isLoading ? (
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
