import type { SourceFile } from "../../../api/source";

/**
 * Pure text-search for a function declaration across a verified contract's
 * source files. Returns the file/line of the first declaration found, or null.
 * Used by the step debugger when a click on a call-tree row needs to jump to a
 * function body whose source-map JUMPDEST the optimizer dropped
 * (receive/fallback and other unmapped entries).
 *
 * Match precedence inside a file:
 *   1. `function NAME(` inside a contract{} or library{}
 *   2. `function NAME(` inside an interface{}
 *   3. a `public NAME` declaration (auto-generated getter, e.g. `mapping
 *      public balanceOf`) inside a contract{}
 *
 * The implementation is intentionally regex+brace-depth rather than AST: a
 * single ordered scan is orders of magnitude cheaper than running a Solidity
 * parser in the browser per click. Every file is scanned, which is also how
 * INHERITED members resolve — a base contract's declaration is found in the
 * base's own file, with no inheritance graph to model.
 *
 * `receive` and `fallback` are special: they have no `function` keyword and
 * only exist from Solidity **0.6.0**. Before that, a single UNNAMED fallback
 * served both roles (`function() external payable`), so both labels fall back
 * to that form — see patternsFor.
 */
export function findFunctionLine(
  files: readonly SourceFile[],
  funcName: string,
): { file: string; line: number } | null {
  // Patterns are tried in order across ALL files before moving to the next, so
  // precedence is by SYNTAX rather than file order: a modern `receive()` in the
  // last file still beats a legacy unnamed fallback in the first.
  for (const funcPattern of patternsFor(funcName)) {
    const hit = scanFiles(files, funcPattern, funcName);
    if (hit) return hit;
  }
  return null;
}

/**
 * The unnamed fallback of Solidity < 0.6 — `function() external payable {`.
 *
 * `payable` is required, which does two jobs. It keeps us off the type-position
 * lookalike (`function run(function() external cb)`, where `function()` is a
 * parameter type, not a declaration), and it matches intent: this lookup is
 * only reached for a value transfer, which a non-payable fallback cannot
 * receive. `[^;]*` stays on the declaration and won't run past a statement end.
 */
const LEGACY_UNNAMED_FALLBACK = /\bfunction\s*\(\s*\)[^;]*\bpayable\b/;

/** Ordered declaration patterns to try for `funcName`. */
function patternsFor(funcName: string): RegExp[] {
  if (funcName === "receive" || funcName === "fallback") {
    return [
      new RegExp(`\\b${funcName}\\s*\\(\\s*\\)`), // Solidity >= 0.6
      LEGACY_UNNAMED_FALLBACK, // Solidity < 0.6
    ];
  }
  return [new RegExp(`function\\s+${escapeRegex(funcName)}\\s*\\(`)];
}

function scanFiles(
  files: readonly SourceFile[],
  funcPattern: RegExp,
  funcName: string,
): { file: string; line: number } | null {
  // The public-getter shorthand is only meaningful for a named member. Running
  // it for receive/fallback would let an unrelated `public` line win before the
  // legacy pattern ever gets its turn.
  const isSpecial = funcName === "receive" || funcName === "fallback";
  const varPattern = new RegExp(`\\b${escapeRegex(funcName)}\\b`);

  for (const file of files) {
    const lines = file.content.split("\n");

    let inInterface = false;
    let inContract = false;
    let braceDepth = 0;
    let interfaceMatch: number | null = null;
    let contractMatch: number | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;

      if (/\binterface\s+\w+/.test(line)) inInterface = true;
      if (/\bcontract\s+\w+/.test(line) || /\blibrary\s+\w+/.test(line)) {
        inContract = true;
        inInterface = false;
      }

      for (const ch of line) {
        if (ch === "{") braceDepth++;
        if (ch === "}") {
          braceDepth--;
          if (braceDepth === 0) {
            inInterface = false;
            inContract = false;
          }
        }
      }

      if (funcPattern.test(line)) {
        if (inContract && !inInterface) {
          contractMatch = i + 1;
        } else if (inInterface && interfaceMatch === null) {
          interfaceMatch = i + 1;
        } else if (contractMatch === null && interfaceMatch === null) {
          contractMatch = i + 1;
        }
      }

      // Public-state-variable shorthand for auto-generated getters.
      if (
        !isSpecial &&
        contractMatch === null &&
        varPattern.test(line) &&
        /\bpublic\b/.test(line) &&
        !/^\s*\/\//.test(line) &&
        inContract
      ) {
        contractMatch = i + 1;
      }
    }

    const bestMatch = contractMatch ?? interfaceMatch;
    if (bestMatch !== null) return { file: file.name, line: bestMatch };
  }

  return null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
