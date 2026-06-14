import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render } from "@testing-library/react";
import {
  ChevronRightIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  XIcon,
} from "../../src/icons/index.js";
import type { IconProps } from "../../src/icons/index.js";

afterEach(() => cleanup());

const ICONS: Array<[string, (p: IconProps) => React.JSX.Element]> = [
  ["ChevronRightIcon", ChevronRightIcon],
  ["ChevronDownIcon", ChevronDownIcon],
  ["ChevronLeftIcon", ChevronLeftIcon],
  ["ArrowRightIcon", ArrowRightIcon],
  ["CheckIcon", CheckIcon],
  ["XIcon", XIcon],
];

describe("icons — defaults", () => {
  for (const [name, Icon] of ICONS) {
    it(`${name} renders a 16px decorative svg by default`, () => {
      const { container } = render(<Icon />);
      const svg = container.querySelector("svg")!;
      expect(svg).not.toBeNull();
      // Default size is 16.
      expect(svg.getAttribute("width")).toBe("16");
      expect(svg.getAttribute("height")).toBe("16");
      // Inherits surrounding color.
      expect(svg.getAttribute("stroke")).toBe("currentColor");
      // Decorative when no title: aria-hidden, no role, no <title>.
      expect(svg.getAttribute("aria-hidden")).toBe("true");
      expect(svg.getAttribute("role")).toBeNull();
      expect(svg.querySelector("title")).toBeNull();
      // Has at least one drawn path.
      expect(svg.querySelector("path")).not.toBeNull();
    });
  }
});

describe("icons — props", () => {
  it("applies a custom size to both width and height", () => {
    const { container } = render(<ChevronRightIcon size={32} />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe("32");
    expect(svg.getAttribute("height")).toBe("32");
  });

  it("forwards className and style", () => {
    const { container } = render(
      <ArrowRightIcon className="my-icon" style={{ opacity: 0.5 }} />,
    );
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("class")).toBe("my-icon");
    expect((svg as unknown as SVGElement & { style: CSSStyleDeclaration }).style
      .opacity).toBe("0.5");
  });

  it("exposes an accessible label via role+title when `title` is set", () => {
    const { container } = render(<CheckIcon title="Success" />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.getAttribute("aria-hidden")).toBeNull();
    const title = svg.querySelector("title")!;
    expect(title).not.toBeNull();
    expect(title.textContent).toBe("Success");
  });
});
