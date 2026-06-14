import { useState } from "react";
import type { ReactNode } from "react";
import type { TraceFrame } from "../../types.js";
import { NodeRow } from "./NodeRow.js";
import { DetailPanel } from "./DetailPanel.js";
import type { CallTreeClassNames } from "./types.js";

interface CallNodeProps {
  frame: TraceFrame;
  depth: number;
  defaultExpanded: boolean;
  defaultExpandedDepth: number;
  onSelect?: (frame: TraceFrame) => void;
  valueSymbol: string;
  classNames: CallTreeClassNames;
  expandIcon: ReactNode;
  arrowIcon: ReactNode;
}

export function CallNode({
  frame,
  depth,
  defaultExpanded,
  defaultExpandedDepth,
  onSelect,
  valueSymbol,
  classNames,
  expandIcon,
  arrowIcon,
}: CallNodeProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [showDetails, setShowDetails] = useState(false);

  const hasChildren = frame.children.length > 0;

  return (
    <div
      style={{
        marginLeft: depth > 0 ? 20 : 0,
        borderLeft:
          depth > 0 ? "2px solid rgba(139, 148, 158, 0.2)" : "none",
        paddingLeft: depth > 0 ? 12 : 0,
      }}
    >
      <NodeRow
        frame={frame}
        hasChildren={hasChildren}
        expanded={expanded}
        onToggleExpand={() => setExpanded(!expanded)}
        showDetails={showDetails}
        onToggleDetails={() => setShowDetails(!showDetails)}
        onSelect={onSelect}
        valueSymbol={valueSymbol}
        classNames={classNames}
        expandIcon={expandIcon}
        arrowIcon={arrowIcon}
      />

      {showDetails && (
        <DetailPanel frame={frame} className={classNames.detailPanel} />
      )}

      {expanded && hasChildren && (
        <div>
          {frame.children.map((child, i) => (
            <CallNode
              key={`${child.to ?? "create"}-${i}`}
              frame={child}
              depth={depth + 1}
              defaultExpanded={depth + 1 < defaultExpandedDepth}
              defaultExpandedDepth={defaultExpandedDepth}
              onSelect={onSelect}
              valueSymbol={valueSymbol}
              classNames={classNames}
              expandIcon={expandIcon}
              arrowIcon={arrowIcon}
            />
          ))}
        </div>
      )}
    </div>
  );
}
