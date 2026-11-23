import { keccak256 } from "viem";
import { clickContextAt, findLocalDecl } from "../sourceNav/clickContext";
import { linearize } from "../sourceNav/linearize";
import type { ContractDecl, Decl, SolIndex } from "../sourceNav/solIndex";
import type { HoverStorageLayout, LayoutEntry, LayoutType } from "./layoutTypes";
import { slotKey } from "./slotWord";

/** Where a hovered state variable lives in storage. */
export interface StateVarRef {
  /** Display name: "limited", "slot0.tick", "nonces[5]". */
  name: string;
  /** solc type label: "uint256", "contract IERC20", "mapping(address => uint256)". */
  typeLabel: string;
  encoding: string;
  slot: bigint;
  /** Byte offset in the slot, from the low end. */
  offset: number;
  numberOfBytes: number;
  /** "value": one packed value this module can decode. "opaque": describe only. */
  kind: "value" | "opaque";
}

export interface ResolveStateVarInput {
  /** buildSolIndex() of the source files of the CODE that the frame runs. */
  index: SolIndex;
  /** The hover position: file name, 1-based line, 0-based column. */
  file: string;
  line: number;
  col: number;
  /** The storage layout of the same code address. */
  layout: HoverStorageLayout;
  /** The contract the layout was compiled for (the most derived contract). */
  contractName: string | null | undefined;
}

const NOT_A_VALUE_USE = new Set([
  "emit", "new", "revert", "function", "modifier", "event", "error", "struct", "enum",
  "contract", "interface", "library", "is", "using", "import", "type",
]);
const DECL_IS_LOCAL_SCOPE = new Set(["function", "modifier", "constructor", "receive", "fallback"]);

const VALUE_LABEL = /^(?:address(?: payable)?|bool|u?int(?:\d+)?|bytes(?:[1-9]|[12]\d|3[0-2])|contract .+|enum .+)$/;

function isValueType(t: LayoutType): boolean {
  const n = Number.parseInt(t.numberOfBytes, 10);
  return t.encoding === "inplace" && n >= 1 && n <= 32 && !t.members && !t.base && VALUE_LABEL.test(t.label);
}

const declHead = (index: SolIndex, d: Decl): string => {
  const text = index.files.get(d.file)?.text.slice(d.start, d.end) ?? "";
  const eq = text.search(/=(?!>)/);
  return eq === -1 ? text : text.slice(0, eq);
};
/** False for constant, immutable and transient variables: they have no storage slot. */
const inStorage = (index: SolIndex, d: Decl) => !/\b(?:constant|immutable|transient)\b/.test(declHead(index, d));
const isPrivate = (index: SolIndex, d: Decl) => /\bprivate\b/.test(declHead(index, d));

const stateVars = (c: ContractDecl | undefined, name?: string): Decl[] =>
  (c?.members ?? []).filter((m) => m.kind === "state-var" && (name === undefined || m.name === name));

const prevChar = (text: string, i: number): string => {
  while (i > 0 && /\s/.test(text[i - 1]!)) i--;
  return text[i - 1] ?? "";
};
const nextIndex = (text: string, i: number): number => {
  while (i < text.length && /\s/.test(text[i]!)) i++;
  return i;
};

/**
 * Find the layout entry of state variable `name`, as code in `enclosing`
 * sees it. Null when the source and the layout do not agree.
 */
function layoutEntryFor(
  index: SolIndex,
  layout: HoverStorageLayout,
  leaf: string,
  enclosing: ContractDecl,
  name: string,
): LayoutEntry | null {
  const leafLin = linearize(index, leaf);
  if (!index.byName.has(leaf) || !leafLin.includes(enclosing.name)) return null;
  // Two contracts with one name make every lookup by name unsafe.
  for (const n of leafLin) {
    if (index.contracts.filter((c) => c.name === n).length !== 1) return null;
  }
  // The declaration that the name refers to: most derived first, and a
  // private variable of a base is not visible.
  let decl: Decl | null = null;
  for (const n of linearize(index, enclosing.name)) {
    const own = stateVars(index.byName.get(n), name);
    if (own.length > 1) return null;
    if (own.length === 1 && (n === enclosing.name || !isPrivate(index, own[0]!))) { decl = own[0]!; break; }
  }
  if (!decl || !inStorage(index, decl)) return null;
  // solc lays storage out from the most base contract to the most derived.
  const baseFirst = [...leafLin].reverse();
  const declared = baseFirst.flatMap((n) => stateVars(index.byName.get(n)).filter((d) => inStorage(index, d)));
  const sameName = declared.filter((d) => d.name === name);
  const entries = layout.storage.filter((e) => e.label === name);
  if (entries.length !== sameName.length) return null;
  const at = sameName.indexOf(decl);
  if (at === -1) return null;
  if (entries.length > 1) {
    // A repeated label is safe only when the whole source order matches the layout.
    const labels = layout.storage.map((e) => e.label);
    if (labels.length !== declared.length || labels.some((l, i) => l !== declared[i]!.name)) return null;
  }
  return entries[at] ?? null;
}

