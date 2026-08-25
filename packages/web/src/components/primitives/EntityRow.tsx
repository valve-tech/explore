import { type ReactNode } from "react";
import { Link } from "react-router-dom";

/**
 * The two-line row used by every multichain list: the chain presence strip, the
 * merged activity feed, and the block-height page.
 *
 * Two lines, never three. The main line carries the answer; the subline carries
 * the qualifiers. Anything further belongs in a Tooltip, not a third line — a
 * three-line row makes a list of four chains taller than the screen and buries
 * the comparison the list exists to support.
 *
 * `share` fills the row's own background rather than adding a bar column. The
 * ranking then reads before any digit does, and it costs neither a column nor a
 * line. Activity share on the address page; gas used on the block page.
 *
 * `ariaLabel` overrides the row's computed accessible name. The default —
 * `main` + `sub` + `right` concatenated, since `href` wraps the whole row in
 * one link — reads as noise ("PulseChain0x8f21 · 22.2M / 30M gas142 txs") and
 * cannot disambiguate two rows sharing a `main` prefix ("PulseChain" vs
 * "PulseChain Testnet v4"). Pass it whenever a caller needs a clean name, such
 * as one to link against by chain.
 */
export interface EntityRowProps {
  art?: ReactNode;
  main: ReactNode;
  sub: ReactNode;
  right?: ReactNode;
  rightSub?: ReactNode;
  /** 0..1. A caller computing share via division with total 0 produces NaN — the fill
   * renders only when share is a finite number. A finite share outside 0..1 is
   * clamped; undefined share produces no fill. */
  share?: number;
  tint?: string;
  href?: string;
  tone?: "default" | "warn";
  ariaLabel?: string;
}

export default function EntityRow({
  art,
  main,
  sub,
  right,
  rightSub,
  share,
  tint,
  href,
  tone = "default",
  ariaLabel,
}: EntityRowProps) {
  const outline =
    tone === "warn"
      ? "shadow-[0_0_0_1px_var(--color-warning)]"
      : "shadow-[0_0_0_1px_var(--color-border-default)]";

  const ratio = typeof share === "number" && Number.isFinite(share)
    ? Math.min(1, Math.max(0, share))
    : null;

  const body = (
    <>
      {ratio !== null && (
        <span
          data-testid="row-fill"
          aria-hidden="true"
          className="absolute inset-y-0 left-0 pointer-events-none opacity-15"
          style={{
            width: `${Math.round(ratio * 100)}%`,
            backgroundColor: tint ?? "var(--color-accent)",
          }}
        />
      )}
      {art !== undefined && <span className="relative shrink-0">{art}</span>}
      <span className="relative min-w-0 flex flex-col">
        <span className="theme-text text-sm truncate">{main}</span>
        <span className="theme-text-muted theme-mono text-xs truncate">{sub}</span>
      </span>
      {(right !== undefined || rightSub !== undefined) && (
        /*
         * `shrink-0`, not `min-w-0`. The right column carries short, whole
         * values — a count, an amount, a block number — and the left column
         * carries a hash that already truncates gracefully through
         * `MiddleTruncate`. Sharing the squeeze between them clipped the
         * short values instead: the explorer home page rendered
         * "#27,372…" for a block number and "0.0₇2 …" for an amount, cutting
         * exactly the digits that carried the meaning. Let the hash absorb it.
         */
        <span className="relative shrink-0 flex flex-col text-right">
          <span className="theme-text theme-mono text-xs tabular-nums">{right}</span>
          <span className="theme-text-muted theme-mono text-xs tabular-nums">{rightSub}</span>
        </span>
      )}
    </>
  );

  const className =
    `relative overflow-hidden flex items-center gap-inline p-2 theme-card-bg ${outline} ` +
    (href ? "hover:shadow-[0_0_0_1px_var(--color-accent)]" : "");

  return href ? (
    <Link to={href} className={className} aria-label={ariaLabel}>
      {body}
    </Link>
  ) : (
    <div className={className} aria-label={ariaLabel}>
      {body}
    </div>
  );
}
