import { Icon } from "@iconify/react";
import { Tooltip } from "../primitives/Tooltip";

/**
 * The info button that opens and closes a list of facts. The parent owns the
 * state, because the button sits in a header and the list sits below it.
 */
export function InfoButton({
  open,
  onToggle,
  label = "How this works",
}: {
  open: boolean;
  onToggle: () => void;
  label?: string;
}) {
  return (
    <Tooltip label={label}>
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={onToggle}
        className={`flex items-center justify-center w-6 h-6 hover:opacity-80 ${
          open ? "theme-accent" : "theme-text-muted"
        }`}
      >
        <Icon icon="heroicons:information-circle" className="w-4 h-4" />
      </button>
    </Tooltip>
  );
}

/** The facts an info button reveals. One short line for each fact. */
export function FactList({ facts }: { facts: string[] }) {
  return (
    <ul className="max-w-prose space-y-1.5 text-xs theme-text-muted">
      {facts.map((fact) => (
        <li key={fact}>{fact}</li>
      ))}
    </ul>
  );
}
