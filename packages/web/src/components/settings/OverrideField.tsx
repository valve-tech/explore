/**
 * A URL input with its Set and Clear buttons, and the error below it.
 * The backend origin and every chain endpoint use this one field.
 */
export function OverrideField({
  draft,
  onDraft,
  onApply,
  onClear,
  canClear,
  error,
  placeholder,
}: {
  draft: string;
  onDraft: (value: string) => void;
  onApply: () => void;
  onClear: () => void;
  canClear: boolean;
  error: string | null;
  placeholder: string;
}) {
  return (
    <div className="flex flex-col gap-tight min-w-0">
      {/* A 4px gap keeps the three outset outlines apart. */}
      <div className="flex items-stretch gap-tight">
        <input
          type="text"
          value={draft}
          onChange={(e) => onDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onApply();
          }}
          placeholder={placeholder}
          aria-invalid={error !== null}
          className={`flex-1 min-w-0 px-2 py-1.5 text-xs theme-mono theme-input-bg theme-text ${
            error
              ? "shadow-[0_0_0_1px_var(--color-danger)]"
              : "shadow-[0_0_0_1px_var(--color-border-default)]"
          }`}
        />
        <button
          type="button"
          onClick={onApply}
          className="px-3 text-xs font-medium theme-accent-solid text-white hover:opacity-90 shrink-0"
        >
          Set
        </button>
        <button
          type="button"
          onClick={onClear}
          disabled={!canClear}
          className={`px-3 text-xs font-medium shrink-0 shadow-[0_0_0_1px_var(--color-border-default)] ${
            canClear
              ? "theme-secondary-bg theme-text hover:opacity-90"
              : "theme-text-muted opacity-50 cursor-not-allowed"
          }`}
        >
          Clear
        </button>
      </div>
      {error && <div className="text-xs theme-danger">{error}</div>}
    </div>
  );
}
