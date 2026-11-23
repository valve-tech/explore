import type { SolIndex } from "./solIndex";

/**
 * Solidity C3 linearization, most derived first. In `contract X is A, B`
 * the RIGHTMOST base is the most derived, so the merge reads bases right to
 * left. Bases that are not in the file set are skipped. A cycle or an
 * inconsistent hierarchy degrades to a deduplicated depth-first order.
 */
export function linearize(index: SolIndex, name: string): string[] {
  const memo = new Map<string, string[]>();
  const visiting = new Set<string>();
  const lin = (n: string): string[] => {
    const cached = memo.get(n);
    if (cached) return cached;
    if (visiting.has(n)) return [n];
    visiting.add(n);
    const bases = (index.byName.get(n)?.bases ?? []).filter((b) => index.byName.has(b)).reverse();
    const seqs = [...bases.map((b) => [...lin(b)]), [...bases]].filter((s) => s.length > 0);
    const out = [n];
    while (seqs.some((s) => s.length > 0)) {
      const live = seqs.filter((s) => s.length > 0);
      const head =
        live.map((s) => s[0]!).find((h) => !live.some((s) => s.indexOf(h) > 0)) ?? live[0]![0]!;
      if (!out.includes(head)) out.push(head);
      for (const s of seqs) {
        const at = s.indexOf(head);
        if (at !== -1) s.splice(at, 1);
      }
    }
    visiting.delete(n);
    memo.set(n, out);
    return out;
  };
  return lin(name);
}

/**
 * The contract that is being executed, for override ranking. `hint` is the
 * verified contract name when the caller knows it. Otherwise pick the
 * deployable contract with the longest linearization that contains
 * `enclosing` — the most derived one in the file set.
 */
export function pickLeafContract(
  index: SolIndex,
  enclosing: string | null,
  hint?: string | null,
): string | null {
  if (hint && index.byName.has(hint) && (!enclosing || linearize(index, hint).includes(enclosing))) {
    return hint;
  }
  let best: string | null = null;
  let bestLen = 0;
  for (const c of index.contracts) {
    if (c.kind === "interface" || c.kind === "library") continue;
    const l = linearize(index, c.name);
    if (enclosing && !l.includes(enclosing)) continue;
    if (l.length >= bestLen) { best = c.name; bestLen = l.length; }
  }
  return best ?? enclosing;
}
