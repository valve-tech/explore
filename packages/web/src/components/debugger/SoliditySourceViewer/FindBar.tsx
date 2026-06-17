import { Icon } from "@iconify/react";
import { type RefObject } from "react";
import { Tooltip } from "../../primitives/Tooltip";

/**
 * The Cmd/Ctrl+F bar that floats top-right of the source pane. Pure
 * presentational + callback-driven — all state lives in
 * `useFindInSource`.
 */
export interface FindBarProps {
  inputRef: RefObject<HTMLInputElement | null>;
  query: string;
  onQueryChange: (query: string) => void;
  activeMatch: number;
  matchCount: number;
  onStep: (dir: 1 | -1) => void;
  onClose: () => void;
}

export function FindBar({
  inputRef,
  query,
  onQueryChange,
  activeMatch,
  matchCount,
  onStep,
  onClose,
}: FindBarProps) {
  const counterText = matchCount
    ? `${activeMatch + 1}/${matchCount}`
    : query
    ? "0/0"
    : "";

  return (
    <div
      className="absolute top-2 right-3 z-20 flex items-center gap-tight px-2 py-1 card theme-secondary-bg"
      data-testid="find-bar"
    >
      <Icon
        icon="heroicons:magnifying-glass"
        className="w-3.5 h-3.5 flex-shrink-0 theme-text-muted"
      />
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onStep(e.shiftKey ? -1 : 1);
          } else if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
        }}
        placeholder="Find in source"
        className="bare-input bg-transparent outline-none text-xs theme-text theme-mono"
        style={{ width: 180 }}
        autoFocus
        aria-label="Find in source"
      />
      <span
        className="text-xs tabular-nums flex-shrink-0 theme-text-muted"
        style={{ minWidth: 44, textAlign: "right" }}
        data-testid="find-counter"
      >
        {counterText}
      </span>
      <Tooltip label="Previous match (Shift+Enter)" className="flex-shrink-0">
        <button
          onClick={() => onStep(-1)}
          className="flex-shrink-0 theme-text-muted"
          disabled={!matchCount}
          aria-label="Previous match"
        >
          <Icon icon="heroicons:chevron-up" className="w-3.5 h-3.5" />
        </button>
      </Tooltip>
      <Tooltip label="Next match (Enter)" className="flex-shrink-0">
        <button
          onClick={() => onStep(1)}
          className="flex-shrink-0 theme-text-muted"
          disabled={!matchCount}
          aria-label="Next match"
        >
          <Icon icon="heroicons:chevron-down" className="w-3.5 h-3.5" />
        </button>
      </Tooltip>
      <Tooltip label="Close (Esc)" className="flex-shrink-0">
        <button
          onClick={onClose}
          className="flex-shrink-0 theme-text-muted"
          aria-label="Close find"
        >
          <Icon icon="heroicons:x-mark" className="w-3.5 h-3.5" />
        </button>
      </Tooltip>
    </div>
  );
}
