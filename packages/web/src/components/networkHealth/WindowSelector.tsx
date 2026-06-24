import { WINDOW_OPTIONS } from "../../lib/networkHealthWindow";

/**
 * Block-window picker. The default view stays small so a cold load is cheap, but
 * a user — often pointed at their own node via the RPC override — can widen to
 * thousands of blocks. The options come from the shared `networkHealthWindow`
 * source of truth so they can't drift from the page default or the BYO ceiling.
 */

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
        {WINDOW_OPTIONS.map((w) => {
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