/** The storage slot of mapping element `base[key]` for a literal key. Null when not sure. */
function literalMappingSlot(keyLabel: string, literal: string, base: bigint): bigint | null {
  let key: bigint;
  if (/^uint(?:\d+)?$/.test(keyLabel) && /^\d+$/.test(literal)) key = BigInt(literal);
  else if (keyLabel === "address" && /^0x[0-9a-fA-F]{40}$/.test(literal)) key = BigInt(literal);
  else return null;
  if (key >= 1n << 256n) return null;
  return BigInt(keccak256(`0x${slotKey(key).slice(2)}${slotKey(base).slice(2)}`));
}

function refOf(name: string, t: LayoutType, slot: bigint, offset: number): StateVarRef {
  return {
    name, typeLabel: t.label, encoding: t.encoding, slot, offset,
    numberOfBytes: Number.parseInt(t.numberOfBytes, 10), kind: isValueType(t) ? "value" : "opaque",
  };
}

/**
 * Resolve the identifier under the pointer to a contract state variable.
 * Returns null for everything else, and for every case that is not certain.
 */
export function resolveStateVar(input: ResolveStateVarInput): StateVarRef | null {
  const { index, layout, contractName } = input;
  const pf = index.files.get(input.file);
  if (!pf || !contractName) return null;
  const ctx = clickContextAt(pf, input.line, input.col);
  if (!ctx) return null;
  const text = pf.text;
  const enclosing = index.contracts.find((c) => c.file === input.file && c.start <= ctx.start && ctx.start < c.end);
  if (!enclosing || enclosing.kind === "interface" || enclosing.kind === "library") return null;
  const member = enclosing.members.find((m) => m.start <= ctx.start && ctx.start < m.end);
  if (member && member.kind !== "state-var" && !DECL_IS_LOCAL_SCOPE.has(member.kind)) return null;

  // `base` is the state variable. `field` is a struct member of it, if any.
  let base = ctx.word;
  let baseStart = ctx.start;
  let field: string | null = null;
  if (ctx.receiver.kind === "name") {
    field = ctx.word;
    base = ctx.receiver.name;
    let i = ctx.start;
    while (i > 0 && /\s/.test(text[i - 1]!)) i--;
    i--; // the dot
    while (i > 0 && /\s/.test(text[i - 1]!)) i--;
    baseStart = i - base.length;
    if (text.slice(baseStart, i) !== base || prevChar(text, baseStart) === ".") return null;
  } else if (ctx.receiver.kind !== "none") return null;
  if (ctx.isCall) return null;
  if (!field && ctx.prevWord && NOT_A_VALUE_USE.has(ctx.prevWord)) return null;

  const end = ctx.start + ctx.word.length;
  const after = nextIndex(text, end);
  // A name in a named-argument list or in call options: `f({limited: true})`.
  const before = prevChar(text, baseStart);
  if (text[after] === ":" && (before === "{" || before === ",")) return null;
  // A parameter or a local with the same name hides the state variable.
  if (member && member.kind !== "state-var" && findLocalDecl(text, member.start, member.end, base)) return null;

  const entry = layoutEntryFor(index, layout, contractName, enclosing, base);
  const type = entry ? layout.types[entry.type] : undefined;
  if (!entry || !type || !/^\d+$/.test(entry.slot)) return null;
  const slot = BigInt(entry.slot);

  if (field) {
    if (text[after] === "[" || type.encoding !== "inplace" || !type.members) return null;
    const hits = type.members.filter((m) => m.label === field);
    const mt = hits.length === 1 ? layout.types[hits[0]!.type] : undefined;
    if (!mt || !/^\d+$/.test(hits[0]!.slot)) return null;
    return refOf(`${base}.${field}`, mt, slot + BigInt(hits[0]!.slot), hits[0]!.offset);
  }
  if (text[after] === "[") {
    // `name[key]`: only a mapping with a literal key and a value-type result.
    const close = text.indexOf("]", after);
    const literal = close === -1 ? "" : text.slice(after + 1, close).trim();
    const keyT = type.key ? layout.types[type.key] : undefined;
    const valT = type.value ? layout.types[type.value] : undefined;
    if (type.encoding !== "mapping" || !keyT || !valT || !isValueType(valT)) return null;
    const next = text[nextIndex(text, close + 1)];
    if (next === "[" || next === ".") return null;
    const elem = literalMappingSlot(keyT.label, literal, slot);
    return elem === null ? null : refOf(`${base}[${literal}]`, valT, elem, 0);
  }
  return refOf(base, type, slot, entry.offset);
}
