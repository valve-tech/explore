import { Skeleton } from "../primitives/Skeleton";

/**
 * Placeholder that mirrors the network-health data layout (summary cards →
 * lenses → heatmap → block table) so the page holds its shape while a chain's
 * window loads. Shown on first load and when the active chain changes, so stale
 * numbers from the previous chain never flash next to the new chain's symbol.
 */
export function NetworkHealthSkeleton() {
  return (
    <div className="space-y-section" aria-busy="true">
      {/* Summary cards — 4 stat tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-row">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card p-4 space-y-stack">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-7 w-20" />
            <Skeleton className="h-3 w-28" />
          </div>
        ))}
      </div>

      {/* Two lens panels */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-row">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="card p-4 space-y-stack">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-3 w-3/4" />
          </div>
        ))}
      </div>

      {/* Position heatmap */}
      <div className="card p-4 space-y-stack">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-16 w-full" />
      </div>

      {/* Block table — header + rows */}
      <div className="card p-4 space-y-row">
        <Skeleton className="h-4 w-full" style={{ opacity: 0.5 }} />
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-6 w-full" />
        ))}
      </div>
    </div>
  );
}
