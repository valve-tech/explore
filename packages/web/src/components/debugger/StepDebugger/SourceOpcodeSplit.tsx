import { useCallback, useState } from "react";
import { Icon } from "@iconify/react";
import type { ContractSource, SlitherFinding } from "../../../api/source";
import type { OpcodeStep } from "../../../api/debugger";
import type { HighlightSpan } from "../SoliditySourceViewer";
import type { OpcodeFrequency } from "./opcodeStats";
import { SourceTabContent } from "./SourceTabContent";
import { OpcodeFrequencyTags } from "./OpcodeFrequencyTags";
import { OpcodeTracePane } from "./OpcodeTracePane";

const COLLAPSED_KEY = "debugger:opcodePaneCollapsed";

type ContractSourceFile = ContractSource["files"][number];

/**
 * The synchronized debugger view: verified source on the left, the opcode
 * trace on the right, both tracking the current step. Stepping highlights the
 * exact source sub-expression AND the matching opcode row; clicking an opcode
 * row jumps both panes; clicking an executable source line jumps to the first
 * opcode mapped there. This is the bidirectional link between bytecode and the
 * Solidity that produced it.
 */
export function SourceOpcodeSplit({
  // source pane
  currentSourceFile,
  allFiles,
  effectiveLine,
  highlightSpan,
  scrollKey,
  slitherFindings,
  sourceLoading,
  activeContractAddress,
  executableLines,
  onJumpToLine,
  onIdentifierClick,
  // opcode pane
  steps,
  currentStep,
  goTo,
  filteredIndices,
  maxDepth,
  opcodeFreqs,
  opcodeFilter,
  onToggleOpcode,
}: {
  currentSourceFile: ContractSourceFile | null;
  /** Every file in the active contract's source tree — drives the tab strip. */
  allFiles: ContractSourceFile[];
  effectiveLine: number | null;
  highlightSpan: HighlightSpan | null;
  scrollKey: number;
  slitherFindings: SlitherFinding[];
  sourceLoading: boolean;
  activeContractAddress: string | null;
  executableLines: Set<number>;
  onJumpToLine: (line: number) => void;
  /** Fired when the user clicks any identifier token in the source pane.
   *  Used by the parent for go-to-definition navigation. */
  onIdentifierClick?: (identifier: string, line: number) => void;
  steps: OpcodeStep[];
  currentStep: number;
  goTo: (step: number) => void;
  filteredIndices: Set<number> | null;
  maxDepth: number;
  opcodeFreqs: OpcodeFrequency[];
  opcodeFilter: string;
  onToggleOpcode: (op: string) => void;
}) {
  // Persist the collapsed state so reloads remember the user's preferred
  // layout. Useful when reading mostly source code — the opcode rail can
  // hide and give the source pane the full width, with a thin column
  // remaining to toggle it back.
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    return localStorage.getItem(COLLAPSED_KEY) === "1";
  });
  const toggleCollapsed = useCallback(() => {
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
      return next;
    });
  }, []);

  return (
    <div className="flex flex-col lg:flex-row gap-0 h-[calc(100vh-260px)] min-h-[480px]">
      {/* Source — takes all remaining width when the opcode pane is hidden. */}
      <div
        className={
          collapsed
            ? "flex-1 min-w-0 min-h-[240px]"
            : "lg:flex-[3] min-w-0 min-h-[240px] flex-1"
        }
      >
        <SourceTabContent
          currentSourceFile={currentSourceFile}
          allFiles={allFiles}
          effectiveLine={effectiveLine}
          highlightSpan={highlightSpan}
          scrollKey={scrollKey}
          slitherFindings={slitherFindings}
          sourceLoading={sourceLoading}
          activeContractAddress={activeContractAddress}
          maxHeight="100%"
          onLineClick={onJumpToLine}
          onIdentifierClick={onIdentifierClick}
          executableLines={executableLines}
        />
      </div>

      {collapsed ? (
        // Collapsed rail: a thin column with a single button to restore the
        // opcode pane. Persisted so the rail keeps showing on reload.
        <button
          onClick={toggleCollapsed}
          title="Show opcode pane"
          className="hidden lg:flex items-start justify-center pt-3 flex-shrink-0 cursor-pointer transition-opacity hover:opacity-80 theme-card-bg theme-text-muted theme-mono bs"
          style={{
            width: "20px",
          }}
        >
          <Icon icon="heroicons:chevron-left" className="w-3 h-3" aria-hidden />
        </button>
      ) : (
        // Opcode trace — synced companion. The `.card` class already provides
        // the bg-card surface + outset border + 1px margin; no need to repeat
        // them inline.
        <div className="lg:flex-[2] lg:min-w-[340px] min-h-[240px] flex flex-col card overflow-hidden">
          <div className="flex items-center bs-b">
            <div className="flex-1 min-w-0">
              <OpcodeFrequencyTags
                frequencies={opcodeFreqs}
                activeOp={opcodeFilter}
                onToggle={onToggleOpcode}
              />
            </div>
            <button
              onClick={toggleCollapsed}
              title="Hide opcode pane"
              className="hidden lg:flex items-center justify-center self-stretch flex-shrink-0 cursor-pointer transition-opacity hover:opacity-80 theme-text-muted theme-mono"
              style={{
                width: "20px",
                boxShadow: "inset 1px 0 0 0 var(--color-border-default)",
              }}
            >
              <Icon icon="heroicons:chevron-right" className="w-3 h-3" aria-hidden />
            </button>
          </div>
          <div className="flex-1 min-h-0">
            <OpcodeTracePane
              steps={steps}
              currentStep={currentStep}
              goTo={goTo}
              filteredIndices={filteredIndices}
              maxDepth={maxDepth}
            />
          </div>
        </div>
      )}
    </div>
  );
}
