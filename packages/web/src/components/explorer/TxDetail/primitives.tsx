import { useState } from "react";
import { Icon } from "@iconify/react";
import { ExplorerLink } from "../ExplorerLink";
import { MiddleTruncate } from "../../primitives/MiddleTruncate";

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
      className="font-mono text-sm hover:underline cursor-pointer theme-accent"
      title={label ? address : undefined}
    >
      {label || <MiddleTruncate value={address} className="font-mono text-sm theme-accent" />}
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
        className="w-full flex items-center justify-between p-4 text-left cursor-pointer"
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
          className="px-4 pb-4 bs-t-muted"
          style={{}}
        >
          {children}
        </div>
      )}
    </div>
  );
}
