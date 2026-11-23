import type { SourceFile } from "../../../../api/source";
import { buildSolIndex, type ContractDecl, type Decl, type DeclKind, type SolIndex } from "./solIndex";
import { linearize, pickLeafContract } from "./linearize";
import { clickContextAt, findLocalDecl, importPathAt, resolveImportFile, type ClickContext } from "./clickContext";
import { lineAt } from "./stripSource";

export type ClickModifier = "plain" | "meta" | "alt";
export type TargetKind = DeclKind | "contract" | "interface" | "library" | "local";

export interface NavTarget {
  file: string;
  line: number;
  kind: TargetKind;
  owner: string | null;
  /** False for an interface or abstract declaration. */
  hasBody: boolean;
  /** Set when the target is in ANOTHER contract's source (the callee). */
  addr?: string;
}

export type NavAction =
  | { type: "none" }
  /** Scroll the source pane to one declaration. */
  | { type: "goto"; label: string; target: NavTarget; interfaceOnly?: boolean; note?: string }
  | { type: "open-file"; file: string }
  /** Move the cursor to the step where this line executes in the frame. */
  | { type: "step"; label: string; line: number }
  | { type: "list"; label: string; targets: NavTarget[] };

export interface ClickInput {
  files: readonly SourceFile[];
  file: string;
  /** 1-based line. */
  line: number;
  /** 0-based column of any character of the clicked token. */
  col: number;
  modifier: ClickModifier;
  /** Verified name of the contract that executes, when known. */
  contractName?: string | null;
  /** Sources of the next external callee of this frame, implementation first. */
  callee?: ReadonlyArray<{ addr: string; files: readonly SourceFile[] }>;
  /** Prebuilt index of `files`. */
  index?: SolIndex;
}

export const INTERFACE_ONLY_NOTE =
  "No implementation source is loaded. This is the interface declaration.";

const NONE: NavAction = { type: "none" };
const FN_KINDS = new Set<DeclKind>(["function"]);

const toTarget = (d: Decl, addr?: string): NavTarget => ({
  file: d.file, line: d.line, kind: d.kind, owner: d.owner, hasBody: d.hasBody, ...(addr ? { addr } : {}),
});
const contractTarget = (c: ContractDecl): NavTarget => ({
  file: c.file, line: c.line, owner: null, hasBody: true,
  kind: c.kind === "interface" ? "interface" : c.kind === "library" ? "library" : "contract",
});

function allDecls(index: SolIndex, name: string): Decl[] {
  return [...index.contracts.flatMap((c) => c.members), ...index.free].filter((d) => d.name === name);
}

/**
 * Rank the functions called `name`. A function with a body beats a bare
 * declaration; then the position of the owner in `order` (most derived
 * first) decides. `argc` selects an overload when one matches.
 */
export function rankFunctions(index: SolIndex, name: string, argc: number | null, order: readonly string[]): Decl[] {
  const all = allDecls(index, name).filter((d) => FN_KINDS.has(d.kind));
  const exact = argc === null ? [] : all.filter((d) => d.paramCount === argc);
  const pool = exact.length > 0 ? exact : all;
  const pos = (d: Decl) => {
    const i = d.owner ? order.indexOf(d.owner) : -1;
    return i === -1 ? order.length + 1 : i;
  };
  return pool
    .map((d, i) => ({ d, i }))
    .sort((a, b) => Number(b.d.hasBody) - Number(a.d.hasBody) || pos(a.d) - pos(b.d) || a.i - b.i)
    .map((x) => x.d);
}

function enclosing(index: SolIndex, file: string, offset: number): { contract: ContractDecl | null; member: Decl | null } {
  const contract = index.contracts.find((c) => c.file === file && c.start <= offset && offset < c.end) ?? null;
  const pool = contract ? contract.members : index.free.filter((d) => d.file === file);
  return { contract, member: pool.find((d) => d.start <= offset && offset < d.end) ?? null };
}

function usingLibs(index: SolIndex, contract: ContractDecl | null, typeName: string | null): string[] {
  return [...(contract?.usingFor ?? []), ...index.usingFor]
    .filter((u) => u.type === "*" || typeName === null || u.type === typeName)
    .map((u) => u.lib);
}

