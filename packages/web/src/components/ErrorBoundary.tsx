import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /**
   * When this value changes, the boundary clears its caught error. Pass the
   * route path so navigating to a different page recovers automatically
   * instead of stranding the user on the fallback.
   */
  resetKey?: string;
}

interface State {
  error: Error | null;
}

/**
 * Top-level render guard. Without this, an unhandled throw during render (e.g.
 * `BigInt(undefined)` on an API shape drift) unmounts the entire React tree to
 * a blank white screen. Catching it here contains the blast radius to the
 * routed view — the AppShell header/nav stay live, so the user can navigate out.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Diagnostics only; the rendered fallback is what the user sees.
    console.error("Unhandled render error:", error, info.componentStack);
  }

  componentDidUpdate(prev: Props): void {
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="m-4 rounded-lg bs p-2 sm:p-4 theme-card-bg" role="alert">
        <h2 className="text-sm font-semibold mb-2 theme-danger">
          Something went wrong on this page
        </h2>
        <p className="text-xs mb-3 theme-text-secondary">
          This view hit an unexpected error and was contained so the rest of the
          app keeps working. Try another page from the nav, or retry.
        </p>
        <pre className="text-xs whitespace-pre-wrap break-all mb-4 theme-mono theme-text-muted">
          {error.message}
        </pre>
        <button
          type="button"
          onClick={() => this.setState({ error: null })}
          className="px-3 py-1.5 rounded-md text-xs font-semibold"
          style={{ backgroundColor: "var(--color-accent)", color: "white" }}
        >
          Try again
        </button>
      </div>
    );
  }
}
