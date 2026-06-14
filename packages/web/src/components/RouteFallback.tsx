/**
 * Suspense fallback for lazy-loaded routes. Mirrors the in-page loading
 * pattern used across views (accent spinner + secondary text) so a chunk
 * fetch is visually indistinguishable from a data fetch.
 */
export default function RouteFallback() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[300px] p-4">
      <div className="spinner mb-3" />
      <span className="text-sm theme-text-secondary">Loading…</span>
    </div>
  );
}
