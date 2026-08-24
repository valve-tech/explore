import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import EntityRow from "../primitives/EntityRow";
import { chainById, chainLogoUrl } from "../../lib/chains";
import { scanPath } from "../../lib/scanRoutes";
import { useShowTestnets, visibleChainIds } from "../../lib/settings/testnets";
import { fetchBlockAtHeight } from "../../api/multichain";

/**
 * `/block/<number>` with no chain named.
 *
 * A height is not chain-locatable: every chain past it has a block there. So
 * this page reports the height on each chain rather than silently picking one.
 * Third use of the same two-line row — here the fill carries gas used, which
 * makes a full block and an empty one distinguishable at a glance.
 */
export default function BlockHeightView({ height }: { height: string }) {
  // The visible chain set follows the global testnet toggle. It sits in the
  // query key so flipping the toggle refetches, rather than serving a stale
  // four-chain answer cached under the old key.
  const [showTestnets] = useShowTestnets();
  // visibleChainIds() reads the same store `showTestnets` subscribes to, so
  // that dep is the real trigger even though eslint cannot see the link.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const chainIds = useMemo(() => visibleChainIds(), [showTestnets]);

  const { data } = useQuery({
    queryKey: ["multichain-block", height, chainIds],
    queryFn: () => fetchBlockAtHeight(height, chainIds),
    staleTime: 60_000,
  });

  if (!data) {
    return <p className="p-2 theme-text-muted theme-mono text-xs">Checking every chain…</p>;
  }

  const reached = data.filter((b) => b.reached);
  const notReached = data.filter((b) => !b.reached);

  return (
    <div className="flex flex-col gap-px">
      {reached.map((b) => {
        const chain = chainById(b.chainId);
        const used = Number(b.gasUsed ?? 0);
        const limit = Number(b.gasLimit ?? 0);
        return (
          <EntityRow
            key={b.chainId}
            href={scanPath("block", height, b.chainId)}
            ariaLabel={chain?.name ?? String(b.chainId)}
            share={limit > 0 ? used / limit : undefined}
            art={
              <img
                src={chainLogoUrl(b.chainId)}
                alt=""
                width={22}
                height={22}
                className={`size-[22px] shrink-0 rounded-full ${chain?.testnet ? "grayscale opacity-60" : ""}`}
              />
            }
            main={chain?.name ?? String(b.chainId)}
            sub={`${b.hash?.slice(0, 10) ?? "—"} · ${(used / 1e6).toFixed(1)}M / ${(limit / 1e6).toFixed(0)}M gas`}
            right={`${b.txCount ?? 0} txs`}
          />
        );
      })}

      {notReached.length > 0 && (
        <div className="flex flex-wrap items-center gap-inline p-2 theme-text-muted theme-mono text-xs shadow-[0_0_0_1px_var(--color-border-muted)]">
          <span className="uppercase tracking-wide font-semibold">Not reached</span>
          {notReached.map((b) => (
            <span key={b.chainId}>
              {chainById(b.chainId)?.name ?? b.chainId}
              {b.error ? " · unavailable" : ` · head ${(b.head ?? 0).toLocaleString()}`}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
