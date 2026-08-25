import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import EntityRow from "../components/primitives/EntityRow";

function renderRow(props: Parameters<typeof EntityRow>[0]) {
  return render(
    <MemoryRouter>
      <EntityRow {...props} />
    </MemoryRouter>,
  );
}

describe("EntityRow", () => {
  it("renders exactly two lines of content per side", () => {
    const { container } = renderRow({ main: "Ethereum", sub: "nonce 1,204", right: "12.401 ETH", rightSub: "68%" });
    // Assert all four text nodes exist.
    expect(screen.getByText("Ethereum")).toBeInTheDocument();
    expect(screen.getByText("nonce 1,204")).toBeInTheDocument();
    expect(screen.getByText("12.401 ETH")).toBeInTheDocument();
    expect(screen.getByText("68%")).toBeInTheDocument();
    // The LEFT side truncates: it carries a hash or a name, which can run to
    // any length, and clipping it is the price of a two-line row.
    expect(container.querySelectorAll("span.truncate").length).toBe(2);
  });

  it("does not clip the right column", () => {
    // The right column carries short whole values — a count, an amount, a
    // block number — so it is `shrink-0` and never truncates. It used to
    // share the squeeze with the left column, and lost: the explorer home
    // page rendered "#27,372…" for a block number and cut an amount to
    // "0.0₇2 …", clipping exactly the digits that carried the meaning.
    const { container } = renderRow({
      main: "0x" + "ab".repeat(32),
      sub: "transfer",
      right: "12.401 ETH",
      rightSub: "#27,372,424",
    });
    const rightColumn = container.querySelector("span.text-right");
    expect(rightColumn).not.toBeNull();
    expect(rightColumn!.className).toContain("shrink-0");
    expect(rightColumn!.querySelectorAll("span.truncate").length).toBe(0);
    expect(screen.getByText("#27,372,424")).toBeInTheDocument();
  });

  it("renders a link when href is set and a plain row when it is not", () => {
    const { unmount } = renderRow({ main: "Ethereum", sub: "x", href: "/eip155/1/address/0xa" });
    expect(screen.getByRole("link")).toHaveAttribute("href", "/eip155/1/address/0xa");
    unmount();
    renderRow({ main: "Ethereum", sub: "x" });
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("sets the fill width from share, clamped to 0..100%", () => {
    const { container } = renderRow({ main: "a", sub: "b", share: 0.68, tint: "#627eea" });
    const fill = container.querySelector("[data-testid='row-fill']") as HTMLElement;
    expect(fill.style.width).toBe("68%");
  });

  it("clamps an out-of-range share instead of emitting a broken width", () => {
    const { container, unmount } = renderRow({ main: "a", sub: "b", share: 1.8 });
    expect(
      (container.querySelector("[data-testid='row-fill']") as HTMLElement).style.width,
    ).toBe("100%");
    unmount();
    const second = renderRow({ main: "a", sub: "b", share: -0.5 });
    expect(
      (second.container.querySelector("[data-testid='row-fill']") as HTMLElement).style.width,
    ).toBe("0%");
  });

  it("omits the fill entirely when share is undefined", () => {
    const { container } = renderRow({ main: "a", sub: "b" });
    expect(container.querySelector("[data-testid='row-fill']")).toBeNull();
  });

  it("omits the fill entirely when share is NaN", () => {
    const { container } = renderRow({ main: "a", sub: "b", share: NaN });
    expect(container.querySelector("[data-testid='row-fill']")).toBeNull();
  });

  it("uses an outset shadow outline and never a CSS border", () => {
    const { container } = renderRow({ main: "a", sub: "b" });
    const row = container.firstElementChild as HTMLElement;
    // Inspect class TOKENS, not the raw string. An arbitrary-value utility like
    // shadow-[0_0_0_1px_var(--color-border-default)] carries the word "border"
    // inside a custom-property name, and that must not count as a border class.
    const tokens = row.className.split(/\s+/).filter(Boolean);
    expect(tokens.some((t) => /^border(-|$)/.test(t))).toBe(false);
    expect(tokens.some((t) => t.startsWith("shadow-["))).toBe(true);
  });
});
