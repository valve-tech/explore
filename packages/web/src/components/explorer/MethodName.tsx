import { useQuery } from "@tanstack/react-query";
import { lookupSignature } from "../../api/signatures";
import { Tooltip } from "../primitives/Tooltip";

/**
 * A method name that admits when it is a guess.
 *
 * 4byte.directory is a dictionary of every signature anyone registered, not a
 * record of what a contract compiled to, so most selectors carry several
 * entries. We printed the first entry as fact, which is how a list came to
 * say a transaction called `ijekfhacdgb()` — a gas-token-era name someone
 * brute-forced so its selector had leading zero bytes.
 *
 * The row keeps the name it always had and adds two quiet things: a dotted
 * underline, and a footnote-sized count. Both say "there is more here"
 * without competing with the name. The alternatives appear on hover. A
 * settled name renders as plain text — no underline, no count, nothing to
 * read past.
 *
 * **Reviewed against the rendered page on 2026-08-25, and the threshold
 * moved.** The first version marked every selector with more than one
 * registration: 77% of named Ethereum rows, 47% on chain 369. On the page
 * that was not a quiet caveat, it was wallpaper. In a 250-transaction sample
 * across all four chains, every marked row was ERC-20 `transfer`,
 * `transferFrom`, or a Uniswap V2 swap — names nobody doubts. The one row
 * that was genuinely wrong, `atInversebrah(…)` on a contract deployment, wore
 * the identical superscript 6 as `transfer(address,uint256)` three rows above
 * it. At 375px it wore less than that: the long mined name truncated and took
 * its own marker off screen, so the treatment was strongest on the rows least
 * in doubt.
 *
 * The count now arrives already reduced. `summarizeMatches` on the server
 * vouches for canonical signatures and reports 1 for them, so `> 1` here
 * means the name really is a guess. The component did not have to change —
 * the fix was to stop feeding it a number that meant nothing.
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
  /**
   * How many candidate signatures leave `label` in doubt — 1 when the name is
   * settled, not the raw number of 4byte registrations. Optional: a row
   * served from IndexedDB predates the field, so `undefined` reaches here for
   * real.
   */
  candidates?: number;
}) {
  // An absent count is handled FIRST and on its own line. The count is
  // missing from any response this browser cached before the field existed,
  // and TanStack Query persists those to IndexedDB with
  // `staleTime: Infinity` — so `undefined` arrives here for real. Folding it
  // into a `<= 1` test would not catch it (`undefined <= 1` is false) and
  // every stale row would render as "a guess of undefined candidates".
  // Not marking is the safe direction.
  if (candidates === undefined || candidates <= 1 || !selector) {
    return <>{label}</>;
  }

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
