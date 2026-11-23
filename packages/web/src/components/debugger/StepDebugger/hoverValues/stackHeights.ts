/**
 * Stack height before each step, from the opcode skeleton alone.
 *
 * The skeleton has no stack. The debugger loads the stack only for the chunk
 * around the cursor. A function scope starts far from the cursor, so the hover
 * code needs the height at a step it has no detail for.
 */

/** Items an opcode removes from the stack, and items it adds. */
export interface StackEffect {
  pops: number;
  pushes: number;
}

const E = (pops: number, pushes: number): StackEffect => ({ pops, pushes });

const FIXED: Record<string, StackEffect> = {};
const define = (effect: StackEffect, names: string) => {
  for (const name of names.split(" ")) FIXED[name] = effect;
};
define(E(0, 0), "STOP JUMPDEST INVALID");
define(E(2, 1), "ADD MUL SUB DIV SDIV MOD SMOD EXP SIGNEXTEND LT GT SLT SGT EQ AND OR XOR BYTE SHL SHR SAR KECCAK256 SHA3");
define(E(3, 1), "ADDMOD MULMOD CREATE");
define(E(1, 1), "ISZERO NOT CLZ BALANCE CALLDATALOAD EXTCODESIZE EXTCODEHASH BLOCKHASH BLOBHASH MLOAD SLOAD TLOAD");
define(
  E(0, 1),
  "ADDRESS ORIGIN CALLER CALLVALUE CALLDATASIZE CODESIZE GASPRICE RETURNDATASIZE COINBASE TIMESTAMP NUMBER " +
    "DIFFICULTY PREVRANDAO RANDOM GASLIMIT CHAINID SELFBALANCE BASEFEE BLOBBASEFEE PC MSIZE GAS",
);
define(E(3, 0), "CALLDATACOPY CODECOPY RETURNDATACOPY MCOPY");
define(E(4, 0), "EXTCODECOPY");
define(E(1, 0), "POP JUMP SELFDESTRUCT SUICIDE");
define(E(2, 0), "MSTORE MSTORE8 SSTORE TSTORE JUMPI RETURN REVERT");
define(E(7, 1), "CALL CALLCODE");
define(E(6, 1), "DELEGATECALL STATICCALL");
define(E(4, 1), "CREATE2");

const FAMILY = /^(PUSH|DUP|SWAP|LOG)(\d+)$/;

/**
 * The stack effect of an opcode name, as a struct logger prints it.
 * DUPn reads n items and leaves n + 1. SWAPn reads and leaves n + 1.
 * Returns null for a name this table does not know.
 */
export function stackEffect(op: string): StackEffect | null {
  const fixed = FIXED[op];
  if (fixed) return fixed;
  const m = FAMILY.exec(op);
  if (!m) return null;
  const n = Number(m[2]);
  switch (m[1]) {
    case "PUSH":
      return n <= 32 ? E(0, 1) : null;
    case "DUP":
      return n >= 1 && n <= 16 ? E(n, n + 1) : null;
    case "SWAP":
      return n >= 1 && n <= 16 ? E(n + 1, n + 1) : null;
    default:
      return n <= 4 ? E(n + 2, 0) : null;
  }
}

/**
 * True when the opcode removes or overwrites the stack item at `index`.
 * Returns null for an unknown opcode.
 */
export function writesSlot(op: string, height: number, index: number): boolean | null {
  const effect = stackEffect(op);
  if (!effect) return null;
  if (op.startsWith("DUP")) return false;
  if (op.startsWith("SWAP")) return index === height - 1 || index === height - effect.pops;
  return index >= height - effect.pops;
}

export interface HeightStep {
  op: string;
  depth: number;
}

/**
 * The stack height before each step. Index 0 of a stack is the bottom, so the
 * top item of step i is at index heights[i] - 1.
 *
 * A step at a deeper depth than the step before it starts a new frame at
 * height 0. When the depth comes back, the caller continues at the height it
 * has after its call opcode. An unknown opcode makes the remaining steps of
 * that frame -1 (unknown). Other frames are not affected.
 */
export function computeStackHeights(steps: readonly HeightStep[]): Int32Array {
  const heights = new Int32Array(steps.length);
  // Height each suspended caller has after its pending call opcode.
  const resume: number[] = [];
  const after = (i: number): number => {
    const before = heights[i]!;
    const effect = stackEffect(steps[i]!.op);
    if (before < 0 || !effect) return -1;
    const next = before - effect.pops + effect.pushes;
    return before < effect.pops ? -1 : next;
  };
  for (let i = 0; i < steps.length; i++) {
    if (i === 0) {
      heights[i] = 0;
      continue;
    }
    const depth = steps[i]!.depth;
    const prevDepth = steps[i - 1]!.depth;
    if (depth > prevDepth) {
      resume[prevDepth] = after(i - 1);
      heights[i] = 0;
    } else if (depth < prevDepth) {
      heights[i] = resume[depth] ?? -1;
    } else {
      heights[i] = after(i - 1);
    }
  }
  return heights;
}
