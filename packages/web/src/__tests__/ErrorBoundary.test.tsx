import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ErrorBoundary from "../components/ErrorBoundary";

/**
 * Top-level render guard. A child that throws during render must be
 * contained behind the fallback (so the AppShell stays live), the
 * "Try again" button must clear the caught error, and a changing
 * `resetKey` (the route path in production) must auto-recover.
 */

function Boom({ message = "kaboom" }: { message?: string }): never {
  throw new Error(message);
}

describe("<ErrorBoundary />", () => {
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // componentDidCatch logs to console.error; silence the expected noise.
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    errSpy.mockRestore();
  });

  it("renders children when nothing throws", () => {
    render(
      <ErrorBoundary>
        <div>all good</div>
      </ErrorBoundary>,
    );
    expect(screen.getByText("all good")).toBeInTheDocument();
  });

  it("renders the fallback with the error message when a child throws", () => {
    render(
      <ErrorBoundary>
        <Boom message="BigInt(undefined)" />
      </ErrorBoundary>,
    );
    expect(
      screen.getByText("Something went wrong on this page"),
    ).toBeInTheDocument();
    expect(screen.getByText("BigInt(undefined)")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("clears the error when 'Try again' is clicked and the child no longer throws", () => {
    const { rerender } = render(
      <ErrorBoundary>
        <Boom message="first paint blew up" />
      </ErrorBoundary>,
    );
    expect(screen.getByText("first paint blew up")).toBeInTheDocument();

    // Swap the child for a clean one, then retry: the boundary resets its
    // state and re-renders the (now non-throwing) children.
    rerender(
      <ErrorBoundary>
        <div>recovered child</div>
      </ErrorBoundary>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByText("recovered child")).toBeInTheDocument();
  });

  it("auto-recovers when the resetKey changes (route navigation)", () => {
    // Crash on route "/a"; navigating to "/b" both stops the throw and bumps
    // the resetKey, so componentDidUpdate clears the caught error.
    const { rerender } = render(
      <ErrorBoundary resetKey="/a">
        <Boom message="route a crashed" />
      </ErrorBoundary>,
    );
    expect(screen.getByText("route a crashed")).toBeInTheDocument();

    rerender(
      <ErrorBoundary resetKey="/b">
        <div>page b</div>
      </ErrorBoundary>,
    );
    expect(screen.getByText("page b")).toBeInTheDocument();
  });
});
