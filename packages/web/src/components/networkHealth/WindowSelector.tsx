/**
 * Block-window picker. The default view stays small (64) so a cold load is
 * cheap, but a user — often pointed at their own node via the RPC override — can
 * widen to thousands of blocks. Larger windows warm lazily and cache, so the
 * cost is opt-in. Must not exceed the API's MAX_LIMIT (2048).
 */
const WINDOWS = [64, 256, 512, 1024, 2048] as const;

export function WindowSelector({
  value,
  onChange,
  busy = false,
}: {
  value: number;
  onChange: (n: number) => void;
  busy?: boolean;
}) {
  return (
    <div className="inline-flex items-center gap-tight">
      <span className="text-xs uppercase tracking-wide theme-text-muted">
        window
      </span>
      <div className="inline-flex bs-in-muted">
        {WINDOWS.map((w) => {
          const active = w === value;
          return (
            <button
              key={w}
              type="button"
              onClick={() => onChange(w)}
              disabled={busy && !active}
              aria-pressed={active}
              className={`px-2.5 py-1 text-xs theme-mono transition-colors ${
                active
                  ? "theme-accent-bg theme-accent"
                  : "theme-text-secondary hover:theme-text disabled:opacity-40"
              }`}
            >
              {w.toLocaleString()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
