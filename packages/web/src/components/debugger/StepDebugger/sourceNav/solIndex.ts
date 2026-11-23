import type { SourceFile } from "../../../../api/source";
import {
  countTopLevelItems,
  lineAt,
  lineStartsOf,
  matchClose,
  stripSource,
} from "./stripSource";

export type DeclKind =
  | "function" | "modifier" | "event" | "error" | "struct" | "enum"
  | "state-var" | "constructor" | "receive" | "fallback";

export type ContractKind = "contract" | "abstract" | "interface" | "library";

export interface Decl {
  kind: DeclKind;
  name: string;
  file: string;
  line: number;
  /** Owning contract, or null for a file-level declaration. */
  owner: string | null;
  /** False for an interface or abstract declaration that ends in ';'. */
  hasBody: boolean;
  paramCount: number | null;
  /** Declared type of a state variable. */
  typeName?: string;
  /** Offsets of the whole declaration in the stripped file text. */
  start: number;
  end: number;
}

export interface UsingFor { lib: string; type: string }

export interface ContractDecl {
  name: string;
  kind: ContractKind;
  bases: string[];
  file: string;
  line: number;
  start: number;
  end: number;
  members: Decl[];
  usingFor: UsingFor[];
}

export interface ParsedFile {
  name: string;
  raw: string;
  text: string;
  lineStarts: number[];
}

export interface SolIndex {
  files: Map<string, ParsedFile>;
  contracts: ContractDecl[];
  byName: Map<string, ContractDecl>;
  free: Decl[];
  usingFor: UsingFor[];
}

interface Statement { start: number; headEnd: number; bodyStart: number | null; end: number }

/** Split `[from, to)` into statements that end in ';' or in a '{…}' block. */
function scanStatements(text: string, from: number, to: number): Statement[] {
  const out: Statement[] = [];
  let i = from;
  while (i < to) {
    while (i < to && /\s/.test(text[i]!)) i++;
    if (i >= to) break;
    const start = i;
    let depth = 0;
    let closed = false;
    for (; i < to; i++) {
      const c = text[i]!;
      if (c === "(" || c === "[") depth++;
      else if (c === ")" || c === "]") depth--;
      else if (c === ";" && depth <= 0) {
        out.push({ start, headEnd: i, bodyStart: null, end: i + 1 });
        i++; closed = true; break;
      } else if (c === "{" && depth <= 0) {
        const close = matchClose(text, i, to);
        out.push({ start, headEnd: i, bodyStart: i + 1, end: close + 1 });
        i = close + 1; closed = true; break;
      } else if (c === "}") { i++; closed = true; break; }
    }
    if (!closed) break;
  }
  return out;
}

function paramCountOf(text: string, from: number, to: number): number | null {
  const open = text.indexOf("(", from);
  if (open === -1 || open >= to) return null;
  const close = matchClose(text, open, to + 1);
  return countTopLevelItems(text.slice(open + 1, close));
}

const lastSegment = (s: string) => s.split(".").pop()!.trim();

function parseBases(list: string | undefined): string[] {
  if (!list) return [];
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of list + ",") {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      const name = lastSegment(cur.replace(/\([\s\S]*$/, ""));
      if (name) out.push(name);
      cur = "";
    } else cur += ch;
  }
  return out;
}

function parseMember(pf: ParsedFile, st: Statement, owner: string | null): Decl | UsingFor | null {
  const head = pf.text.slice(st.start, st.headEnd);
  const base = { file: pf.name, owner, hasBody: st.bodyStart !== null, start: st.start, end: st.end };
  const at = (rel: number) => lineAt(pf.lineStarts, st.start + rel);
  let m: RegExpExecArray | null;
  if ((m = /^using\s+([\w$.]+)\s+for\s+([\w$.*]+)/.exec(head))) {
    return { lib: lastSegment(m[1]!), type: lastSegment(m[2]!) };
  }
  if (/^(?:using|pragma|import|type)\b/.test(head)) return null;
  if ((m = /^(function|modifier)\s+([\w$]+)/.exec(head))) {
    return {
      ...base, kind: m[1] as DeclKind, name: m[2]!, line: at(m[0].length - m[2]!.length),
      paramCount: paramCountOf(pf.text, st.start + m[0].length, st.headEnd) ?? 0,
    };
  }
  if ((m = /^(constructor|receive|fallback)\s*\(/.exec(head))) {
    return { ...base, kind: m[1] as DeclKind, name: m[1]!, line: at(0), paramCount: paramCountOf(pf.text, st.start, st.headEnd) };
  }
  if ((m = /^(event|error|struct|enum)\s+([\w$]+)/.exec(head))) {
    return {
      ...base, kind: m[1] as DeclKind, name: m[2]!, line: at(m[0].length - m[2]!.length), hasBody: true,
      paramCount: m[1] === "event" || m[1] === "error" ? paramCountOf(pf.text, st.start, st.headEnd) : null,
    };
  }
  if (st.bodyStart !== null) return null;
  const eq = head.search(/=(?!>)/);
  const left = eq === -1 ? head : head.slice(0, eq);
  const nameM = /([\w$]+)\s*$/.exec(left);
  const typeM = /^([\w$.]+)/.exec(left);
  if (!nameM || !typeM || nameM.index === 0) return null;
  return {
    ...base, kind: "state-var", name: nameM[1]!, line: at(nameM.index), hasBody: true,
    paramCount: null, typeName: lastSegment(typeM[1]!),
  };
}

const CONTRACT_HEAD = /^(abstract\s+contract|contract|interface|library)\s+([\w$]+)\s*(?:is\b([\s\S]*))?$/;

/** Index every declaration in a verified multi-file source set. No AST. */
export function buildSolIndex(files: readonly SourceFile[]): SolIndex {
  const index: SolIndex = { files: new Map(), contracts: [], byName: new Map(), free: [], usingFor: [] };
  for (const f of files) {
    const text = stripSource(f.content);
    const pf: ParsedFile = { name: f.name, raw: f.content, text, lineStarts: lineStartsOf(text) };
    index.files.set(f.name, pf);
    for (const st of scanStatements(text, 0, text.length)) {
      const head = text.slice(st.start, st.headEnd);
      const cm = st.bodyStart !== null ? CONTRACT_HEAD.exec(head.trim()) : null;
      if (!cm) {
        const d = parseMember(pf, st, null);
        if (d && "lib" in d) index.usingFor.push(d);
        else if (d) index.free.push(d);
        continue;
      }
      const kind: ContractKind = cm[1]!.startsWith("abstract") ? "abstract" : (cm[1] as ContractKind);
      const contract: ContractDecl = {
        name: cm[2]!, kind, bases: parseBases(cm[3]), file: f.name,
        line: lineAt(pf.lineStarts, st.start + head.indexOf(cm[2]!, cm[1]!.length)),
        start: st.start, end: st.end, members: [], usingFor: [],
      };
      for (const inner of scanStatements(text, st.bodyStart!, st.end - 1)) {
        const d = parseMember(pf, inner, contract.name);
        if (d && "lib" in d) contract.usingFor.push(d);
        else if (d) contract.members.push(d);
      }
      index.contracts.push(contract);
      if (!index.byName.has(contract.name)) index.byName.set(contract.name, contract);
    }
  }
  return index;
}
