import { getAddress } from "viem";
import type { StackVar } from "./functionSignature";
import type { HoverSource } from "./types";

/** What a user-defined type name is. */
export type UserTypeInfo =
  | { kind: "contract" }
  | { kind: "enum"; members: readonly string[] }
  | { kind: "struct" };

export type TypeResolver = (typeName: string) => UserTypeInfo | null;

export interface FormatContext {
  /** Memory of the frame at the step: 32-byte words, as the API sends them. */
  memory?: readonly string[] | null;
  /** Call data of the frame, as a hex string. */
  calldata?: string | null;
  resolveType?: TypeResolver;
}

export interface Formatted {
  value: string;
  source: HoverSource;
  note?: string;
}

const MASK256 = (1n << 256n) - 1n;
const MAX_BYTES = 1024;
const MAX_ITEMS = 32;

const hex = (n: bigint) => "0x" + n.toString(16);
const hex32 = (n: bigint) => "0x" + n.toString(16).padStart(64, "0");

/**
 * Format one stack word as a value type. Solidity can leave unused high bits
 * of a small type dirty on the stack, so each type masks the word first.
 * Returns null when the type is not a known value type.
 */
export function formatValueWord(type: string, word: bigint, resolveType?: TypeResolver): string | null {
  if (type === "address" || type === "address payable") {
    return getAddress("0x" + (word & ((1n << 160n) - 1n)).toString(16).padStart(40, "0"));
  }
  if (type === "bool") return word === 0n ? "false" : "true";
  let m = /^(u?)int(\d*)$/.exec(type);
  if (m) {
    const bits = m[2] === "" ? 256 : Number(m[2]);
    if (bits < 8 || bits > 256 || bits % 8 !== 0) return null;
    const low = word & ((1n << BigInt(bits)) - 1n);
    if (m[1] === "u") return low.toString();
    return (low >> BigInt(bits - 1) === 1n ? low - (1n << BigInt(bits)) : low).toString();
  }
  m = /^bytes(\d+)$/.exec(type);
  if (m || type === "byte") {
    const size = m ? Number(m[1]) : 1;
    if (size < 1 || size > 32) return null;
    return "0x" + word.toString(16).padStart(64, "0").slice(0, size * 2);
  }
  if (!/^[A-Za-z_$][\w$.]*$/.test(type)) return null;
  const info = resolveType?.(type) ?? null;
  if (info?.kind === "contract") return formatValueWord("address", word);
  if (info?.kind === "enum") {
    const n = Number(word & 0xffn);
    const member = info.members[n];
    return member === undefined ? String(n) : `${member} (${n})`;
  }
  return null;
}

/**
 * A stack word of the trace API as a number. Accepts hex with or without
 * "0x". Returns null for text that is not a hex word.
 */
export function wordOf(hexWord: string): bigint | null {
  const digits = hexWord.startsWith("0x") ? hexWord.slice(2) : hexWord;
  if (!/^[0-9a-fA-F]{0,64}$/.test(digits)) return null;
  return digits === "" ? 0n : BigInt("0x" + digits);
}

const joined = new WeakMap<object, string>();

/** Read `size` bytes at `offset` as hex digits, or null when out of range. */
function readHex(words: readonly string[] | string, offset: bigint, size: bigint): string | null {
  let data: string;
  if (typeof words === "string") data = words.startsWith("0x") ? words.slice(2) : words;
  else {
    let cached = joined.get(words);
    if (cached === undefined) {
      cached = words.map((w) => (w.startsWith("0x") ? w.slice(2) : w)).join("");
      joined.set(words, cached);
    }
    data = cached;
  }
  if (offset < 0n || size < 0n || (offset + size) * 2n > BigInt(data.length)) return null;
  return data.slice(Number(offset) * 2, Number(offset + size) * 2);
}

function showBytes(type: string, digits: string, length: bigint): { value: string; note?: string } {
  const note = length > BigInt(MAX_BYTES) ? `shows the first ${MAX_BYTES} of ${length} bytes` : undefined;
  if (type === "string") {
    const bytes = new Uint8Array(digits.length / 2);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(digits.slice(i * 2, i * 2 + 2), 16);
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      return { value: JSON.stringify(text) + (note ? "…" : ""), note };
    } catch {
      return { value: "0x" + digits, note: note ?? "not valid UTF-8: shown as hex" };
    }
  }
  return { value: "0x" + digits + (note ? "…" : ""), note };
}

