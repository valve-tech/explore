import type { TimeDisplay } from "../../lib/format/time";
import { useTimeDisplay } from "../../lib/settings/timeDisplay";

const OPTIONS: { mode: TimeDisplay; label: string }[] = [
  { mode: "relative", label: "Relative" },
  { mode: "absolute", label: "UTC date" },
  { mode: "both", label: "Both" },
];

/**
 * The time-display switch: a row of radio buttons, never a native select —
 * native form controls are banned here because the browser owns their look.
 * `gap-px` keeps two outset outlines from stacking into a 2px line.
 */
export default function TimeDisplayPicker() {
  const [mode, setMode] = useTimeDisplay();

  return (
    <span role="radiogroup" aria-label="Time display" className="inline-flex gap-px">
      {OPTIONS.map((o) => (
        <button
          key={o.mode}
          type="button"
          role="radio"
          aria-checked={mode === o.mode}
          onClick={() => setMode(o.mode)}
          className={`px-2 py-0.5 theme-mono text-xs shadow-[0_0_0_1px_var(--color-border-default)] ${
            mode === o.mode ? "bg-(--color-accent-muted) theme-text" : "theme-text-secondary"
          }`}
        >
          {o.label}
        </button>
      ))}
    </span>
  );
}
