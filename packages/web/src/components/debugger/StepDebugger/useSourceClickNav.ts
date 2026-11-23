import { useCallback, useMemo, useState } from "react";
import type { SourceFile } from "../../../api/source";
import type { SourceTokenClick, SourceTokenPos } from "../SoliditySourceViewer";
import type { FrameRange } from "./lineToStepIndex";
import { buildSolIndex } from "./sourceNav/solIndex";
import { resolveSourceClick } from "./sourceNav/resolveClick";
import type { ClickModifier, NavAction, NavTarget } from "./sourceNav/navTypes";
import { describeAction } from "./sourceNav/describeAction";
import { calleeSources, planGoto, type GotoContext, type GotoPlan } from "./sourceNav/planGoto";
import { executedCallTarget } from "./sourceNav/executedCall";

/** A list of definitions (alt-click) and/or a note shown above the source. */
export interface SourceNavNotice {
  label: string;
  note?: string;
  targets?: NavTarget[];
}

interface Params {
  /** Files of the contract the pane shows, and its verified name. */
  files: readonly SourceFile[];
  contractName: string | null;
  displayAddr: string | null;
  /** True when the pane shows a contract other than the active frame's. */
  viewingOther: boolean;
  currentFile: string | null;
  activeFrame: FrameRange | null;
  frameRanges: readonly FrameRange[];
  currentStep: number;
  steps: GotoContext["steps"];
  /** traceSourceMaps[frameAddr] — the active frame's own source map. */
  pcMap: GotoContext["pcMap"];
  sourcesByAddr: Record<string, SourceFile[] | undefined>;
  implByProxy: ReadonlyMap<string, string>;
  /** Frame-scoped line → first step, for the file the cursor is in. */
  lineToFirstStep: ReadonlyMap<number, number>;
  show: (view: GotoPlan & { label: string }) => void;
  showFile: (ref: { addr: string; file: string }) => void;
  goToStep: (step: number) => void;
  setNavError: (message: string | null) => void;
}

/**
 * Source-pane click navigation. The pure resolver decides the action; this
 * hook only gathers the trace context for it and applies the result.
 */
export function useSourceClickNav(p: Params) {
  const [notice, setNotice] = useState<SourceNavNotice | null>(null);
  const index = useMemo(() => buildSolIndex(p.files), [p.files]);
  const { displayAddr, steps, pcMap } = p;
  const { files, contractName, viewingOther, currentFile, activeFrame, frameRanges, currentStep, implByProxy, sourcesByAddr, lineToFirstStep } = p;

  const resolve = useCallback(
    (pos: SourceTokenPos, modifier: ClickModifier): NavAction => {
      // The line index and the callee belong to the active frame. They mean
      // nothing while the pane shows another contract's source.
      const onCursorFile = !viewingOther && pos.file === currentFile;
      const lineStep = onCursorFile ? lineToFirstStep.get(pos.line) : undefined;
      const callee = viewingOther
        ? []
        : calleeSources(frameRanges, activeFrame, lineStep ?? currentStep, implByProxy, sourcesByAddr);
      const action = resolveSourceClick({ files, index, contractName, callee, modifier, ...pos });
      // Trace first: when the clicked line ran in this frame, the function it
      // actually entered is the answer. The static ranking is the fallback.
      if (action.type !== "goto" || action.target.kind !== "function" || action.target.addr) return action;
      const ran = executedCallTarget(index, steps, activeFrame, pcMap, lineStep, action.label);
      if (!ran) return action;
      const same = ran.file === action.target.file && ran.line === action.target.line;
      const target: NavTarget = { ...action.target, ...ran, hasBody: true, owner: same ? action.target.owner : null };
      return { type: "goto", label: action.label, target };
    },
    [files, index, contractName, viewingOther, currentFile, activeFrame, frameRanges, currentStep, implByProxy, sourcesByAddr, lineToFirstStep, steps, pcMap],
  );

  const describeToken = useCallback(
    (pos: SourceTokenPos, modifier: ClickModifier) => describeAction(resolve(pos, modifier)),
    [resolve],
  );

  const { show, showFile, goToStep, setNavError } = p;
  const goToTarget = useCallback(
    (target: NavTarget, label: string) => {
      const frame = activeFrame ? { entry: activeFrame.entry, end: activeFrame.end } : null;
      show({ ...planGoto(target, { displayAddr, viewingOther, currentFile, frame, steps, pcMap }), label });
    },
    [activeFrame, displayAddr, viewingOther, currentFile, steps, pcMap, show],
  );

  const onTokenClick = useCallback(
    (click: SourceTokenClick) => {
      const action = resolve(click, click.modifier);
      switch (action.type) {
        case "none":
          return;
        case "open-file":
          setNotice(null);
          if (displayAddr) showFile({ addr: displayAddr, file: action.file });
          return;
        case "list":
          setNotice({ label: action.label, targets: action.targets });
          return;
        case "step": {
          const onCursorFile = !viewingOther && click.file === currentFile;
          const step = onCursorFile ? lineToFirstStep.get(action.line) : undefined;
          if (step === undefined) {
            setNavError(`Line ${action.line} (\`${action.label}\`) does not run in the current frame.`);
            return;
          }
          setNotice(null);
          goToStep(step);
          return;
        }
        case "goto":
          goToTarget(action.target, action.label);
          setNotice(action.note ? { label: action.label, note: action.note } : null);
          return;
      }
    },
    [resolve, displayAddr, showFile, viewingOther, currentFile, lineToFirstStep, setNavError, goToStep, goToTarget],
  );

  const pickTarget = useCallback(
    (target: NavTarget) => {
      if (notice) goToTarget(target, notice.label);
      setNotice(null);
    },
    [notice, goToTarget],
  );
  const dismissNotice = useCallback(() => setNotice(null), []);

  return { onTokenClick, describeToken, notice, pickTarget, dismissNotice };
}
