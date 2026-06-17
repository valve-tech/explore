import { useRef, useEffect, useMemo, useCallback, type ReactNode } from "react";
import type { SourceFile } from "../../api/source";
import {
  type Token,
  type HighlightSpan,
  TOKEN_COLORS,
  tokenizeLine,
  splitCommentToken,
  splitTokensBySpan,
} from "./SoliditySourceViewer/tokenize";
import { useFindInSource } from "./SoliditySourceViewer/useFindInSource";
import { FindBar } from "./SoliditySourceViewer/FindBar";
import { Tooltip } from "../primitives/Tooltip";

// Re-export `HighlightSpan` and `splitTokensBySpan` so existing importers
// (SourceTabContent, SourceOpcodeSplit, the splitTokensBySpan unit test)
// keep working without touching their import paths.
export { type HighlightSpan, splitTokensBySpan };

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SourceViewerProps {
  file: SourceFile;
  currentLine: number | null;
  /** Exact character span the current opcode maps to. When present, the
   *  precise sub-expression is boxed; the line still gets the soft accent. */
  highlightSpan?: HighlightSpan | null;
  scrollKey?: number; // increment to force re-scroll even if currentLine hasn't changed
  highlightLines?: Set<number>;
  findings?: Array<{ line: number; severity: string; message: string }>;
  onIdentifierClick?: (identifier: string, line: number) => void;
  /** Click the line-number gutter to act on a line (e.g. jump to the first
   *  opcode mapped there). Lines with no executing opcode get a dimmed gutter. */
  onLineClick?: (line: number) => void;
  /** Lines that have at least one opcode mapped to them — used to indicate
   *  which gutter numbers are clickable jump targets. */
  executableLines?: Set<number>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SourceViewer({
  file,
  currentLine,
  highlightSpan,
  scrollKey,
  highlightLines,
  findings,
  onIdentifierClick,
  onLineClick,
  executableLines,
}: SourceViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const lines = useMemo(() => file.content.split("\n"), [file.content]);

  // Pre-tokenize all lines with block comment tracking
  const tokenizedLines = useMemo(() => {
    let inComment = false;
    return lines.map((line) => {
      const result = tokenizeLine(line, inComment);
      inComment = result.inBlockComment;
      // Split comment tokens to highlight NatSpec tags
      return result.tokens.flatMap(splitCommentToken);
    });
  }, [lines]);
  // Identifier clicks used to toggle a self-contained filter+badge. They now
  // fire onIdentifierClick so the parent can navigate to the definition; the
  // selected/highlight UI state lives there, not here.

  // In-pane find (Cmd/Ctrl+F). Hook owns all state, the keyboard
  // interceptor, the activeMatch clamp, and the scroll-to-active effect.
  const {
    open: findOpen,
    query: findQuery,
    setQuery: setFindQuery,
    activeMatch,
    matchLines,
    matchSet,
    activeMatchLine,
    stepMatch,
    closeFind,
    inputRef: findInputRef,
  } = useFindInSource(lines, containerRef);

  // Auto-scroll to current line by directly setting the container's
  // scrollTop. We don't use `Element.scrollIntoView` because it walks
  // every scrollable ancestor — and the debugger page itself can scroll,
  // so the browser would sometimes scroll the OUTER page instead of the
  // source pane's internal scroll container, leaving the line visually
  // off-screen inside the pane while the page jumped around. Scrolling
  // the container directly guarantees we only move the pane.
  //
  // "Manual-scroll preservation" semantics (don't fight the user when
  // they've scrolled ahead to read upcoming code): only scroll when the
  // current line is outside the pane's viewport. When the line is
  // already visible, leave scrollTop alone — same effect as `block:
  // "nearest"` but scoped to the container.
  useEffect(() => {
    if (!containerRef.current || !currentLine) return;
    requestAnimationFrame(() => {
      const container = containerRef.current;
      if (!container) return;
      const lineEl = container.querySelector(
        `[data-line="${currentLine}"]`,
      ) as HTMLElement | null;
      if (!lineEl) return;

      // Sticky header eats the top portion of the viewport — measure it so
      // the target line isn't hidden underneath. Defaults to 0 if no
      // sticky header is rendered.
      const header = container.querySelector("[data-source-header]") as
        | HTMLElement
        | null;
      const headerH = header?.offsetHeight ?? 0;

      const lineTop = lineEl.offsetTop;
      const lineBottom = lineTop + lineEl.offsetHeight;
      const viewTop = container.scrollTop + headerH;
      const viewBottom = container.scrollTop + container.clientHeight;

      if (lineTop < viewTop) {
        // Line is above the visible area — scroll up to put it just
        // under the sticky header.
        container.scrollTop = lineTop - headerH;
      } else if (lineBottom > viewBottom) {
        // Line is below the visible area — scroll down minimally so the
        // bottom of the line aligns with the bottom of the pane.
        container.scrollTop = lineBottom - container.clientHeight;
      }
    });
  }, [currentLine, file.name, scrollKey]);

  // Build findings lookup
  const findingsByLine = useMemo(() => {
    if (!findings) return new Map<number, Array<{ severity: string; message: string }>>();
    const map = new Map<number, Array<{ severity: string; message: string }>>();
    for (const f of findings) {
      const existing = map.get(f.line) ?? [];
      existing.push({ severity: f.severity, message: f.message });
      map.set(f.line, existing);
    }
    return map;
  }, [findings]);

  const handleTokenClick = useCallback(
    (token: Token, lineNum: number) => {
      if (token.type === "identifier") {
        onIdentifierClick?.(token.value, lineNum);
      }
    },
    [onIdentifierClick],
  );

  const severityColors: Record<string, string> = {
    High: "var(--color-danger)",
    Medium: "#F59E0B",
    Low: "#EAB308",
    Informational: "#60A5FA",
  };

  return (
    <div className="relative h-full">
      {findOpen && (
        <FindBar
          inputRef={findInputRef}
          query={findQuery}
          onQueryChange={setFindQuery}
          activeMatch={activeMatch}
          matchCount={matchLines.length}
          onStep={stepMatch}
          onClose={closeFind}
        />
      )}
      <div
        ref={containerRef}
        className="overflow-auto text-xs h-full theme-mono"
        style={{ maxHeight: "100%" }}
      >
      {/* File name header */}
      <div
        data-source-header
        className="sticky top-0 z-10 px-3 py-1.5 card-divider text-xs font-semibold theme-secondary-bg theme-text-secondary"
      >
        {file.name}
      </div>

      {/* Source lines */}
      <div className="py-0">
        {lines.map((_line, i) => {
          const lineNum = i + 1;
          const isCurrentLine = lineNum === currentLine;
          const isHighlighted = highlightLines?.has(lineNum);
          const isFindMatch = matchSet.has(lineNum);
          const isActiveFind = findOpen && lineNum === activeMatchLine;
          const lineFindings = findingsByLine.get(lineNum);
          const tokens = tokenizedLines[i] ?? [];

          return (
            <div
              key={lineNum}
              data-line={lineNum}
              className="flex"
              style={{
                backgroundColor: isActiveFind
                  ? "rgba(210, 153, 34, 0.35)"
                  : isFindMatch
                    ? "rgba(210, 153, 34, 0.15)"
                    : isCurrentLine
                      ? "rgba(139, 92, 246, 0.15)"
                      : isHighlighted
                        ? "rgba(139, 92, 246, 0.05)"
                        : "transparent",
                borderLeft: isActiveFind
                  ? "3px solid var(--color-warning)"
                  : isCurrentLine
                    ? "3px solid var(--color-accent)"
                    : "3px solid transparent",
                minHeight: "20px",
              }}
            >
              {/* Gutter — clickable when the line has an opcode to jump to */}
              {(() => {
                const isExecutable = executableLines?.has(lineNum) ?? false;
                const clickable = !!onLineClick && isExecutable;
                const gutter = (
              <span
                onClick={clickable ? () => onLineClick(lineNum) : undefined}
                className="w-12 text-right pr-3 flex-shrink-0 select-none"
                style={{
                  color: isCurrentLine
                    ? "var(--color-accent)"
                    : isExecutable
                      ? "var(--color-text-secondary)"
                      : "var(--color-text-muted)",
                  userSelect: "none",
                  cursor: clickable ? "pointer" : undefined,
                }}
              >
                {lineFindings && (
                  <Tooltip label={lineFindings.map((f) => `[${f.severity}] ${f.message}`).join("\n")}>
                    <span
                      className="inline-block w-2 h-2 mr-1"
                      style={{ backgroundColor: severityColors[lineFindings[0]?.severity ?? ""] ?? "#60A5FA" }}
                    />
                  </Tooltip>
                )}
                {lineNum}
              </span>
                );
                return clickable ? (
                  <Tooltip label={`Jump to first opcode on line ${lineNum}`} className="w-12 flex-shrink-0">
                    {gutter}
                  </Tooltip>
                ) : gutter;
              })()}

              {/* Code with interactive tokens. Tokens are split by the active
                  span so the exact executing sub-expression can be boxed.
                  Adjacent highlighted segments are wrapped in ONE run-container
                  so the box reads as a single continuous region instead of N
                  abutting rounded boxes — see runs-grouping below. */}
              <span className="flex-1 whitespace-pre" style={{ tabSize: 4 }}>
                {(() => {
                  const segs = splitTokensBySpan(tokens, lineNum, highlightSpan ?? null);
                  const renderToken = (
                    { token }: { token: Token },
                    j: number,
                    highlighted: boolean,
                  ) => {
                    const isClickable = token.type === "identifier";
                    return (
                      <span
                        key={j}
                        onClick={isClickable ? () => handleTokenClick(token, lineNum) : undefined}
                        onMouseEnter={isClickable ? (e) => { e.currentTarget.style.textDecoration = "underline"; } : undefined}
                        onMouseLeave={isClickable ? (e) => { e.currentTarget.style.textDecoration = "none"; } : undefined}
                        style={{
                          color: TOKEN_COLORS[token.type],
                          fontWeight: highlighted ? 700 : undefined,
                          cursor: isClickable ? "pointer" : undefined,
                        }}
                      >
                        {token.value}
                      </span>
                    );
                  };

                  // Walk segments, grouping consecutive `highlighted: true` ones
                  // into a run that shares one box. Non-highlighted segments
                  // emit individually with no wrapper.
                  const out: ReactNode[] = [];
                  let i = 0;
                  let runIdx = 0;
                  while (i < segs.length) {
                    if (!segs[i]!.highlighted) {
                      out.push(renderToken(segs[i]!, i, false));
                      i++;
                      continue;
                    }
                    const start = i;
                    while (i < segs.length && segs[i]!.highlighted) i++;
                    const run = segs.slice(start, i);
                    out.push(
                      <span
                        key={`run-${runIdx++}`}
                        style={{
                          backgroundColor: "rgba(139, 92, 246, 0.35)",
                          boxShadow: "0 0 0 1px rgba(139, 92, 246, 0.7)",
                          borderRadius: "2px",
                        }}
                      >
                        {run.map((seg, j) => renderToken(seg, start + j, true))}
                      </span>,
                    );
                  }
                  return out;
                })()}
              </span>
            </div>
          );
        })}
        </div>
      </div>
    </div>
  );
}
