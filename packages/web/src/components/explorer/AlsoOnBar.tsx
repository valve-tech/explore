import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { chainById, chainLogoUrl } from "../../lib/chains";
import { scanPath } from "../../lib/scanRoutes";
import { visibleChainIds } from "../../lib/settings/testnets";
import { fetchChainPresence, hasPresence } from "../../api/multichain";

/**
 * The slim form of the presence strip, for a page already scoped to one chain.
 *
 * Same data, same query key as the all-chain page — so opening a scoped page
 * after the aggregate one costs nothing. Renders nothing while probing and
 * nothing when there is only one chain to offer: a bar advertising no
 * alternatives is noise on every page that has none.
 */
interface Props {
  address: string;
  activeChainId: number;
}

export default function AlsoOnBar({ address, activeChainId }: Props) {
  const chainIds = visibleChainIds();
  const { data } = useQuery({
    queryKey: ["multichain-presence", address, chainIds],
    queryFn: () => fetchChainPresence(address, chainIds),
    staleTime: 60_000,
  });

  if (!data) return null;
  const present = data.filter(hasPresence);
  if (present.length < 2) return null;

  return (
    <div className="flex flex-wrap items-center gap-inline p-2 sm:p-4 theme-card-bg shadow-[0_0_0_1px_var(--color-border-default)]">
      <span className="theme-text-muted text-xs uppercase tracking-wide font-semibold">
        Also on
      </span>
      {present.map((p) => {
        const chain = chainById(p.chainId);
        const label = chain?.name ?? String(p.chainId);
        const art = (
          <img
            src={chainLogoUrl(p.chainId)}
            alt=""
            width={14}
            height={14}
            className={`size-[14px] shrink-0 rounded-full ${chain?.testnet ? "grayscale opacity-60" : ""}`}
          />
        );
        return p.chainId === activeChainId ? (
          <span
            key={p.chainId}
            className="inline-flex items-center gap-tight rounded px-2 py-0.5 theme-mono text-xs theme-text shadow-[0_0_0_1px_var(--color-accent)] bg-(--color-accent-muted)"
          >
            {art}
            {label}
          </span>
        ) : (
          <Link
            key={p.chainId}
            to={scanPath("address", address, p.chainId)}
            className="inline-flex items-center gap-tight rounded px-2 py-0.5 theme-mono text-xs theme-text shadow-[0_0_0_1px_var(--color-border-default)]"
          >
            {art}
            {label}
          </Link>
        );
      })}
      <Link
        to={scanPath("address", address)}
        className="rounded px-2 py-0.5 theme-mono text-xs theme-text-muted shadow-[0_0_0_1px_var(--color-border-muted)]"
      >
        all →
      </Link>
    </div>
  );
}
