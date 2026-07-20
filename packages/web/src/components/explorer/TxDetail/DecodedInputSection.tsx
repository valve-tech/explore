import type { TransactionDetails } from "../../../api/explorer";
import { SectionCard } from "./primitives";
import { renderParamValue } from "./format";
import { MiddleTruncate } from "../../primitives/MiddleTruncate";
import { DataTable, type Column } from "../../primitives/DataTable";

type DecodedInput = NonNullable<TransactionDetails["decodedInput"]>;
type DecodedArg = DecodedInput["args"][number];
/** Row shape: the decoded arg plus its original position (needed for the "#"
 *  column and the unnamed-arg `paramN` fallback — `Column.cell` only gets the
 *  row, not an index). */
type IndexedArg = DecodedArg & { i: number };

// Address (20-byte) or hash/bytes32 (32-byte) shaped hex values only. Numbers,
// bools, plain strings, and odd-length bytes stay exact/unformatted — this
// repo never truncates or reformats raw values outside this narrow case.
const ADDRESS_OR_HASH = /^0x[0-9a-fA-F]{40}$|^0x[0-9a-fA-F]{64}$/;

/** Polymorphic decoded-value cell: middle-truncate only address/hash-shaped
 *  values; everything else renders exactly as before (wraps, doesn't clip). */
function ValueCell({ value }: { value: unknown }) {
  const rendered = renderParamValue(value);
  if (ADDRESS_OR_HASH.test(rendered)) {
    return <MiddleTruncate value={rendered} className="font-mono text-sm theme-text" />;
  }
  return (
    <div className="font-mono break-all max-w-[400px] theme-text">{rendered}</div>
  );
}

export function DecodedInputSection({ decoded }: { decoded: DecodedInput }) {
  const rows: IndexedArg[] = decoded.args.map((arg, i) => ({ ...arg, i }));

  const columns: Column<IndexedArg>[] = [
    {
      key: "index",
      header: "#",
      cell: (arg) => <span className="theme-text-muted">{arg.i}</span>,
    },
    {
      key: "name",
      header: "Name",
      primary: true,
      cell: (arg) => (
        <span className="font-medium theme-accent">{arg.name || `param${arg.i}`}</span>
      ),
    },
    {
      key: "type",
      header: "Type",
      cell: (arg) => <span className="theme-text-secondary">{arg.type}</span>,
    },
    {
      key: "value",
      header: "Value",
      cell: (arg) => <ValueCell value={arg.value} />,
    },
  ];

  return (
    <SectionCard title="Decoded Function Call">
      <div className="pt-3">
        <div className="px-3 py-2 rounded-md mb-3 text-sm theme-mono theme-accent-bg theme-accent">
          {decoded.functionName}({decoded.args.map((p) => p.type).join(", ")})
        </div>
        {decoded.args.length > 0 && (
          <div className="rounded-md bs-muted overflow-hidden">
            <DataTable
              columns={columns}
              rows={rows}
              rowKey={(arg) => arg.i}
              emptyLabel="No arguments"
            />
          </div>
        )}
      </div>
    </SectionCard>
  );
}
