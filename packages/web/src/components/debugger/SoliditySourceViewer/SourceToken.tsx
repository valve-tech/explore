import { TOKEN_COLORS, isNavigableToken, type Token, type TokenType } from "./tokenize";
import { clickModifierOf } from "../StepDebugger/sourceNav/planGoto";
import type { ClickModifier } from "../StepDebugger/sourceNav/resolveClick";

/** Where a token sits: file name, 1-based line, 0-based column. */
export interface SourceTokenPos {
  file: string;
  line: number;
  col: number;
  /** Token class from the tokenizer. The resolver uses it as a hint. */
  tokenType?: TokenType;
}

export interface SourceTokenClick extends SourceTokenPos {
  text: string;
  modifier: ClickModifier;
}

/**
 * One token of a source line. Only navigable tokens (identifier and function
 * classes) and strings (import paths) can act. Keywords, elementary types,
 * builtins, literals and comments never get a handler.
 * The pointer cursor and the underline appear on hover ONLY when
 * `describeToken` says the click does something, so no token shows a false
 * cursor. Without `describeToken`, every identifier is treated as clickable.
 */
export function SourceToken({
  token,
  pos,
  highlighted,
  onTokenClick,
  describeToken,
}: {
  token: Token;
  pos: SourceTokenPos;
  highlighted: boolean;
  onTokenClick?: (click: SourceTokenClick) => void;
  describeToken?: (pos: SourceTokenPos, modifier: ClickModifier) => string | null;
}) {
  const interactive = !!onTokenClick && (isNavigableToken(token) || token.type === "string");
  const style = { color: TOKEN_COLORS[token.type], fontWeight: highlighted ? 700 : undefined };
  if (!interactive) return <span style={style}>{token.value}</span>;
  return (
    <span
      onClick={(e) => onTokenClick({ ...pos, text: token.value, modifier: clickModifierOf(e) })}
      onMouseEnter={(e) => {
        const hint = describeToken
          ? describeToken(pos, clickModifierOf(e))
          : isNavigableToken(token) ? "" : null;
        if (hint === null) return;
        e.currentTarget.style.textDecoration = "underline";
        e.currentTarget.style.cursor = "pointer";
        if (hint) e.currentTarget.title = hint;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.textDecoration = "none";
        e.currentTarget.style.cursor = "";
        e.currentTarget.removeAttribute("title");
      }}
      style={style}
    >
      {token.value}
    </span>
  );
}
