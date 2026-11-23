import { Shortcut } from "./Shortcut";
import { SOURCE_CLICK_MAP } from "./sourceNav/describeAction";

/** Inline help bar at the bottom of the debugger listing all keyboard shortcuts. */
export function ShortcutsHelp() {
  return (
    <div
      className="flex flex-wrap gap-4 px-4 py-2 card text-xs"
      style={{
        backgroundColor: "var(--color-bg-card)",
        boxShadow: "0 0 0 1px var(--color-border-default)",
        color: "var(--color-text-muted)",
      }}
    >
      <Shortcut keys="← →" label="Step" />
      <Shortcut keys="Space" label="Forward" />
      <Shortcut keys="Home/End" label="Jump" />
      <Shortcut keys="⌘[" label="Back" />
      <Shortcut keys="⌘]" label="Forward" />
      <Shortcut keys="C" label="Next CALL" />
      <Shortcut keys="S" label="Next SSTORE" />
      <Shortcut keys="L" label="Next LOG" />
      {/* Source pane click map — one action per element. Keywords, literals
          and comments do nothing. */}
      {SOURCE_CLICK_MAP.map((s) => (
        <Shortcut key={s.keys} keys={s.keys} label={s.label} />
      ))}
    </div>
  );
}
