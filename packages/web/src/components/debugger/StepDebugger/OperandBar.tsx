import { getOpcodeColor } from "@valve-tech/trace-sdk";
import { Tooltip } from "../../primitives/Tooltip";
import type { OperandInfo } from "./opcodeOperands";
import { truncateWord } from "./format";

/**
 * One-line readout of what the current opcode operates on: its operand
 * signature, the resolved input values pulled off the stack, and the memory
 * region / storage slot it touches. This is the "what's participating in this
 * opcode" summary that ties the Stack/Memory/Storage panels together.
 */
export function OperandBar({ op, operands }: { op: string; operands: OperandInfo | null }) {
  return (
    <div className="card-divider px-3 py-1.5 text-xs flex items-center gap-row flex-wrap theme-secondary-bg theme-mono">
      <span className="font-semibold" style={{ color: getOpcodeColor(op) }}>{op}</span>

      {!operands && (
        <span className="theme-text-muted">no modeled operands</span>
      )}

      {operands?.args.map((a) => (
        <span key={a.name} className="flex items-center gap-tight">
          <span className="theme-text-muted">{a.name}</span>
          <span className="theme-text-muted">=</span>
          <Tooltip label={a.value}><span className="theme-text">{truncateWord(a.value)}</span></Tooltip>
        </span>
      ))}

      {operands && operands.args.length === 0 && operands.outputs > 0 && (
        <span className="theme-text-muted">→ pushes {operands.outputs}</span>
      )}

      {operands?.memory && operands.memory.size > 0 && (
        <Tooltip label={`mem ${operands.memory.kind}`}>
          <span
            className={`px-1.5 py-0.5 ${operands.memory.kind === "write" ? "theme-warning" : "theme-text-secondary"}`}
            style={{
              boxShadow: `inset 0 0 0 1px ${operands.memory.kind === "write" ? "var(--color-warning)" : "var(--color-border-default)"}`,
            }}
          >
            mem {operands.memory.kind} [0x{operands.memory.offset.toString(16)} … +{operands.memory.size}]
          </span>
        </Tooltip>
      )}

      {operands?.storageSlot && (
        <Tooltip label="storage slot">
          <span
            className="px-1.5 py-0.5 theme-warning"
            style={{ boxShadow: "inset 0 0 0 1px var(--color-warning)" }}
          >
            slot {truncateWord(operands.storageSlot)}
          </span>
        </Tooltip>
      )}
    </div>
  );
}
