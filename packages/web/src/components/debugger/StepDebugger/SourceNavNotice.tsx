import type { NavTarget } from "./sourceNav/navTypes";
import { describeTarget } from "./sourceNav/describeAction";
import type { SourceNavNotice as Notice } from "./useSourceClickNav";

/**
 * Strip above the source pane. It shows the list of definitions of an
 * alt-click, or a note such as "only the interface declaration is available".
 */
export function SourceNavNotice({
  notice,
  onPick,
  onDismiss,
}: {
  notice: Notice;
  onPick: (target: NavTarget) => void;
  onDismiss: () => void;
}) {
  return (
    <div
      role="status"
      className="w-full text-xs p-2 theme-mono theme-text-secondary"
      style={{ backgroundColor: "var(--color-bg-secondary)", boxShadow: "0 1px 0 0 var(--color-border-default)" }}
    >
      <div className="flex items-center gap-inline">
        <span className="flex-1">
          {notice.targets
            ? `${notice.targets.length} definition${notice.targets.length === 1 ? "" : "s"} of ${notice.label}`
            : `${notice.label}: ${notice.note}`}
        </span>
        <button onClick={onDismiss} className="theme-text-muted" style={{ cursor: "pointer" }} aria-label="Dismiss">
          ×
        </button>
      </div>
      {notice.targets?.map((t, i) => (
        <button
          key={`${t.addr ?? ""}:${t.file}:${t.line}`}
          onClick={() => onPick(t)}
          className="block w-full text-left py-0.5 hover:underline theme-text"
          style={{ cursor: "pointer" }}
        >
          <span className={t.hasBody ? "theme-accent" : "theme-text-muted"}>{i + 1}.</span> {describeTarget(t)}
        </button>
      ))}
    </div>
  );
}
