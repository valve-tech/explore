import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ValveLogo } from "../components/AppShell/ValveLogo";
import { ExploreLogo } from "../components/AppShell/ExploreLogo";
import RouteFallback from "../components/RouteFallback";

/**
 * Brand marks + the lazy-route Suspense fallback. These are pure
 * presentational SVG/markup components — render them and assert the
 * accessible labels / structure so the coverage counts their JSX paths,
 * including the default-className branches.
 */

describe("<ValveLogo />", () => {
  it("renders the company mark with its accessible label", () => {
    render(<ValveLogo />);
    expect(screen.getByRole("img", { name: "Valve City" })).toBeInTheDocument();
  });

  it("applies a custom className when provided", () => {
    render(<ValveLogo className="w-10 h-10 custom-valve" />);
    const svg = screen.getByRole("img", { name: "Valve City" });
    expect(svg).toHaveClass("custom-valve");
  });

  it("draws six spokes (one polygon per 60° rotation)", () => {
    const { container } = render(<ValveLogo />);
    expect(container.querySelectorAll("polygon")).toHaveLength(6);
  });
});

describe("<ExploreLogo />", () => {
  it("renders the product mark with its accessible label and default size", () => {
    const { container } = render(<ExploreLogo />);
    const svg = screen.getByRole("img", { name: "Explore" });
    expect(svg).toBeInTheDocument();
    // Default className branch.
    expect(svg).toHaveClass("w-7");
    // Traced route through four nodes.
    expect(container.querySelectorAll("circle")).toHaveLength(4);
  });

  it("applies a custom className when provided", () => {
    render(<ExploreLogo className="w-8 h-8 custom-explore" />);
    expect(screen.getByRole("img", { name: "Explore" })).toHaveClass(
      "custom-explore",
    );
  });
});

describe("<RouteFallback />", () => {
  it("renders a spinner + loading text", () => {
    const { container } = render(<RouteFallback />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(container.querySelector(".spinner")).not.toBeNull();
  });
});
