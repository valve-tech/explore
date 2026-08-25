/**
 * Progressive feedback for the address workspace.
 *
 * A busy address takes 15–30s to answer. A bare spinner for that long tells the
 * user nothing, so this bar names every section and its state: what has landed,
 * what is still in flight, what gave up. It disappears once every section is
 * ready — a finished page carries no chrome.
 */

import {
  failedLabels,
  outstandingLabels,
  readyCount,
  type SectionSummary,
} from "./sectionState";

const DOT_CLASS: Record<string, string> = {
  loading: "theme-warning-bg",
  ready: "theme-success-bg",
  failed: "theme-danger-bg",
};

const STATUS_WORD: Record<string, string> = {
  loading: "loading",
  ready: "ready",
  failed: "failed",
};

export function LoadStatusBar({ sections }: { sections: SectionSummary[] }) {
  const outstanding = outstandingLabels(sections);
  const failed = failedLabels(sections);
  if (outstanding.length === 0 && failed.length === 0) return null;

  const ready = readyCount(sections);

  return (
    // Named, because the section loading cards are status regions too and a
    // caller — or a test — needs to mean this one.
    <div
      className="card p-2 sm:p-4"
      role="status"
      aria-live="polite"
      aria-label="Address load progress"
    >
      <div className="flex items-center gap-row">
        {outstanding.length > 0 && <div className="spinner shrink-0" />}
        <p className="text-sm theme-text">
          <span className="font-mono tabular-nums">
            {ready}/{sections.length}
          </span>{" "}
          sections ready
          {outstanding.length > 0 && (
            <span className="theme-text-secondary">
              {" "}
              — still loading {outstanding.join(", ")}
            </span>
          )}
        </p>
      </div>
      <ul className="mt-2 flex flex-wrap gap-inline">
        {sections.map((section) => (
          <li key={section.label} className="flex items-center gap-tight text-xs">
            <span
              className={`w-2 h-2 shrink-0 ${DOT_CLASS[section.state.status]}`}
              aria-hidden
            />
            <span className="theme-text-secondary">{section.label}</span>
            <span className="theme-text-muted">{STATUS_WORD[section.state.status]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
