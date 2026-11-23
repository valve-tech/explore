import type { SourceFile } from "../../../../api/source";
import type { DeclKind, SolIndex } from "./solIndex";

export type ClickModifier = "plain" | "meta" | "alt";
export type TargetKind = DeclKind | "contract" | "interface" | "library" | "local";

export interface NavTarget {
  file: string;
  line: number;
  kind: TargetKind;
  owner: string | null;
  /** False for an interface or abstract declaration. */
  hasBody: boolean;
  /** Set when the trace shows the step where this target started to run. */
  step?: number;
  /** Set when the target is in ANOTHER contract's source (the callee). */
  addr?: string;
}

export type NavAction =
  | { type: "none" }
  /** Scroll the source pane to one declaration. */
  | { type: "goto"; label: string; target: NavTarget; interfaceOnly?: boolean; note?: string }
  | { type: "open-file"; file: string }
  /** Move the cursor to the step where this line executes in the frame. */
  | { type: "step"; label: string; line: number }
  | { type: "list"; label: string; targets: NavTarget[] };

export interface ClickInput {
  files: readonly SourceFile[];
  file: string;
  /** 1-based line. */
  line: number;
  /** 0-based column of any character of the clicked token. */
  col: number;
  modifier: ClickModifier;
  /** Verified name of the contract that executes, when known. */
  contractName?: string | null;
  /** Sources of the next external callee of this frame, implementation first. */
  callee?: ReadonlyArray<{ addr: string; files: readonly SourceFile[] }>;
  /**
   * Token class from the source tokenizer, when the caller has it. A
   * `function`-class token is a callable name (a call or a declaration), so
   * local variables are never searched for it. A class that cannot navigate
   * (keyword, type, builtin, number, comment…) resolves to nothing.
   */
  tokenType?: string;
  /** Prebuilt index of `files`. */
  index?: SolIndex;
}
