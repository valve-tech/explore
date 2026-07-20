import type { AddressNavigate } from "./primitives";
import { ExplorerLink } from "../ExplorerLink";
import { MiddleTruncate } from "../../primitives/MiddleTruncate";

/** Navigable, searchable (middle-truncated) address cell. */
export function AddressCell({
  address,
  onNavigate,
}: {
  address: string;
  onNavigate: AddressNavigate;
}) {
  return (
    <ExplorerLink
      target={{ type: "address" as const, value: address }}
      onNavigate={onNavigate}
      className="font-mono text-sm hover:underline cursor-pointer theme-accent"
    >
      <MiddleTruncate value={address} className="font-mono text-sm theme-accent" />
    </ExplorerLink>
  );
}
