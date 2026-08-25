import { useQuery } from "@tanstack/react-query";
import { lookupSignature } from "../../api/signatures";
import { Tooltip } from "../primitives/Tooltip";

/**
 * A method name that admits when it is a guess.
 *
 * 4byte.directory is a dictionary of every signature anyone registered, not a
 * record of what a contract compiled to, so most selectors carry several
 * entries. Measured against production: of the Ethereum transactions that
 * resolve to a name at all, 77% have more than one candidate; on chain 369 it
 * is 47%. We printed the first entry as fact, which is how a list came to say
 * a transaction called `ijekfhacdgb()` — a gas-token-era name someone
 * brute-forced so its selector had leading zero bytes.
 *
 * At three names in four, the marker cannot shout. A loud badge on nearly
 * every row is noise a reader learns to skip, and then it flags nothing. So
 * the row keeps the name it always had and adds two quiet things: a dotted
 * underline, and a footnote-sized count. Both say "there is more here"
 * without competing with the name. The alternatives appear on hover.
 *
 * A single confident match renders as plain text — no underline, no count,
 * nothing to read past.
 */
export function MethodName({
  label,
  selector,
  candidates,
}: {
  /** The name to show, ready to display (`swap()`, `transfer(address,uint256)`). */
  label: string;
  /** The 4-byte selector, used to fetch the alternatives on hover. */
  selector: string;
  /** How many candidate signatures the selector has. */
  candidates: number;
}) {
  // `> 1`, never `<= 1`. The count is absent from any response this browser
  // cached before the field existed, and TanStack Query persists those to
  // IndexedDB with `staleTime: Infinity` — so `undefined` arrives here for
  // real. `undefined <= 1` is false, which would have marked every stale row
  // as a guess of `undefined` candidates. Not marking is the safe direction.
  if (!(candidates > 1) || !selector) return <>{label}</>;

  return (
    <Tooltip label={<CandidateList selector={selector} shown={label} count={candidates} />}>
      <span className="theme-text-muted">
        <span className="underline decoration-dotted underline-offset-2 cursor-help">
          {label}
        </span>
        <sup className="ml-0.5 text-[9px] tabular-nums">{candidates}</sup>
        {/*
          The dotted underline and the count are visual. A reader who never
          hovers — and a screen reader, which cannot — still needs the caveat,
          and this row sits inside a link, so a focusable trigger would add a
          tab stop to every row in the list.
        */}
        <span className="sr-only">
          {` — one of ${candidates} candidate signatures for ${selector}`}
        </span>
      </span>
    </Tooltip>
  );
}

/** How many alternatives the bubble lists before it stops. */
const MAX_SHOWN = 8;
/** Longest signature the bubble prints whole. */
const MAX_CHARS = 52;

/**
 * The candidate list, fetched when the tooltip opens.
 *
 * `Tooltip` mounts its `label` only while the bubble is open, so this
 * component — and its query — exist only once someone hovers. That is the
 * whole reason the list is not on the wire: the row carries one integer, and
 * the ten signatures behind it cost nothing until a reader asks for them.
 */
function CandidateList({
  selector,
  shown,
  count,
}: {
  selector: string;
  shown: string;
  count: number;
}) {
  const query = useQuery({
    queryKey: ["signature-candidates", selector],
    queryFn: () => lookupSignature(selector),
    staleTime: Infinity,
  });

  const signatures = query.data?.map((m) => m.textSignature) ?? [];

  return (
    <span className="flex flex-col gap-tight text-left">
      <span className="theme-text-muted">
        {`${count} signatures share ${selector} — we show the first`}
      </span>
      {query.isPending && <span className="theme-text-muted">Loading…</span>}
      {query.isError && (
        <span className="theme-warning">Could not load the alternatives.</span>
      )}
      {signatures.slice(0, MAX_SHOWN).map((sig, i) => (
        <span key={sig} className={i === 0 ? "theme-text" : "theme-text-secondary"}>
          {truncate(sig)}
          {i === 0 && <span className="theme-text-muted"> · shown</span>}
        </span>
      ))}
      {signatures.length > MAX_SHOWN && (
        <span className="theme-text-muted">{`+${signatures.length - MAX_SHOWN} more`}</span>
      )}
      {query.isSuccess && signatures.length === 0 && (
        <span className="theme-text-muted">{shown}</span>
      )}
    </span>
  );
}

function truncate(sig: string): string {
  return sig.length <= MAX_CHARS ? sig : `${sig.slice(0, MAX_CHARS - 1)}…`;
}
