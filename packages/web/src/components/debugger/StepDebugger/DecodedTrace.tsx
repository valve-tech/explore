import { useEffect, useMemo, useRef } from "react";
import { isCallOp } from "@valve-tech/trace-sdk/hooks";
import { Tooltip } from "../../primitives/Tooltip";
import type { OpcodeStep, CallFrame } from "../../../api/debugger";
import type { SourceLocation } from "../../../api/source";
import type { SignatureMatch } from "../../../api/signatures";
import { lookupWellKnown } from "../../../lib/wellKnownSignatures";
import { PanelHeader } from "./PanelHeader";
import { CALL_TYPE_BG, CALL_TYPE_BORDER } from "./theme";
import { bestMatchSignature, extractSelector, flattenCallTree } from "./callTreeHelpers";

interface DecodedEntry {
  step: number;
  depth: number;
  callType: string;
  selector?: string;
  targetAddress?: string;
  decodedName?: string;
  sourceLocation?: SourceLocation;
  isInternal: boolean;
}

/**
 * Human-readable function call list:
 *   WPLS(0xA107...).deposit{value: 1.0}()
 *
 * Folds external calls (CALL/STATIC/DELEGATE/CREATE) and source-map-confirmed
 * internal JUMPs into one chronological list, with the active row highlighted.
 */
