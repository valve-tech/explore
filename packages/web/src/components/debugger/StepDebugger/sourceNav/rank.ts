import type { ContractDecl, Decl, DeclKind, SolIndex } from "./solIndex";
import type { NavTarget } from "./navTypes";

const FN_KINDS = new Set<DeclKind>(["function"]);

export const toTarget = (d: Decl, addr?: string): NavTarget => ({
  file: d.file, line: d.line, kind: d.kind, owner: d.owner, hasBody: d.hasBody, ...(addr ? { addr } : {}),
});
export const contractTarget = (c: ContractDecl): NavTarget => ({
  file: c.file, line: c.line, owner: null, hasBody: true,
  kind: c.kind === "interface" ? "interface" : c.kind === "library" ? "library" : "contract",
});

export function allDecls(index: SolIndex, name: string): Decl[] {
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
