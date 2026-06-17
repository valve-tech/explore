import { Tooltip } from "../../primitives/Tooltip";

/** Mono-styled button used in the step-debugger toolbar.
 *  `small` shrinks padding+font; `accent` swaps to the brand-accent palette;
 *  `disabled` dims the button and ignores clicks (used for nav back/forward
 *  at history bounds). */
export function ControlButton({
  label,
  title,
  onClick,
  small,
  accent,
  disabled,
}: {
  label: string;
  title: string;
  onClick: () => void;
  small?: boolean;
  accent?: boolean;
  disabled?: boolean;
}) {
  return (
    <Tooltip label={title}>
      <button
        onClick={onClick}
        disabled={disabled}
        aria-label={title}
        className="rounded font-mono font-semibold transition-colors"
        style={{
          padding: small ? "2px 6px" : "2px 10px",
          fontSize: small ? "10px" : "12px",
          backgroundColor: accent
            ? "var(--color-accent-muted)"
            : "var(--color-bg-secondary)",
          color: accent
            ? "var(--color-accent)"
            : "var(--color-text-primary)",
          boxShadow: "0 0 0 1px var(--color-border-default)",
          opacity: disabled ? 0.35 : 1,
          cursor: disabled ? "default" : "pointer",
        }}
      >
        {label}
      </button>
    </Tooltip>
  );
}
