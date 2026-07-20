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
});