/** An external call on type `typeName`: callee source, then local source, then the interface. */
function externalCall(input: ClickInput, index: SolIndex, typeName: string, name: string, argc: number | null): NavTarget[] {
  const out: NavTarget[] = [];
  for (const c of input.callee ?? []) {
    const ci = buildSolIndex(c.files);
    const leaf = pickLeafContract(ci, ci.byName.has(typeName) ? typeName : null);
    const order = leaf ? linearize(ci, leaf) : [];
    for (const d of rankFunctions(ci, name, argc, order)) if (d.hasBody) out.push(toTarget(d, c.addr));
  }
  const implementers = index.contracts
    .filter((c) => c.kind !== "interface")
    .map((c) => ({ name: c.name, lin: linearize(index, c.name) }))
    .filter((c) => c.lin.includes(typeName))
    .sort((a, b) => b.lin.length - a.lin.length);
  const order = [...new Set(implementers.flatMap((c) => c.lin))];
  for (const d of rankFunctions(index, name, argc, order)) out.push(toTarget(d));
  return out;
}

function memberCall(input: ClickInput, index: SolIndex, ctx: ClickContext, self: ContractDecl | null, order: string[], typeOf: (n: string) => string | null): NavTarget[] {
  const { word, argCount, receiver } = ctx;
  if (receiver.kind === "super") {
    const rest = self ? order.slice(order.indexOf(self.name) + 1) : [];
    return rankFunctions(index, word, argCount, rest).filter((d) => d.owner !== null && rest.includes(d.owner)).map((d) => toTarget(d));
  }
  if (receiver.kind === "this") return rankFunctions(index, word, argCount, order).map((d) => toTarget(d));
  const libArgc = argCount === null ? null : argCount + 1;
  const viaLibs = (typeName: string | null) =>
    usingLibs(index, self, typeName).flatMap((lib) => rankFunctions(index, word, libArgc, [lib]).filter((d) => d.owner === lib)).map((d) => toTarget(d));
  if (receiver.kind === "unknown") return viaLibs(null);
  if (receiver.kind === "none") return [];

  const isTypeName = receiver.kind === "name" && index.byName.has(receiver.name) && typeOf(receiver.name) === null;
  const typeName = receiver.kind === "cast" ? receiver.typeName : isTypeName ? receiver.name : typeOf(receiver.name);
  const type = typeName ? index.byName.get(typeName) : undefined;
  if (!typeName) return viaLibs(null);
  if (!type) return viaLibs(typeName);
  const typeLin = linearize(index, type.name);
  const declared = allDecls(index, word).some((d) => d.owner !== null && typeLin.includes(d.owner) && d.kind === "function");
  if (type.kind === "library" || (isTypeName && order.includes(type.name))) {
    // `Lib.f()` or an explicit base call `Base.f()`: stay inside that type.
    return rankFunctions(index, word, argCount, typeLin).filter((d) => d.owner !== null && typeLin.includes(d.owner)).map((d) => toTarget(d));
  }
  if (declared) return externalCall(input, index, type.name, word, argCount);
  const libs = viaLibs(type.name);
  if (libs.length > 0) return libs;
  const getter = allDecls(index, word).filter((d) => d.kind === "state-var" && d.owner !== null && typeLin.includes(d.owner));
  return getter.map((d) => toTarget(d));
}

const KIND_FIRST: Record<string, DeclKind> = { emit: "event", revert: "error" };

