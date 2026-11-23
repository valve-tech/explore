import { useCallback, useMemo } from "react";
import type { ContractSource } from "../../../api/source";
import type { StepDetail } from "../../../api/debugger";
import type { SourceTokenPos } from "../SoliditySourceViewer";
import type { FrameRange } from "./lineToStepIndex";
import { buildSolIndex } from "./sourceNav/solIndex";
import { clickContextAt } from "./sourceNav/clickContext";
import { computeStackHeights } from "./hoverValues/stackHeights";
import { stackValueAt, type StackValueInput } from "./hoverValues/stackValueAt";
import { userTypeResolver } from "./hoverValues/userTypes";
import { buildStorageModel, frameStorageAt } from "./hoverValues/storageContext";
import { stateVarValueAt } from "./hoverValues/stateVarValue";
import { useStorageLayout } from "./hoverValues/useStorageLayout";
import type { HoverValue } from "./hoverValues/types";

interface Params {
  steps: StackValueInput["steps"] & Parameters<typeof buildStorageModel>[0];
  frameRanges: readonly FrameRange[];
  activeFrame: FrameRange | null;
  currentStep: number;
  traceSourceMaps: StackValueInput["traceSourceMaps"];
  detailMap: Readonly<Record<number, StepDetail>> | null;
  /** The contract whose source the pane shows, and its verified source. */
  displayAddr: string | null;
  source: ContractSource | null;
  /** True when the pane shows a contract other than the active frame's. */
  viewingOther: boolean;
  chainId: number;
}

/**
 * The value an identifier holds at the current step, for the source hover
 * card. A parameter or return variable (stack) wins over a state variable
 * (storage), because it shadows it. Each reader returns null when it is not
 * sure, so the card never shows a wrong value.
 */
export function useHoverValues(p: Params) {
  const { steps, frameRanges, activeFrame, currentStep, traceSourceMaps, detailMap, displayAddr, source, viewingOther, chainId } = p;
  const heights = useMemo(() => computeStackHeights(steps), [steps]);
  const storageModel = useMemo(() => buildStorageModel(steps, frameRanges), [steps, frameRanges]);
  const files = source?.files;
  const index = useMemo(() => buildSolIndex(files ?? []), [files]);
  const resolveType = useMemo(() => userTypeResolver(index), [index]);
  // The layout belongs to the code the frame runs; for a DELEGATECALL frame
  // that is already the implementation address.
  const { layout, contractName } = useStorageLayout(viewingOther ? null : activeFrame?.addr, chainId);

  return useCallback(
    (pos: SourceTokenPos): HoverValue | null => {
      if (!source) return null;
      const parsed = index.files.get(pos.file);
      const word = parsed ? clickContextAt(parsed, pos.line, pos.col)?.word : undefined;
      if (!word) return null;
      const detail = detailMap?.[currentStep] ?? null;
      const fromStack = stackValueAt({
        word, file: pos.file, line: pos.line, col: pos.col,
        steps, heights, frames: frameRanges, currentStep, traceSourceMaps,
        detail,
        sourceAddr: viewingOther ? displayAddr : null,
        compilerVersion: source.compilerVersion,
        optimizer: source.optimizationUsed,
        resolveType,
      });
      if (fromStack) return fromStack;
      if (viewingOther || !layout) return null;
      const fs = frameStorageAt(storageModel, detailMap, currentStep);
      if (fs.status !== "known") return null;
      return stateVarValueAt({
        index, file: pos.file, line: pos.line, col: pos.col,
        layout, contractName,
        storage: fs.storage, prevStorage: fs.prevStorage, writtenSlot: fs.writtenSlot,
      });
    },
    [source, index, detailMap, currentStep, steps, heights, frameRanges, traceSourceMaps, viewingOther, displayAddr, resolveType, layout, contractName, storageModel],
  );
}
