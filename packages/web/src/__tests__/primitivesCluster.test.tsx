import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { Dropdown } from "../components/primitives/Dropdown";
import { TokenImage } from "../components/primitives/TokenImage";
import { CopyButton } from "../components/primitives/CopyButton";
import { Checkbox } from "../components/primitives/Checkbox";
import { Skeleton } from "../components/primitives/Skeleton";

/**
 * Direct-render coverage for the shared primitives. Each branch is exercised:
 * dropdown open/close/select/outside-click/Escape; TokenImage load vs error
 * fallback (glyph) and the no-address path; CopyButton success + failure;
 * Checkbox checked/unchecked/disabled; Skeleton presence.
 *
 * TokenImage points at gib.show token art for the canonical WPLS token on
 * PulseChain (chain 369): /image/369/0xA1077a294dDE1B09bB078844df40758a5D0f9a27
 * (https://scan.pulsechain.com/token/0xA1077a294dDE1B09bB078844df40758a5D0f9a27).
 */

const WPLS = "0xA1077a294dDE1B09bB078844df40758a5D0f9a27";

vi.mock("../lib/clipboard", () => ({
  copyToClipboard: vi.fn(),
}));
import { copyToClipboard } from "../lib/clipboard";
const mockCopy = copyToClipboard as unknown as ReturnType<typeof vi.fn>;

describe("<Dropdown />", () => {
  const options = [
    { value: "rank" as const, label: "node order" },
    { value: "tip" as const, label: "priority tip" },
  ];

  it("renders the current option's label on the trigger", () => {
    render(
      <Dropdown
        value="tip"
        options={options}
        onChange={() => {}}
        ariaLabel="Sort"
      />,
    );
    expect(screen.getByRole("button", { name: "Sort" })).toHaveTextContent(
      "priority tip",
    );
  });

  it("falls back to the raw value when no option matches", () => {
    render(
      <Dropdown
        value={"orphan" as "rank"}
        options={options}
        onChange={() => {}}
        ariaLabel="Sort"
      />,
    );
    expect(screen.getByRole("button", { name: "Sort" })).toHaveTextContent(
      "orphan",
    );
  });

  it("opens the listbox and selects an option, calling onChange + closing", () => {
    const onChange = vi.fn();
    render(
      <Dropdown
        value="rank"
        options={options}
        onChange={onChange}
        ariaLabel="Sort"
        align="right"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Sort" }));
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: /priority tip/ }));
    expect(onChange).toHaveBeenCalledWith("tip");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("toggles closed when the trigger is clicked again", () => {
    render(
      <Dropdown
        value="rank"
        options={options}
        onChange={() => {}}
        ariaLabel="Sort"
      />,
    );
    const trigger = screen.getByRole("button", { name: "Sort" });
    fireEvent.click(trigger);
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    fireEvent.click(trigger);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("closes on outside mousedown", () => {
    render(
      <div>
        <Dropdown
          value="rank"
          options={options}
          onChange={() => {}}
          ariaLabel="Sort"
        />
        <span data-testid="outside">elsewhere</span>
      </div>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Sort" }));
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("does NOT close on mousedown inside the dropdown", () => {
    render(
      <Dropdown
        value="rank"
        options={options}
        onChange={() => {}}
        ariaLabel="Sort"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Sort" }));
    fireEvent.mouseDown(screen.getByRole("listbox"));
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("closes on Escape", () => {
    render(
      <Dropdown
        value="rank"
        options={options}
        onChange={() => {}}
        ariaLabel="Sort"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Sort" }));
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("ignores non-Escape keys while open", () => {
    render(
      <Dropdown
        value="rank"
        options={options}
        onChange={() => {}}
        ariaLabel="Sort"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Sort" }));
    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });
});

describe("<TokenImage />", () => {
  it("renders the gib.show img for a real token (WPLS on chain 369)", () => {
    render(<TokenImage address={WPLS} chainId={369} symbol="WPLS" />);
    const img = screen.getByRole("img", { name: "WPLS" });
    expect(img).toHaveAttribute("src", `https://gib.show/image/369/${WPLS}`);
  });

  it("defaults to PulseChain (369) when no chainId is given", () => {
    render(<TokenImage address={WPLS} symbol="WPLS" />);
    expect(screen.getByRole("img", { name: "WPLS" })).toHaveAttribute(
      "src",
      `https://gib.show/image/369/${WPLS}`,
    );
  });

  it("falls back to the symbol's first glyph after an image load error", () => {
    render(<TokenImage address={WPLS} symbol="wpls" />);
    fireEvent.error(screen.getByRole("img", { name: "wpls" }));
    expect(screen.getByText("W")).toBeInTheDocument();
  });

  it("falls back to the coin glyph when no symbol is provided and image errors", () => {
    render(<TokenImage address={WPLS} />);
    fireEvent.error(screen.getByRole("img", { name: "token" }));
    expect(screen.getByText("◈")).toBeInTheDocument();
  });

  it("renders the fallback glyph immediately when address is empty", () => {
    render(<TokenImage address="" symbol="ABC" />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("A")).toBeInTheDocument();
  });
});

describe("<CopyButton />", () => {
  beforeEach(() => mockCopy.mockReset());

  it("shows the transient ✓ feedback on a successful copy, then reverts", async () => {
    mockCopy.mockResolvedValue(true);
    render(<CopyButton value={WPLS} title="Copy address" />);
    const btn = screen.getByRole("button", { name: "Copy address" });

    fireEvent.click(btn);
    expect(mockCopy).toHaveBeenCalledWith(WPLS);
    // success color applied once the copy promise resolves
    await waitFor(() => expect(btn.style.color).toBe("var(--color-success)"));
    // and reverts after the 900ms feedback window
    await waitFor(
      () => expect(btn.style.color).toBe("var(--color-text-muted)"),
      { timeout: 2000 },
    );
  });

  it("does not flip to ✓ when the copy fails", async () => {
    mockCopy.mockResolvedValue(false);
    render(<CopyButton value={WPLS} />);
    const btn = screen.getByRole("button", { name: "Copy" });
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(btn.style.color).toBe("var(--color-text-muted)");
  });
});

describe("<Checkbox />", () => {
  it("renders checked with the check icon and aria-checked=true", () => {
    render(<Checkbox checked onChange={() => {}} label="Watch" />);
    const box = screen.getByRole("checkbox", { name: /Watch/ });
    expect(box).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("Watch")).toBeInTheDocument();
  });

  it("calls onChange(true) when an unchecked box is clicked", () => {
    const onChange = vi.fn();
    render(<Checkbox checked={false} onChange={onChange} />);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("calls onChange(false) when a checked box is clicked", () => {
    const onChange = vi.fn();
    render(<Checkbox checked onChange={onChange} />);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it("is disabled and does not fire onChange when disabled", () => {
    const onChange = vi.fn();
    render(<Checkbox checked={false} onChange={onChange} disabled label="x" />);
    const box = screen.getByRole("checkbox");
    expect(box).toBeDisabled();
    fireEvent.click(box);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("<Skeleton />", () => {
  it("renders a decorative aria-hidden block with the skeleton class", () => {
    const { container } = render(
      <Skeleton className="h-3 w-24" style={{ opacity: 0.5 }} />,
    );
    const el = container.querySelector(".skeleton");
    expect(el).toBeInTheDocument();
    expect(el).toHaveAttribute("aria-hidden", "true");
    expect(el).toHaveClass("h-3", "w-24");
  });
});
