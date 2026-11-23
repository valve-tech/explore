import { matchClose, stripSource } from "../sourceNav/stripSource";

/** Where a reference-type variable keeps its data. */
export type DataLocation = "memory" | "calldata" | "storage";

/** One parameter or one return variable of a function. */
export interface StackVar {
  /** Null for an unnamed parameter or return value. */
  name: string | null;
  /** Declared type with no spaces, for example "uint256[]" or "address". */
  type: string;
  location: DataLocation | null;
  /** Stack slots the variable uses: 2 for a dynamic calldata value, else 1. */
  slots: number;
  /** Slot offset from the first slot of its list. */
  offset: number;
  /** The declaration text, with single spaces. */
  text: string;
}

export interface FunctionSignature {
  name: string;
  params: StackVar[];
  returns: StackVar[];
  paramSlots: number;
  returnSlots: number;
  /** Offset of the first character after the body '{', in the snippet. */
  bodyStart: number;
  /** The snippet with comments and string contents blanked. */
  stripped: string;
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

function splitTopLevel(inner: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of inner) {
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

const LOCATIONS = new Set(["memory", "calldata", "storage"]);

/** Parse "type [location] [name]". Returns null for anything not understood. */
function parseVar(raw: string, external: boolean): Omit<StackVar, "offset"> | null {
  const text = squash(raw);
  let rest = text;
  let type: string;
  if (/^mapping\s*\(/.test(rest)) {
    const open = rest.indexOf("(");
    const close = matchClose(rest, open);
    if (rest[close] !== ")") return null;
    type = rest.slice(0, close + 1).replace(/\s+/g, "");
    rest = rest.slice(close + 1);
  } else {
    // A function-type variable can use two slots. Do not guess.
    if (/^function\b/.test(rest)) return null;
    const m = /^[A-Za-z_$][\w$.]*/.exec(rest);
    if (!m) return null;
    type = m[0];
    rest = rest.slice(type.length);
    const payable = /^\s+payable\b/.exec(rest);
    if (payable && type === "address") {
      type = "address payable";
      rest = rest.slice(payable[0].length);
    }
  }
  const dims = /^(?:\s*\[[^\]]*\])*/.exec(rest)![0];
  type += dims.replace(/\s+/g, "");
  const words = rest.slice(dims.length).trim().split(/\s+/).filter(Boolean);
  let location: DataLocation | null = null;
  if (words[0] !== undefined && LOCATIONS.has(words[0])) location = words.shift() as DataLocation;
  if (words.length > 1) return null;
  const name = words[0] ?? null;
  if (name !== null && !/^[A-Za-z_$][\w$]*$/.test(name)) return null;
  const dynamic = type === "bytes" || type === "string" || type.endsWith("[]");
  // Before Solidity 0.5 a reference type has no location keyword. It is
  // calldata in an external function and memory in every other function.
  if (location === null && (dynamic || type.endsWith("]"))) location = external ? "calldata" : "memory";
  return { name, type, location, slots: location === "calldata" && dynamic ? 2 : 1, text };
}

function parseList(inner: string, external: boolean): { vars: StackVar[]; slots: number } | null {
  const vars: StackVar[] = [];
  let slots = 0;
  if (inner.trim() === "") return { vars, slots };
  for (const part of splitTopLevel(inner)) {
    const v = parseVar(part, external);
    if (!v) return null;
    vars.push({ ...v, offset: slots });
    slots += v.slots;
  }
  return { vars, slots };
}

/**
 * Parse the header of a function from its source text. The text must start
 * at the `function` keyword and must have a body. Returns null when a part of
 * the header is not understood: a wrong slot count gives a wrong value.
 */
export function parseFunctionSignature(snippet: string): FunctionSignature | null {
  const stripped = stripSource(snippet);
  const head = /^\s*function\s+([A-Za-z_$][\w$]*)\s*\(/.exec(stripped);
  if (!head) return null;
  const open = head[0].length - 1;
  const close = matchClose(stripped, open);
  if (stripped[close] !== ")") return null;
  const brace = stripped.indexOf("{", close);
  if (brace === -1) return null;
  const semi = stripped.indexOf(";", close);
  if (semi !== -1 && semi < brace) return null;
  const specifiers = stripped.slice(close + 1, brace);
  const external = /\bexternal\b/.test(specifiers);
  const params = parseList(stripped.slice(open + 1, close), external);
  if (!params) return null;
  let returns: { vars: StackVar[]; slots: number } = { vars: [], slots: 0 };
  const ret = /\breturns\s*\(/.exec(specifiers);
  if (ret) {
    const rOpen = close + 1 + ret.index + ret[0].length - 1;
    const rClose = matchClose(stripped, rOpen, brace);
    if (stripped[rClose] !== ")") return null;
    // A return value never lives in calldata before 0.6.9; later it is explicit.
    const parsed = parseList(stripped.slice(rOpen + 1, rClose), false);
    if (!parsed) return null;
    returns = parsed;
  }
  return {
    name: head[1]!,
    params: params.vars,
    returns: returns.vars,
    paramSlots: params.slots,
    returnSlots: returns.slots,
    bodyStart: brace + 1,
    stripped,
  };
}
