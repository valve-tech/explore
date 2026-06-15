/**
 * A small "ⓘ" affordance that reveals an explanation on hover/focus. Used to
 * attach the fee equations to each metric inline. The popover overrides the
 * uppercase/tracking context of card labels so equations read normally.
 */
export function InfoTip({
  children,
  label = "explanation",
}: {
  children: React.ReactNode;
  label?: string;
}) {
  return (
    <span className="group relative inline-block align-middle">
      <button
        type="button"
        aria-label={label}
        className="cursor-help select-none theme-text-muted hover:theme-text"
      >
        ⓘ
      </button>
      <span
        role="tooltip"
        className="pointer-events-none invisible absolute left-0 top-full z-50 mt-1 w-72 card p-2 text-xs font-normal normal-case leading-relaxed tracking-normal opacity-0 transition-opacity group-hover:visible group-hover:opacity-100"
      >
        {children}
      </span>
    </span>
  );
}

/** Inline monospace fragment for equations inside a tooltip. */
export function Eq({ children }: { children: React.ReactNode }) {
  return <code className="theme-mono theme-text">{children}</code>;
}
