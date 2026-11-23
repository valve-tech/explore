import { formatValueWord, wordOf, type TypeResolver } from "./formatStackValue";
import type { ScopePcMap, ScopeStep, StackScope } from "./stackScopes";

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * True when the code pushes each return slot below `upToSlot` right after the
 * entry JUMPDEST, in order. The legacy code generator maps each of these
 * pushes to the declaration of its return variable.
 */
export function returnSlotsPushed(
  steps: readonly ScopeStep[],
  pcMap: ScopePcMap,
  depth: number,
  scope: StackScope,
  upToSlot: number,
): boolean {
  for (const r of scope.fn.returns) {
    for (let k = r.offset; k < r.offset + r.slots && k < upToSlot; k++) {
      const step = steps[scope.entryStep + 1 + k];
      if (!step || step.depth !== depth || !/^(PUSH|DUP)/.test(step.op)) return false;
      const loc = pcMap[step.pc];
      if (!loc || squash(loc.sourceSnippet) !== r.text) return false;
    }
  }
  return true;
}

/**
 * True when the value-type arguments on the stack agree with the call data
 * of the frame. Use it only for a function that the dispatcher entered.
 */
export function matchesCalldata(
  scope: StackScope,
  stack: readonly string[],
  calldata: string,
  resolveType?: TypeResolver,
): boolean {
  const data = calldata.startsWith("0x") ? calldata.slice(2) : calldata;
  let compared = 0;
  for (const [i, p] of scope.fn.params.entries()) {
    const dynamic = p.type === "bytes" || p.type === "string" || p.type.endsWith("[]");
    // A static array or a struct uses more than one head word. Stop there.
    if (p.location !== null && !dynamic) break;
    // A dynamic value has one head word, an offset. There is nothing to compare.
    if (p.location !== null) continue;
    const head = data.slice(8 + i * 64, 8 + (i + 1) * 64);
    const onStack = stack[scope.base + p.offset];
    if (head.length !== 64 || onStack === undefined) return false;
    const a = formatValueWord(p.type, BigInt("0x" + head), resolveType);
    if (a === null) continue;
    const word = wordOf(onStack);
    if (word === null || a !== formatValueWord(p.type, word, resolveType)) return false;
    compared++;
  }
  return compared > 0;
}
