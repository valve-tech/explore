import EntityRow from "../../primitives/EntityRow";
import { chainById, chainLogoUrl } from "../../../lib/chains";
import { scanPath } from "../../../lib/scanRoutes";
import { formatNative } from "../format";
import { hasPresence, type ChainPresence } from "../../../api/multichain";

/**
 * "Where does this address live?" — the whole point of the chain-less address
 * page, and the component that pays for itself three times over: full size
 * here, slim on a scoped page, and the entire body of /block/<number>.
 *
 * Chains with no presence collapse into one line. Four registered chains used
 * to mean four rows even when two were empty, which pushed the actual answer
 * below the fold.
 *
 * An errored chain is NOT absent. "We could not reach Sepolia" and "this
 * address is not on Sepolia" are different facts, and showing the first as the
 * second tells the user something false.
 */
interface Props {
  address: string;
  rows: ChainPresence[];
  /** chainId → 0..1 share of recent activity, for the row fill. */
  shares: Record<number, number>;
}

export default function ChainPresenceStrip({ address, rows, shares }: Props) {
  const present = rows.filter(hasPresence);
  const errored = rows.filter((r) => r.error);
  const absent = rows.filter((r) => !hasPresence(r) && !r.error);

  if (present.length === 0 && errored.length === 0) {
    return (
      <p className="p-2 theme-text-muted theme-mono text-xs shadow-[0_0_0_1px_var(--color-border-muted)]">
        No activity on any chain we serve.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-px">
      {present.map((p) => {
        const chain = chainById(p.chainId);
        const share = shares[p.chainId];
        return (
          <EntityRow
            key={p.chainId}
            href={scanPath("address", address, p.chainId)}
            share={share}
            art={<ChainArt chainId={p.chainId} />}
            main={chain?.name ?? `Chain ${p.chainId}`}
            // `nonce` counts transactions SENT. A true total needs the archive,
            // so the label says what the number actually is.
            sub={`${p.isContract ? "Contract" : "EOA"} · ${p.nonce.toLocaleString()} sent`}
            right={formatNative(p.balance, p.chainId)}
            rightSub={share !== undefined ? `${Math.round(share * 100)}% of recent` : ""}
          />
        );
      })}

      {errored.map((p) => (
        <EntityRow
          key={p.chainId}
          tone="warn"
          art={<ChainArt chainId={p.chainId} />}
          main={chainById(p.chainId)?.name ?? `Chain ${p.chainId}`}
          sub="probe failed — unknown, not absent"
          right="unavailable"
        />
      ))}

      {absent.length > 0 && (
        <div className="flex flex-wrap items-center gap-inline p-2 theme-text-muted theme-mono text-xs shadow-[0_0_0_1px_var(--color-border-muted)]">
          <span className="uppercase tracking-wide font-semibold">Not here</span>
          {absent.map((p) => (
            <span key={p.chainId} className="inline-flex items-center gap-tight">
              <ChainArt chainId={p.chainId} dim />
              {chainById(p.chainId)?.name ?? p.chainId}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Chain art from gib.show. A fixed size and `shrink-0` keep the row from
 * reflowing when the image lands. Testnets are dimmed because /image/943
 * returns bytes identical to /image/369 — the testnet has no distinct logo, and
 * without the dimming it reads as PulseChain mainnet.
 */
function ChainArt({ chainId, dim = false }: { chainId: number; dim?: boolean }) {
  const chain = chainById(chainId);
  return (
    <img
      src={chainLogoUrl(chainId)}
      alt=""
      width={22}
      height={22}
      className={`size-[22px] shrink-0 rounded-full ${
        dim || chain?.testnet ? "grayscale opacity-60" : ""
      }`}
    />
  );
}
