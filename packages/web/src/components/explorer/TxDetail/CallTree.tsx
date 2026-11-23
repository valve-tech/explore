import type { TransactionDetails } from "../../../api/explorer";
import { toCallTree } from "./callTreeLayout";
import { toCallExpression } from "./callExpression";
import { shortAddress } from "./callDecode";
import type { AddressNavigate } from "./primitives";
import { Tooltip } from "../../primitives/Tooltip";

type InternalCall = TransactionDetails["internalTransactions"][number];

/**
 * The transaction's internal calls, as a call tree.
 *
 * This replaced a five-column table — Type, From, To, Value, Gas — that told
 * the reader who called whom only if they matched hex prefixes by eye, and
 * never said what was being called. The tree supplies the caller by position,
 * so four of the five columns collapse into one expression per row:
 *
 *   STATICCALL  0xa1077a…9a27.balanceOf(0xcea0bb…b77d) → 5,456
 *
 * Every part of that line degrades on its own. Without a 4byte name the row
 * shows the raw selector; without decodable calldata it shows the byte count;
 * without a standard-fixed return type it shows no return. Nothing is invented.
 */
export function CallTree({
  calls,
  symbol,
  tokenDecimals,
  onNavigate,
}: {
  calls: TransactionDetails["internalTransactions"];
  symbol: string;
  /**
   * Token decimals by lowercased address — see `decimalsByToken`. A call to
   * a token in this map prints its amounts at the token's scale, not in base
   * units. Omit it and every amount stays a raw integer.
   */
  tokenDecimals?: ReadonlyMap<string, number>;
  onNavigate: AddressNavigate;
}) {
  const tree = toCallTree(calls);

  return (
    <div className="overflow-x-auto">
      <div className="min-w-max text-xs">
        {tree.map((node, i) => (
          <CallRow
            key={i}
            node={node}
            symbol={symbol}
            decimals={tokenDecimals?.get(node.row.to.toLowerCase()) ?? null}
            onNavigate={onNavigate}
          />
        ))}
      </div>
    </div>
  );
}

function CallRow({
  node,
  symbol,
  decimals,
  onNavigate,
}: {
  node: ReturnType<typeof toCallTree<InternalCall>>[number];
  symbol: string;
  decimals: number | null;
  onNavigate: AddressNavigate;
}) {
  const call = node.row;
  const expr = toCallExpression(call, symbol, decimals);
  const failed = expr.error !== null;

  return (
    <div
      className="flex items-baseline gap-inline whitespace-nowrap px-2 py-1"
      style={failed ? { backgroundColor: "var(--color-error-muted)" } : undefined}
    >
      <TreeGuide guides={node.guides} depth={node.depth} isLast={node.isLast} />

      <CallTypeBadge type={call.type} />

      <span className="font-mono">
        <button
          type="button"
          onClick={() => onNavigate({ type: "address", value: call.to })}
          className="theme-accent bg-transparent p-0"
          title={call.to}
        >
          {shortAddress(call.to)}
        </button>
        <span className="theme-text-muted">.</span>
        <MethodName expr={expr} />
        {expr.valueModifier !== null && (
          <span style={{ color: "var(--color-warning)" }}>
            {expr.valueModifier}
          </span>
        )}
        <Arguments expr={expr} />
      </span>

      {expr.returns !== null && (
        <span
          className="font-mono theme-text-secondary"
          title={expr.returnsFull !== expr.returns ? expr.returnsFull ?? undefined : undefined}
        >
          → {expr.returns}
        </span>
      )}
      {failed && (
        <span className="font-mono" style={{ color: "var(--color-error)" }}>
          ✗ {expr.error}
        </span>
      )}

      <span className="num ml-auto pl-4 theme-text-muted">
        {Number(call.gasUsed).toLocaleString()} gas
      </span>
    </div>
  );
}

/**
 * The ASCII guide that makes nesting readable.
 *
 * Drawn with box characters rather than indentation alone: at depth four,
 * plain padding leaves the reader counting pixels to see which call a row
 * belongs to.
 */
function TreeGuide({
  guides,
  depth,
  isLast,
}: {
  guides: boolean[];
  depth: number;
  isLast: boolean;
}) {
  if (depth <= 1) return <span className="font-mono theme-text-muted" />;
  return (
    <span className="font-mono theme-text-muted select-none" aria-hidden>
      {guides.map((continues, i) => (
        <span key={i}>{continues ? "│ " : "  "}</span>
      ))}
      {isLast ? "└─" : "├─"}
    </span>
  );
}

function CallTypeBadge({ type }: { type: string }) {
  // DELEGATECALL and STATICCALL are not decoration: one runs in the caller's
  // storage, the other cannot write at all. The badge stays.
  const notable = type === "DELEGATECALL" || type === "STATICCALL";
  return (
    <span
      className="text-[10px] font-mono px-1 shrink-0"
      style={{
        color: notable
          ? "var(--color-warning)"
          : "var(--color-text-muted)",
      }}
    >
      {type}
    </span>
  );
}

function MethodName({
  expr,
}: {
  expr: ReturnType<typeof toCallExpression>;
}) {
  const name = (
    <span className="theme-text font-medium">
      {expr.method}
      {expr.methodIsGuess && <span className="theme-text-muted">?</span>}
    </span>
  );

  if (!expr.methodIsGuess) return name;
  return (
    <Tooltip label="Several signatures share this selector — the name is a guess">
      {name}
    </Tooltip>
  );
}

/**
 * The argument list.
 *
 * Long lists are cut to the first two with a count, because a swap's calldata
 * runs to six arguments and the point of the line is what was called, not
 * every value. The full list is one hover away.
 */
function Arguments({ expr }: { expr: ReturnType<typeof toCallExpression> }) {
  if (expr.args === null) {
    // No name, or calldata that did not decode. Say how much there was.
    const size = expr.calldataBytes;
    return (
      <span className="theme-text-muted">
        ({size > 4 ? `${size - 4} bytes` : ""})
      </span>
    );
  }

  const shown = expr.args.slice(0, 2);
  const hidden = expr.args.length - shown.length;
  const text = `(${shown.join(", ")}${hidden > 0 ? `, +${hidden}` : ""})`;

  // The hover carries what the row left out: the arguments past the second,
  // and the exact value of any token amount the row trimmed.
  const full = `(${(expr.argsFull ?? expr.args).join(", ")})`;
  if (hidden === 0 && full === text) {
    return <span className="theme-text-secondary">{text}</span>;
  }
  return (
    <Tooltip label={full}>
      <span className="theme-text-secondary">{text}</span>
    </Tooltip>
  );
}
