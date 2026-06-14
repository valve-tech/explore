import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { StateDiffPanel } from "../../src/components/StateDiffPanel.js";
import type { StateDiff } from "../../src/types.js";
import type { Address, Hex } from "viem";

afterEach(() => cleanup());

const ADDR_A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Address;
const ADDR_B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as Address;

function diff(overrides: Partial<StateDiff> = {}): StateDiff {
  return {
    address: ADDR_A,
    storage: [],
    ...overrides,
  };
}

describe("StateDiffPanel", () => {
  it("renders the empty state when diffs is empty", () => {
    render(<StateDiffPanel diffs={[]} />);
    expect(screen.getByText("No state changes.")).toBeDefined();
  });

  it("uses custom emptyMessage when supplied", () => {
    render(<StateDiffPanel diffs={[]} emptyMessage="Everything quiet." />);
    expect(screen.getByText("Everything quiet.")).toBeDefined();
  });

  it("renders the header with address count by default (singular)", () => {
    render(<StateDiffPanel diffs={[diff({ balanceBefore: 0n, balanceAfter: 1n })]} />);
    expect(screen.getByText("State changes")).toBeDefined();
    expect(screen.getByText("1 address")).toBeDefined();
  });

  it("renders address count plural when >1", () => {
    render(
      <StateDiffPanel
        diffs={[
          diff({ address: ADDR_A, balanceBefore: 0n, balanceAfter: 1n }),
          diff({ address: ADDR_B, balanceBefore: 0n, balanceAfter: 2n }),
        ]}
      />,
    );
    expect(screen.getByText("2 addresses")).toBeDefined();
  });

  it("hides the header when hideHeader=true", () => {
    render(<StateDiffPanel diffs={[]} hideHeader />);
    expect(screen.queryByText("State changes")).toBeNull();
  });

  it("renders a balance change with positive delta in green", () => {
    const { container } = render(
      <StateDiffPanel
        diffs={[diff({ balanceBefore: 1_000_000_000_000_000_000n, balanceAfter: 2_000_000_000_000_000_000n })]}
        hideHeader
      />,
    );
    expect(screen.getByText("balance")).toBeDefined();
    // Delta should start with "+"
    expect(container.textContent).toMatch(/\+\s*1\s+PLS/);
  });

  it("renders a balance change with negative delta", () => {
    const { container } = render(
      <StateDiffPanel
        diffs={[diff({ balanceBefore: 2_000_000_000_000_000_000n, balanceAfter: 1_000_000_000_000_000_000n })]}
        hideHeader
      />,
    );
    expect(container.textContent).toMatch(/-\s*1\s+PLS/);
  });

  it("renders zero-delta balance change with neutral color", () => {
    // Balance fields present but unchanged — still renders the row with `0 PLS` delta.
    const { container } = render(
      <StateDiffPanel
        diffs={[diff({ balanceBefore: 100n, balanceAfter: 100n })]}
        hideHeader
      />,
    );
    expect(container.textContent).toContain("0 PLS");
  });

  it("uses custom valueSymbol", () => {
    render(
      <StateDiffPanel
        diffs={[diff({ balanceBefore: 0n, balanceAfter: 1n })]}
        valueSymbol="WEI"
        hideHeader
      />,
    );
    // Custom symbol appears at least in the before, after, and delta cells.
    expect(screen.getAllByText(/WEI/).length).toBeGreaterThanOrEqual(2);
  });

  it("renders a nonce change", () => {
    render(
      <StateDiffPanel diffs={[diff({ nonceBefore: 5, nonceAfter: 6 })]} hideHeader />,
    );
    expect(screen.getByText("nonce")).toBeDefined();
    expect(screen.getByText("5")).toBeDefined();
    expect(screen.getByText("6")).toBeDefined();
  });

  it("does NOT render a nonce row if before === after", () => {
    render(
      <StateDiffPanel diffs={[diff({ nonceBefore: 5, nonceAfter: 5 })]} hideHeader />,
    );
    expect(screen.queryByText("nonce")).toBeNull();
  });

  it("does NOT render a nonce row if only one side is defined", () => {
    render(<StateDiffPanel diffs={[diff({ nonceBefore: 5 })]} hideHeader />);
    expect(screen.queryByText("nonce")).toBeNull();
  });

  it("renders a code change with truncated hex", () => {
    render(
      <StateDiffPanel
        diffs={[
          diff({
            codeBefore: "0x6080604052348015600f57600080fd5b50" as Hex,
            codeAfter: "0xaa11223344556677889900aabbccddeeff" as Hex,
          }),
        ]}
        hideHeader
      />,
    );
    expect(screen.getByText("code")).toBeDefined();
    // Truncation: first 10 chars + "…" + last 6 chars
    expect(screen.getByText("0x60806040…fd5b50")).toBeDefined();
    expect(screen.getByText("0xaa112233…ddeeff")).toBeDefined();
  });

  it("renders a short hex value untruncated when length <= 18", () => {
    render(
      <StateDiffPanel
        diffs={[
          diff({
            codeBefore: "0x12345" as Hex,
            codeAfter: "0x67890" as Hex,
          }),
        ]}
        hideHeader
      />,
    );
    expect(screen.getByText("0x12345")).toBeDefined();
  });

  it("does NOT render a code row if codeBefore === codeAfter", () => {
    render(
      <StateDiffPanel
        diffs={[
          diff({ codeBefore: "0xab" as Hex, codeAfter: "0xab" as Hex }),
        ]}
        hideHeader
      />,
    );
    expect(screen.queryByText("code")).toBeNull();
  });

  it("renders storage changes with slot/before/after", () => {
    render(
      <StateDiffPanel
        diffs={[
          diff({
            storage: [
              {
                slot: "0x0000000000000000000000000000000000000000000000000000000000000000" as Hex,
                before: "0x0000000000000000000000000000000000000000000000000000000000000005" as Hex,
                after: "0x000000000000000000000000000000000000000000000000000000000000000a" as Hex,
              },
            ],
          }),
        ]}
        hideHeader
      />,
    );
    expect(screen.getByText("storage (1)")).toBeDefined();
  });

  it("does NOT render storage list when empty", () => {
    render(<StateDiffPanel diffs={[diff({ storage: [] })]} hideHeader />);
    expect(screen.queryByText(/storage \(/)).toBeNull();
  });

  it("sorts addresses ascending", () => {
    const { container } = render(
      <StateDiffPanel
        diffs={[
          diff({ address: ADDR_B, balanceBefore: 0n, balanceAfter: 1n }),
          diff({ address: ADDR_A, balanceBefore: 0n, balanceAfter: 1n }),
        ]}
        hideHeader
      />,
    );
    const html = container.innerHTML;
    expect(html.indexOf(ADDR_A.slice(0, 6))).toBeLessThan(html.indexOf(ADDR_B.slice(0, 6)));
  });

  it("invokes onSelectAddress when a section is clicked", () => {
    const handler = vi.fn();
    const d = diff({ balanceBefore: 0n, balanceAfter: 1n });
    const { container } = render(
      <StateDiffPanel
        diffs={[d]}
        onSelectAddress={handler}
        hideHeader
        classNames={{ addressSection: "clickable-section" }}
      />,
    );
    const section = container.querySelector(".clickable-section") as HTMLElement;
    fireEvent.click(section);
    expect(handler).toHaveBeenCalledWith(d);
  });

  it("uses default cursor (no pointer) when onSelectAddress is absent", () => {
    const { container } = render(
      <StateDiffPanel
        diffs={[diff({ balanceBefore: 0n, balanceAfter: 1n })]}
        hideHeader
      />,
    );
    // Look for an element with cursor: default
    expect(container.innerHTML).toContain("cursor: default");
  });

  it("applies all classNames slots", () => {
    const { container } = render(
      <StateDiffPanel
        diffs={[
          diff({
            balanceBefore: 0n,
            balanceAfter: 1n,
            nonceBefore: 1,
            nonceAfter: 2,
            codeBefore: "0xab" as Hex,
            codeAfter: "0xcd" as Hex,
            storage: [
              {
                slot: "0x1" as Hex,
                before: "0x0" as Hex,
                after: "0x1" as Hex,
              },
            ],
          }),
        ]}
        classNames={{
          root: "tx-root",
          header: "tx-header",
          list: "tx-list",
          addressSection: "tx-section",
          addressHeader: "tx-addr-header",
          fieldRow: "tx-field",
          fieldLabel: "tx-label",
          beforeValue: "tx-before",
          afterValue: "tx-after",
          delta: "tx-delta",
          storageList: "tx-storage",
          storageRow: "tx-storage-row",
        }}
      />,
    );
    for (const c of [
      "tx-root",
      "tx-header",
      "tx-list",
      "tx-section",
      "tx-addr-header",
      "tx-field",
      "tx-label",
      "tx-before",
      "tx-after",
      "tx-delta",
      "tx-storage",
      "tx-storage-row",
    ]) {
      expect(container.querySelector(`.${c}`)).not.toBeNull();
    }
  });

  it("applies empty-state classNames slot", () => {
    const { container } = render(
      <StateDiffPanel diffs={[]} classNames={{ empty: "tx-empty" }} />,
    );
    expect(container.querySelector(".tx-empty")).not.toBeNull();
  });

  it("applies className and style to root", () => {
    const { container } = render(
      <StateDiffPanel
        diffs={[]}
        className="outer-class"
        style={{ marginTop: "42px" }}
      />,
    );
    const root = container.firstChild as HTMLElement;
    expect(root.className).toContain("outer-class");
    expect(root.style.marginTop).toBe("42px");
  });

  it("returns undefined className when neither classNames.root nor className supplied", () => {
    const { container } = render(<StateDiffPanel diffs={[]} />);
    const root = container.firstChild as HTMLElement;
    expect(root.className).toBe("");
  });

  it("renders the built-in arrow icon by default in diff rows", () => {
    const { container } = render(
      <StateDiffPanel
        diffs={[diff({ balanceBefore: 0n, balanceAfter: 1n })]}
        hideHeader
      />,
    );
    // The default arrow is an inline SVG sitting between before/after.
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("renders a custom arrowIcon override across balance, field, and storage rows", () => {
    render(
      <StateDiffPanel
        diffs={[
          diff({
            balanceBefore: 0n,
            balanceAfter: 1n,
            nonceBefore: 1,
            nonceAfter: 2,
            codeBefore: "0xab" as Hex,
            codeAfter: "0xcd" as Hex,
            storage: [
              { slot: "0x1" as Hex, before: "0x0" as Hex, after: "0x1" as Hex },
            ],
          }),
        ]}
        hideHeader
        arrowIcon={<span data-testid="custom-arrow">to</span>}
      />,
    );
    // balance + nonce + code + storage = 4 arrow sites.
    expect(screen.getAllByTestId("custom-arrow").length).toBe(4);
  });
});
