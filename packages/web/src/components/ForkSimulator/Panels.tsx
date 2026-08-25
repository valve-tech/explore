export function LoadingPanel() {
  return (
    <div
      className="rounded-lg bs p-8 flex flex-col items-center theme-card-bg"
    >
      <div className="spinner mb-3" />
      <p
        className="text-sm theme-text-secondary"
      >
        Spinning up Anvil fork and executing transaction...
      </p>
      <p
        className="text-xs mt-1 theme-text-muted"
      >
        This captures full state diffs — may take a few seconds.
      </p>
    </div>
  );
}

export function ErrorPanel({ message }: { message: string }) {
  return (
    <div
      className="rounded-lg p-4"
      style={{
        backgroundColor: "var(--color-danger-muted)",
        borderColor: "var(--color-danger)",
      }}
    >
      <p
        className="text-sm font-semibold theme-danger"
      >
        Simulation Failed
      </p>
      <p
        className="text-sm mt-1 theme-text"
      >
        {message}
      </p>
    </div>
  );
}

export function RevertReasonBlock({ reason }: { reason: string }) {
  return (
    <div
      className="rounded-lg p-3"
      style={{
        backgroundColor: "var(--color-danger-muted)",
        borderColor: "var(--color-danger)",
      }}
    >
      <p
        className="text-xs font-semibold mb-1 theme-danger"
      >
        Revert Reason
      </p>
      <pre
        className="text-xs whitespace-pre-wrap theme-text theme-mono"
      >
        {reason}
      </pre>
    </div>
  );
}

export function NoStateChangesPanel() {
  return (
    <div
      className="rounded-lg bs p-2 sm:p-4 text-center theme-card-bg"
    >
      <p className="text-sm theme-text-muted">
        No state changes detected (view-only call or no storage writes)
      </p>
    </div>
  );
}

/**
 * Shown in place of NoStateChangesPanel when the fork could not report the
 * state before the call. The diff is empty either way; only this panel is
 * honest about why.
 */
export function StateDiffUnavailablePanel() {
  return (
    <div
      className="rounded-lg bs p-2 sm:p-4 text-center theme-card-bg"
    >
      <p className="text-sm theme-text-muted">
        State changes unknown — the fork could not report the state before
        this call.
      </p>
    </div>
  );
}