function plainName(index: SolIndex, ctx: ClickContext, pf: { text: string; lineStarts: number[]; name: string }, member: Decl | null, order: string[]): NavTarget[] {
  const out: NavTarget[] = [];
  if (member && !ctx.isCall) {
    const local = findLocalDecl(pf.text, member.start, member.end, ctx.word);
    if (local) out.push({ file: pf.name, line: lineAt(pf.lineStarts, local.offset), kind: "local", owner: member.owner, hasBody: true });
  }
  const decls = allDecls(index, ctx.word);
  const pos = (d: Decl) => {
    const i = d.owner ? order.indexOf(d.owner) : -1;
    return i === -1 ? order.length + 1 : i;
  };
  const first = ctx.prevWord ? KIND_FIRST[ctx.prevWord] : undefined;
  const fns = rankFunctions(index, ctx.word, ctx.isCall ? ctx.argCount : null, order);
  const others = decls
    .filter((d) => d.kind !== "function")
    .map((d, i) => ({ d, i }))
    .sort((a, b) => Number(b.d.kind === first) - Number(a.d.kind === first) || pos(a.d) - pos(b.d) || a.i - b.i)
    .map((x) => x.d);
  const inScope = (d: Decl) => d.owner === null || order.includes(d.owner);
  const ordered = [...others.filter(inScope), ...fns.filter(inScope)];
  const type = index.byName.get(ctx.word);
  out.push(...ordered.map((d) => toTarget(d)));
  if (type) out.push(contractTarget(type));
  out.push(...[...others, ...fns].filter((d) => !inScope(d)).map((d) => toTarget(d)));
  return out;
}

/** All candidate declarations for a click, best first. */
export function resolveCandidates(input: ClickInput): { ctx: ClickContext; targets: NavTarget[] } | null {
  const index = input.index ?? buildSolIndex(input.files);
  const pf = index.files.get(input.file);
  if (!pf) return null;
  const ctx = clickContextAt(pf, input.line, input.col);
  if (!ctx) return null;
  const { contract: self, member } = enclosing(index, input.file, ctx.start);
  const leaf = pickLeafContract(index, self?.name ?? null, input.contractName);
  const order = leaf ? linearize(index, leaf) : [];
  const typeOf = (name: string): string | null => {
    const local = member ? findLocalDecl(pf.text, member.start, member.end, name) : null;
    if (local) return local.typeName;
    const sv = allDecls(index, name).find((d) => d.kind === "state-var" && d.owner !== null && order.includes(d.owner));
    return sv?.typeName ?? null;
  };
  if (ctx.receiver.kind !== "none") {
    if (ctx.isCall) return { ctx, targets: memberCall(input, index, ctx, self, order, typeOf) };
    // `Type.member`: an enum value, a constant, a selector.
    const r = ctx.receiver;
    const type = r.kind === "name" && typeOf(r.name) === null ? index.byName.get(r.name) : undefined;
    if (type) {
      const lin = linearize(index, type.name);
      return { ctx, targets: allDecls(index, ctx.word).filter((d) => d.owner !== null && lin.includes(d.owner)).map((d) => toTarget(d)) };
    }
    if (r.kind === "name" && typeOf(r.name) === null) {
      return { ctx, targets: allDecls(index, r.name).filter((d) => d.kind === "enum").map((d) => toTarget(d)) };
    }
    return { ctx, targets: [] };
  }
  return { ctx, targets: plainName(index, ctx, pf, member, order) };
}

/** Resolve one click in the source pane to exactly one action. */
export function resolveSourceClick(input: ClickInput): NavAction {
  const index = input.index ?? buildSolIndex(input.files);
  const pf = index.files.get(input.file);
  if (!pf) return NONE;
  const path = importPathAt(pf, input.line, input.col);
  if (path !== null) {
    const file = resolveImportFile(path, [...index.files.keys()]);
    return file && file !== input.file ? { type: "open-file", file } : NONE;
  }
  const res = resolveCandidates({ ...input, index });
  if (!res || res.targets.length === 0) return NONE;
  const { ctx, targets } = res;
  const label = ctx.word;
  if (input.modifier === "alt") return { type: "list", label, targets };
  const isSelf = (t: NavTarget) => !t.addr && t.file === input.file && t.line === input.line;
  if (input.modifier === "meta" && ctx.isCall && !targets.some(isSelf)) {
    return { type: "step", label, line: input.line };
  }
  const target = targets[0]!;
  if (isSelf(target)) return NONE;
  const isFn = target.kind === "function";
  if (isFn && !target.hasBody) return { type: "goto", label, target, interfaceOnly: true, note: INTERFACE_ONLY_NOTE };
  return { type: "goto", label, target };
}
