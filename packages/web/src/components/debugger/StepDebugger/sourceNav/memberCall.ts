import { buildSolIndex, type ContractDecl, type SolIndex } from "./solIndex";
import { linearize, pickLeafContract } from "./linearize";
import type { ClickContext } from "./clickContext";
import type { ClickInput, NavTarget } from "./navTypes";
import { allDecls, rankFunctions, toTarget } from "./rank";

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

/** Candidates for `receiver.word(...)`: super, this, a type, a variable or a cast. */
export function memberCall(input: ClickInput, index: SolIndex, ctx: ClickContext, self: ContractDecl | null, order: string[], typeOf: (n: string) => string | null): NavTarget[] {
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
