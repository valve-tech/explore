/**
 * What a section of the address workspace shows when it has no data yet.
 *
 * A failed section says WHAT failed and WHY, and offers a retry. It must never
 * fall back to the empty-list rendering: an empty token table reads as "this
 * address holds nothing", which is a lie when the read simply timed out.
 */

import { Icon } from "@iconify/react";
import { ADDRESS_SECTION_TIMEOUT_SECONDS } from "./deadline";
import type { SectionState } from "./sectionState";

export function SectionFallback({
  label,
  state,
  onRetry,
}: {
  /** The section's name, lower case, as it reads mid-sentence. */
  label: string;
  state: SectionState<unknown>;
  onRetry: () => void;
}) {
  if (state.status === "loading") {
    return (
      <div className="card p-2 sm:p-4 flex items-center gap-row" role="status">
        <div className="spinner shrink-0" />
        <div className="min-w-0">
          <p className="text-sm theme-text-secondary">Loading {label}…</p>
          <p className="text-xs theme-text-muted">
            This read waits up to{" "}
            <span className="font-mono tabular-nums">{ADDRESS_SECTION_TIMEOUT_SECONDS}s</span>{" "}
            before it gives up.
          </p>
        </div>
      </div>
    );
  }

  if (state.status === "failed") {
    return (
      <div className="card p-2 sm:p-4" role="alert">
        <div className="flex items-start gap-row">
          <Icon
            icon="heroicons:exclamation-triangle"
            className="w-5 h-5 mt-0.5 shrink-0 theme-danger"
          />
          <div className="min-w-0">
            <h3 className="text-sm font-semibold theme-danger">
              Could not load {label}
            </h3>
            <p className="text-sm break-words theme-text-secondary">{state.reason}</p>
            <p className="text-xs mt-1 theme-text-muted">
              Nothing is missing from the chain — this section alone failed to load.
            </p>
            <button
              onClick={onRetry}
              // Two sections can fail at once, so name the target for a screen
              // reader (and for a test) while the visible copy stays short.
              aria-label={`Retry ${label}`}
              className="mt-3 text-xs font-medium px-3 py-1.5 rounded cursor-pointer theme-secondary-bg theme-text"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
