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
 */
export interface EntityRowProps {
  art?: ReactNode;
  main: ReactNode;
  sub: ReactNode;
  right?: ReactNode;
  rightSub?: ReactNode;
  /** 0..1. Clamped — a caller dividing by a zero total must not emit NaN%. */
  share?: number;
  tint?: string;
  href?: string;
  tone?: "default" | "warn";
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
}: EntityRowProps) {
  const outline =
    tone === "warn"
      ? "shadow-[0_0_0_1px_var(--color-warning)]"
      : "shadow-[0_0_0_1px_var(--color-border-default)]";

  const body = (
    <>
      {share !== undefined && (
        <span
          data-testid="row-fill"
          aria-hidden="true"
          className="absolute inset-y-0 left-0 pointer-events-none opacity-15"
          style={{
            width: `${Math.round(Math.min(1, Math.max(0, share)) * 100)}%`,
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
        <span className="relative min-w-0 flex flex-col text-right">
          <span className="theme-text theme-mono text-xs tabular-nums">{right}</span>
          <span className="theme-text-muted theme-mono text-xs">{rightSub}</span>
        </span>
      )}
    </>
  );

  const className =
    `relative overflow-hidden flex items-center gap-inline p-2 theme-card-bg ${outline} ` +
    (href ? "hover:shadow-[0_0_0_1px_var(--color-accent)]" : "");

  return href ? (
    <Link to={href} className={className}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}