export function DecodedTrace({
  steps,
  currentStep,
  signatureMap,
  sourceMappings,
  callTrace,
  contractNames,
  onJumpTo,
}: {
  steps: OpcodeStep[];
  currentStep: number;
  signatureMap: Record<string, SignatureMatch[]>;
  sourceMappings: Record<number, SourceLocation | null>;
  callTrace?: CallFrame | null;
  contractNames: Record<string, string | null>;
  onJumpTo: (step: number, hint?: { funcName: string; contractAddr?: string }) => void;
}) {
  const flatCalls = useMemo(
    () => callTrace ? flattenCallTree(callTrace) : [],
    [callTrace],
  );

  // The currently-active row sets this ref; everything else passes null.
  // React clears the old node before setting the new one in the same render
  // pass, so the ref always points to the row that *is* active right now.
  const activeRowRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    // `nearest` means: only scroll if the row is out of view. The user's
    // manual scroll position is respected when the cursor is already on
    // screen, which matters because they'll often scroll back to compare
    // earlier calls against the live cursor.
    activeRowRef.current?.scrollIntoView({ block: "nearest" });
  }, [currentStep]);

  const entries = useMemo(() => {
    const result: DecodedEntry[] = [];

    let extCallIdx = 0;
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i]!;

      if (isCallOp(s.op)) {
        const callInfo = flatCalls[extCallIdx];
        const selector = callInfo?.selector ?? extractSelector(s);
        const targetAddress = callInfo?.to ?? undefined;
        const calldata = callInfo?.input ?? "";
        extCallIdx++;
        // Priority: well-known signatures → 4byte API with disambiguation
        const wellKnown = selector ? lookupWellKnown(selector) : undefined;
        const candidates = selector ? signatureMap[selector.toLowerCase()] ?? [] : [];
        const resolved = wellKnown?.signature ?? bestMatchSignature(candidates, calldata);

        result.push({
          step: i,
          depth: s.depth,
          callType: s.op,
          selector,
          targetAddress,
          decodedName: resolved,
          sourceLocation: sourceMappings[s.pc] ?? undefined,
          isInternal: false,
        });
      } else if (s.op === "JUMP") {
        const mapping = sourceMappings[s.pc];
        if (mapping?.jumpType === "i") {
          result.push({
            step: i,
            depth: s.depth,
            callType: "internal",
            sourceLocation: mapping,
            decodedName: mapping.sourceSnippet.trim().split("(")[0]?.split(" ").pop(),
            isInternal: true,
          });
        }
      }
    }
    return result;
  }, [steps, signatureMap, sourceMappings, flatCalls]);

  return (
    <div className="card overflow-hidden theme-card-bg">
      <PanelHeader title="Decoded Trace" count={entries.length} suffix="calls" />
      <div className="overflow-y-auto" style={{ maxHeight: "400px" }}>
        {entries.length === 0 ? (
          <div className="px-3 py-4 text-xs text-center theme-text-muted">
            No function calls detected in this trace
          </div>
        ) : (
          entries.map((entry, i) => {
            const isActive = currentStep >= entry.step && (
              i + 1 >= entries.length || currentStep < entries[i + 1]!.step
            );

            const bgColor = entry.isInternal
              ? "rgba(148, 163, 184, 0.04)"
              : CALL_TYPE_BG[entry.callType] ?? "transparent";
            const borderColor = isActive
              ? "var(--color-accent)"
              : entry.isInternal
                ? "rgba(148, 163, 184, 0.2)"
                : CALL_TYPE_BORDER[entry.callType] ?? "transparent";

            // Build human-readable: Contract(0xAddr).functionName(args)
            const funcSig = entry.decodedName
              ? entry.decodedName
              : entry.selector
                ? `${entry.selector}()`
                : "???()";
            const funcNameOnly = funcSig.split("(")[0]!;
            const funcArgs = funcSig.includes("(") ? `(${funcSig.split("(").slice(1).join("(")}` : "()";
            const addrShort = entry.targetAddress
              ? `${entry.targetAddress.slice(0, 6)}...${entry.targetAddress.slice(-4)}`
              : "";

            // External rows have a decoded function signature (from the
            // signature DB or 4byte) — pass it as a hint so the parent
            // surfaces the function declaration in the source pane, not just
            // wherever the step's source map happens to land. Internal rows
            // come from source-snippet parsing and may not be real
            // identifiers, so they fall back to the source-map flow.
            const hint = !entry.isInternal && entry.decodedName
              ? { funcName: funcNameOnly, contractAddr: entry.targetAddress }
              : undefined;
            return (
              <Tooltip
                key={i}
                label={entry.decodedName ? `${entry.targetAddress ?? ""}.${funcSig}` : entry.selector}
                className="w-full"
              >
              <div
                ref={isActive ? activeRowRef : null}
                onClick={() => onJumpTo(entry.step, hint)}
                className="w-full flex items-center gap-tight px-3 py-1.5 cursor-pointer text-xs hover:opacity-80 theme-mono"
                style={{
                  paddingLeft: `${12 + (entry.depth - 1) * 16}px`,
                  backgroundColor: isActive ? "rgba(139, 92, 246, 0.12)" : bgColor,
                  borderLeft: `3px solid ${borderColor}`,
                  opacity: entry.isInternal ? 0.6 : 1,
                }}
              >
                {entry.targetAddress && (() => {
                  const contractName = contractNames[entry.targetAddress.toLowerCase()];
                  const interfaceName = entry.selector ? lookupWellKnown(entry.selector)?.interface : undefined;
                  const displayLabel = contractName ?? interfaceName;
                  return (
                    <>
                      {displayLabel ? (
                        <span className={contractName ? "theme-accent" : "theme-text-secondary"}>
                          {displayLabel}
                        </span>
                      ) : null}
                      <Tooltip label={entry.targetAddress}>
                        <span className="theme-text-muted">
                          ({addrShort})
                        </span>
                      </Tooltip>
                      <span className="theme-text-muted">.</span>
                    </>
                  );
                })()}
                <span className="theme-text" style={{ fontWeight: isActive ? 600 : 400 }}>
                  {funcNameOnly}
                </span>
                <span className="theme-text-muted">
                  {funcArgs}
                </span>
                {entry.sourceLocation && (
                  <span className="ml-2 theme-text-muted">
                    {entry.sourceLocation.file}:{entry.sourceLocation.line}
                  </span>
                )}
                <span className="ml-auto flex-shrink-0 theme-text-muted">
                  {entry.step}
                </span>
              </div>
              </Tooltip>
            );
          })
        )}
      </div>
    </div>
  );
}