/** Decode `count` words at `start` as elements of a value type. */
function showItems(
  elementType: string,
  data: readonly string[] | string,
  start: bigint,
  count: bigint,
  resolveType?: TypeResolver,
): { value: string; note?: string } | null {
  const shown = count > BigInt(MAX_ITEMS) ? MAX_ITEMS : Number(count);
  const items: string[] = [];
  for (let i = 0; i < shown; i++) {
    const digits = readHex(data, start + BigInt(i) * 32n, 32n);
    const item = digits === null ? null : formatValueWord(elementType, BigInt("0x" + digits), resolveType);
    if (item === null) return null;
    items.push(item);
  }
  const more = BigInt(shown) < count;
  return {
    value: "[" + items.join(", ") + (more ? ", …" : "") + "]",
    note: more ? `shows the first ${MAX_ITEMS} of ${count} items` : undefined,
  };
}

const ARRAY = /^(.*)\[(\d*)\]$/;

function fromRegion(
  v: StackVar,
  data: readonly string[] | string,
  source: "memory" | "calldata",
  /** Offset of the data, and the length when the stack holds it. */
  at: bigint,
  length: bigint | null,
  ctx: FormatContext,
): Formatted | null {
  if (v.type === "bytes" || v.type === "string") {
    let size = length;
    let start = at;
    if (size === null) {
      const head = readHex(data, at, 32n);
      if (head === null) return null;
      size = BigInt("0x" + head);
      start = at + 32n;
    }
    const take = size > BigInt(MAX_BYTES) ? BigInt(MAX_BYTES) : size;
    const digits = readHex(data, start, size) === null ? null : readHex(data, start, take);
    return digits === null ? null : { ...showBytes(v.type, digits, size), source };
  }
  const arr = ARRAY.exec(v.type);
  if (!arr) return null;
  let count: bigint;
  let start = at;
  if (arr[2] !== "") count = BigInt(arr[2]!);
  else if (length !== null) count = length;
  else {
    const head = readHex(data, at, 32n);
    if (head === null) return null;
    count = BigInt("0x" + head);
    start = at + 32n;
  }
  if (readHex(data, start, count * 32n) === null) return null;
  const shown = showItems(arr[1]!, data, start, count, ctx.resolveType);
  return shown ? { ...shown, source } : null;
}

/**
 * Format a variable from its stack slots. `words` holds one word for each
 * slot, in stack order. Returns null when the slot count does not agree.
 */
export function formatStackVar(v: StackVar, words: readonly bigint[], ctx: FormatContext): Formatted | null {
  if (words.length !== v.slots || words.some((w) => w < 0n || w > MASK256)) return null;
  const first = words[0]!;
  if (v.location === "storage" || v.type.startsWith("mapping(")) {
    return { value: `storage slot ${hex(first)}`, source: "stack", note: "storage reference: contents not decoded" };
  }
  if (v.location === "memory") {
    const decoded = ctx.memory ? fromRegion(v, ctx.memory, "memory", first, null, ctx) : null;
    return decoded ?? { value: `memory @${hex(first)}`, source: "stack", note: "memory pointer: contents not decoded" };
  }
  if (v.location === "calldata") {
    const length = v.slots === 2 ? words[1]! : null;
    const fixed = ARRAY.exec(v.type);
    const decodable = v.slots === 2 || (fixed !== null && fixed[2] !== "");
    const decoded = ctx.calldata && decodable ? fromRegion(v, ctx.calldata, "calldata", first, length, ctx) : null;
    if (decoded) return decoded;
    const size = length === null ? "" : ` (length ${length})`;
    return { value: `calldata @${hex(first)}${size}`, source: "stack", note: "calldata reference: contents not decoded" };
  }
  const value = formatValueWord(v.type, first, ctx.resolveType);
  if (value !== null) return { value, source: "stack" };
  return { value: hex32(first), source: "stack", note: `raw stack word: type ${v.type} not decoded` };
}
