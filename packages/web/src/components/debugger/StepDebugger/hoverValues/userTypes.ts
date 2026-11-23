import type { Decl, SolIndex } from "../sourceNav/solIndex";
import type { TypeResolver, UserTypeInfo } from "./formatStackValue";

function enumMembers(index: SolIndex, decl: Decl): string[] | null {
  const text = index.files.get(decl.file)?.text.slice(decl.start, decl.end) ?? "";
  const open = text.indexOf("{");
  const close = text.lastIndexOf("}");
  if (open === -1 || close < open) return null;
  const members = text.slice(open + 1, close).split(",").map((s) => s.trim()).filter(Boolean);
  return members.every((m) => /^[A-Za-z_$][\w$]*$/.test(m)) ? members : null;
}

/**
 * Build a resolver for user-defined type names from the source index of the
 * contract in the source pane. A name that has two different meanings in the
 * file set resolves to null.
 */
export function userTypeResolver(index: SolIndex): TypeResolver {
  const cache = new Map<string, UserTypeInfo | null>();
  const lookup = (name: string): UserTypeInfo | null => {
    const found: UserTypeInfo[] = [];
    const contract = index.byName.get(name);
    if (contract && contract.kind !== "library") found.push({ kind: "contract" });
    const decls = [...index.free, ...index.contracts.flatMap((c) => c.members)];
    for (const d of decls) {
      if (d.name !== name) continue;
      if (d.kind === "struct") found.push({ kind: "struct" });
      if (d.kind === "enum") {
        const members = enumMembers(index, d);
        if (!members) return null;
        found.push({ kind: "enum", members });
      }
    }
    const first = found[0];
    if (!first) return null;
    const same = found.every(
      (f) =>
        f.kind === first.kind &&
        (f.kind !== "enum" || first.kind !== "enum" || f.members.join(",") === first.members.join(",")),
    );
    return same ? first : null;
  };
  return (typeName) => {
    const name = typeName.split(".").pop()!;
    let info = cache.get(name);
    if (info === undefined) {
      info = lookup(name);
      cache.set(name, info);
    }
    return info;
  };
}
