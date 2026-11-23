import { buildSolIndex, type ContractDecl, type Decl, type DeclKind, type SolIndex } from "./solIndex";
import { linearize, pickLeafContract } from "./linearize";
import { clickContextAt, findLocalDecl, importPathAt, resolveImportFile, type ClickContext } from "./clickContext";
import { lineAt } from "./stripSource";
import type { ClickInput, NavAction, NavTarget } from "./navTypes";
import { allDecls, contractTarget, rankFunctions, toTarget } from "./rank";
import { memberCall } from "./memberCall";

export const INTERFACE_ONLY_NOTE =
  "No implementation source is loaded. This is the interface declaration.";

const NONE: NavAction = { type: "none" };
const ACTING_TOKENS = new Set(["identifier", "function", "string"]);
function enclosing(index: SolIndex, file: string, offset: number): { contract: ContractDecl | null; member: Decl | null } {
  const contract = index.contracts.find((c) => c.file === file && c.start <= offset && offset < c.end) ?? null;
  const pool = contract ? contract.members : index.free.filter((d) => d.file === file);
  return { contract, member: pool.find((d) => d.start <= offset && offset < d.end) ?? null };
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
  if (input.tokenType === "function") ctx.isCall = true;
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
  if (input.tokenType && !ACTING_TOKENS.has(input.tokenType)) return NONE;
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
