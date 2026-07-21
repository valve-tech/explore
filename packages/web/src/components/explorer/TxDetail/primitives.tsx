import { useState } from "react";
import { Icon } from "@iconify/react";
import { ExplorerLink } from "../ExplorerLink";

export type NavTarget = { type: "address" | "block"; value: string };
export type AddressNavigate = (target: { type: "address"; value: string }) => void;

export function AddressLink({
  address,
  onNavigate,
  label,
}: {
  address: string;
  onNavigate: AddressNavigate;
  label?: string;
}) {
  return (
    <ExplorerLink
      target={{ type: "address" as const, value: address }}
      onNavigate={onNavigate}
      // Stacked InfoRow context: the value owns its own full-width line, so let a
      // long address WRAP (break-all) rather than middle-clip. It flows onto a
      // second line instead of forcing width, so it can never create horizontal
      // scroll, and the full value stays in the DOM (Ctrl+F / copy). Matches how
      // the Transaction Hash row already renders.
      className="font-mono text-sm break-all hover:underline cursor-pointer theme-accent"
      title={label ? address : undefined}
    >
      {label || address}
    </ExplorerLink>
  );
}

export function InfoRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="flex flex-col sm:flex-row sm:items-start gap-tight sm:gap-4 py-2.5 bs-b-muted last:shadow-none"
      style={{}}
    >
      <span
        className="text-xs font-medium shrink-0 sm:w-40 theme-text-secondary"
      >
        {label}
      </span>
      <div className="text-sm flex-1 min-w-0">{children}</div>
    </div>
  );
}

export function SectionCard({
  title,
  count,
  children,
  defaultOpen = true,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div
      className="rounded-lg bs theme-card-bg"
    >
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-2 py-4 sm:p-4 text-left cursor-pointer"
      >
        <div className="flex items-center gap-inline">
          <h3
            className="text-sm font-semibold theme-text"
          >
            {title}
          </h3>
          {count !== undefined && (
            <span
              className="text-[10px] font-medium px-1.5 py-0.5 rounded-full theme-accent-bg theme-accent"
            >
              {count}
            </span>
          )}
        </div>
        <Icon
          icon="heroicons:chevron-down"
          className="w-4 h-4 transition-transform theme-text-muted"
          style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
        />
      </button>
      {open && (
        <div
          className="px-2 pb-4 sm:px-4 bs-t-muted"
          style={{}}
        >
          {children}
        </div>
      )}
    </div>
  );
}
