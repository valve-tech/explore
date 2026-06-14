import {
  useCallback,
  useEffect,
  useRef,
  type CSSProperties,
  type ReactNode,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type { OpcodeStep } from "../types.js";
import { useOpcodeNavigation } from "../hooks/useOpcodeNavigation.js";
import { Header } from "./StepDebugger/Header.js";
import { ControlRow } from "./StepDebugger/ControlRow.js";
import { DetailPanels } from "./StepDebugger/DetailPanels.js";
import type { StepDebuggerClassNames } from "./StepDebugger/types.js";
import { ChevronLeftIcon } from "../icons/ChevronLeftIcon.js";
import { ChevronRightIcon } from "../icons/ChevronRightIcon.js";

export type { StepDebuggerClassNames };

export interface StepDebuggerProps {
  /** The opcode trace, typically from `TraceResult.opcodes`. */
  steps: OpcodeStep[];
  /** Position to start at; clamped to `[0, steps.length-1]`. */
  initialIndex?: number;
  /** Fired whenever the current step changes (including on mount). */
  onStepChange?: (index: number, step: OpcodeStep) => void;
  /**
   * When true (default), the component listens for keyboard shortcuts while
   * focused. Arrow keys = forward/back, Home/End = ends, C/S/L = next
   * call/storage/log. Set false to disable.
   */
  keyboard?: boolean;
  /**
   * Icon for the "Prev" (step-back) control. Defaults to the built-in
   * `ChevronLeftIcon`.
   */
  prevIcon?: ReactNode;
  /**
   * Icon for the "Next" (step-forward) control. Defaults to the built-in
   * `ChevronRightIcon`.
   */
  nextIcon?: ReactNode;
  /** Per-slot class names for theming. */
  classNames?: StepDebuggerClassNames;
  style?: CSSProperties;
  className?: string;
}

/**
 * Visual step-by-step opcode debugger. Owns its own navigation state via
 * `useOpcodeNavigation`. The component is data-agnostic — consumers who want
 * source-map highlighting, contract-name resolution, or stack decoding wrap
 * with their own enrichment hooks and pipe in via `onStepChange`.
 */
export function StepDebugger({
  steps,
  initialIndex,
  onStepChange,
  keyboard = true,
  prevIcon = <ChevronLeftIcon size={12} />,
  nextIcon = <ChevronRightIcon size={12} />,
  classNames = {},
  style,
  className,
}: StepDebuggerProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const nav = useOpcodeNavigation(steps, { initialIndex });

  const handleStepChange = useCallback(
    (index: number, step: OpcodeStep) => onStepChange?.(index, step),
    [onStepChange],
  );

  useEffect(() => {
    if (nav.step) handleStepChange(nav.currentIndex, nav.step);
  }, [nav.currentIndex, nav.step, handleStepChange]);

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (!keyboard) return;
      switch (e.key) {
        case "ArrowRight":
          e.preventDefault();
          nav.goForward();
          break;
        case "ArrowLeft":
          e.preventDefault();
          nav.goBack();
          break;
        case "Home":
          e.preventDefault();
          nav.jumpTo(0);
          break;
        case "End":
          e.preventDefault();
          nav.jumpTo(nav.totalSteps - 1);
          break;
        case "c":
        case "C":
          e.preventDefault();
          nav.nextCall();
          break;
        case "s":
        case "S":
          e.preventDefault();
          nav.nextStorage();
          break;
        case "l":
        case "L":
          e.preventDefault();
          nav.nextLog();
          break;
      }
    },
    [keyboard, nav],
  );

  const empty = nav.totalSteps === 0;

  return (
    <div
      ref={containerRef}
      className={[className, classNames.root].filter(Boolean).join(" ")}
      tabIndex={keyboard ? 0 : -1}
      onKeyDown={onKeyDown}
      style={{
        borderRadius: 8,
        border: "1px solid rgba(139, 148, 158, 0.2)",
        backgroundColor: "rgba(139, 148, 158, 0.03)",
        outline: "none",
        ...style,
      }}
    >
      <Header nav={nav} empty={empty} className={classNames.header} />
      <ControlRow
        nav={nav}
        empty={empty}
        className={classNames.controls}
        buttonClassName={classNames.button}
        prevIcon={prevIcon}
        nextIcon={nextIcon}
      />
      {!empty && nav.step && (
        <DetailPanels step={nav.step} classNames={classNames} />
      )}
      {empty && (
        <div
          style={{
            padding: 16,
            fontSize: 12,
            color: "#6e7681",
            textAlign: "center",
          }}
        >
          No opcode steps to debug.
        </div>
      )}
    </div>
  );
}
