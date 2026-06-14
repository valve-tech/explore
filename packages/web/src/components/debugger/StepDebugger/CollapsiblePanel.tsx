import { useState } from "react";
import { Icon } from "@iconify/react";

/** Disclosure panel: click the header to toggle body visibility.
 *  Used for Stack, Memory, and the Execution Trace section. */
export function CollapsiblePanel({
  title,
  count,
  suffix,
  defaultOpen = true,
  children,
}: {
  title: string;
  count?: number;
  suffix?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="card overflow-hidden theme-card-bg">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2 card-divider cursor-pointer theme-secondary-bg"
      >
        <span className="flex items-center gap-inline">
          <Icon
            icon={open ? "heroicons:chevron-down" : "heroicons:chevron-right"}
            className="w-3.5 h-3.5 theme-text-muted"
            aria-hidden
          />
          <span className="text-xs font-semibold uppercase tracking-wider theme-text-secondary">
            {title}
          </span>
        </span>
        {count !== undefined && (
          <span className="text-xs theme-text-muted theme-mono">
            {count.toLocaleString()} {suffix ?? "items"}
          </span>
        )}
      </button>
      {open && children}
    </div>
  );
}
