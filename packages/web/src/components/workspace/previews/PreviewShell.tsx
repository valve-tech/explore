import type { ReactNode } from "react";

/**
 * Shared layout for the three per-kind preview cards. Encodes the "small,
 * scannable, 3–5 facts" shape — every preview is the same height, same
 * typography, same status/loading affordance — so a Workspace with a dozen
 * mixed items reads as a uniform grid when everything's expanded.
 *
 * Each fact is a single label/value pair. Facts with a null value render as
 * "—" so the layout doesn't shift when an item lacks an optional field.
 */

export function PreviewShell({
  loading,
  error,
  facts,
  footer,
}: {
  loading?: boolean;
  error?: string | null;
  facts: ReadonlyArray<{ label: string; value: ReactNode | null; mono?: boolean }>;
  footer?: ReactNode;
}) {
  if (loading) {
    return <div className="text-xs theme-text-muted">Loading preview…</div>;
  }
  if (error) {
    return (
      <div className="text-xs theme-warning">
        {error}
      </div>
    );
  }
  return (
    <>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-row gap-y-1 text-xs">
        {facts.map((f) => (
          <div key={f.label} className="contents">
            <dt className="theme-text-muted">{f.label}</dt>
            <dd className={f.mono ? "font-mono theme-text break-all" : "theme-text"}>
              {f.value ?? <span className="theme-text-muted">—</span>}
            </dd>
          </div>
        ))}
      </dl>
      {footer && <div className="mt-2 pt-2 text-[11px] theme-text-muted" style={{ borderTop: "1px solid var(--color-border-muted)" }}>{footer}</div>}
    </>
  );
}

export function shortHex(s: string, leading = 8, trailing = 6): string {
  if (s.length <= leading + trailing + 1) return s;
  return `${s.slice(0, leading)}…${s.slice(-trailing)}`;
}

export function ago(epochSeconds: number): string {
  const d = Math.max(0, Math.floor(Date.now() / 1000 - epochSeconds));
  if (d < 60) return `${d}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}
