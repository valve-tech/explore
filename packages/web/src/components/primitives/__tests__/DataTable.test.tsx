import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { DataTable, type Column } from "../DataTable";

interface Row { hash: string; block: number; }
const rows: Row[] = [
  { hash: "0xabc", block: 10 },
  { hash: "0xdef", block: 11 },
];
const columns: Column<Row>[] = [
  { key: "hash", header: "Tx Hash", cell: (r) => <span>{r.hash}</span>, primary: true },
  { key: "block", header: "Block", cell: (r) => <span>{r.block}</span> },
];

function mockMobile(isMobile: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: isMobile,
      addEventListener: () => {},
      removeEventListener: () => {},
    })),
  );
}

describe("DataTable", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("renders a real <table> at desktop width", () => {
    mockMobile(false);
    const { container } = render(
      <DataTable columns={columns} rows={rows} rowKey={(r) => r.hash} />,
    );
    expect(container.querySelector("table")).toBeInTheDocument();
    expect(screen.getByText("Tx Hash")).toBeInTheDocument();
    expect(screen.getAllByText(/0x/).length).toBe(2);
  });

  it("wraps the table in a horizontal-scroll container (no page overflow)", () => {
    mockMobile(false);
    const { container } = render(
      <DataTable columns={columns} rows={rows} rowKey={(r) => r.hash} />,
    );
    const wrapper = container.querySelector(".overflow-x-auto");
    expect(wrapper).not.toBeNull();
    expect(wrapper?.querySelector("table")).not.toBeNull();
  });

  it("renders cards (no <table>) at phone width, with labels for non-primary columns", () => {
    mockMobile(true);
    const { container } = render(
      <DataTable columns={columns} rows={rows} rowKey={(r) => r.hash} />,
    );
    expect(container.querySelector("table")).not.toBeInTheDocument();
    // Header label appears once per card as a field label.
    expect(screen.getAllByText("Block").length).toBe(2);
    expect(screen.getByText("0xabc")).toBeInTheDocument();
  });

  it("renders the empty label when there are no rows", () => {
    mockMobile(false);
    render(
      <DataTable
        columns={columns}
        rows={[]}
        rowKey={(r) => r.hash}
        emptyLabel="No transactions"
      />,
    );
    expect(screen.getByText("No transactions")).toBeInTheDocument();
  });

  it("omits the field label in card mode for hideLabelOnCard columns", () => {
    mockMobile(true);
    const columnsWithAction: Column<Row>[] = [
      ...columns,
      {
        key: "actions",
        header: "Actions",
        cell: () => <button>act</button>,
        hideLabelOnCard: true,
      },
    ];
    render(
      <DataTable columns={columnsWithAction} rows={rows} rowKey={(r) => r.hash} />,
    );
    // The action button's cell content renders...
    expect(screen.getAllByText("act").length).toBe(2);
    // ...but its header label does not, since hideLabelOnCard suppresses it.
    expect(screen.queryByText("Actions")).not.toBeInTheDocument();
    // A non-hidden column's header still renders as a label, distinguishing the two.
    expect(screen.getAllByText("Block").length).toBe(2);
  });

  it("falls back to the first column as the card heading when none is primary", () => {
    mockMobile(true);
    const noPrimaryColumns: Column<Row>[] = [
      { key: "hash", header: "Tx Hash", cell: (r) => <span>{r.hash}</span> },
      { key: "block", header: "Block", cell: (r) => <span>{r.block}</span> },
    ];
    const { container } = render(
      <DataTable columns={noPrimaryColumns} rows={rows} rowKey={(r) => r.hash} />,
    );
    expect(container.querySelector("table")).not.toBeInTheDocument();
    // First column (hash) becomes the heading despite no `primary: true`.
    expect(screen.getByText("0xabc")).toBeInTheDocument();
    expect(screen.getByText("0xdef")).toBeInTheDocument();
  });

  it("renders the empty label (no table, no cards) at phone width when rows is empty", () => {
    mockMobile(true);
    const { container } = render(
      <DataTable
        columns={columns}
        rows={[]}
        rowKey={(r) => r.hash}
        emptyLabel="No transactions"
      />,
    );
    expect(screen.getByText("No transactions")).toBeInTheDocument();
    expect(container.querySelector("table")).not.toBeInTheDocument();
    expect(container.querySelector("li")).not.toBeInTheDocument();
  });

  it("renders the empty label instead of throwing when columns is empty at phone width", () => {
    mockMobile(true);
    const { container } = render(
      <DataTable
        columns={[]}
        rows={rows}
        rowKey={(r) => r.hash}
        emptyLabel="No columns configured"
      />,
    );
    expect(screen.getByText("No columns configured")).toBeInTheDocument();
    expect(container.querySelector("table")).not.toBeInTheDocument();
    expect(container.querySelector("li")).not.toBeInTheDocument();
  });
});
