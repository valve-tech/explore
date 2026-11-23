import type { NavAction, NavTarget } from "./resolveClick";

/** The click map of the source pane. ShortcutsHelp renders it. */
export const SOURCE_CLICK_MAP: ReadonlyArray<{ keys: string; label: string }> = [
  { keys: "Click", label: "Go to implementation / declaration" },
  { keys: "⌘/Ctrl+Click call", label: "Go to the step that runs it" },
  { keys: "⌥/Alt+Click", label: "List all definitions" },
  { keys: "Click import path", label: "Open file" },
];

const KIND_LABEL: Record<NavTarget["kind"], string> = {
  function: "implementation", modifier: "modifier body", event: "event declaration",
  error: "error declaration", struct: "struct declaration", enum: "enum declaration",
  "state-var": "state variable declaration", constructor: "constructor", receive: "receive function",
  fallback: "fallback function", contract: "contract declaration", interface: "interface declaration",
  library: "library declaration", local: "local declaration",
};

/** One short line that says what a target is: "ERC20 · ERC20.sol:42". */
export function describeTarget(t: NavTarget): string {
  const what = t.kind === "function" && !t.hasBody ? "declaration only" : KIND_LABEL[t.kind];
  const where = `${t.file.split("/").pop()}:${t.line}`;
  return `${t.owner ? t.owner + " · " : ""}${what} · ${where}${t.addr ? " · callee " + t.addr.slice(0, 8) + "…" : ""}`;
}

/** Hover text for an action; null when the click does nothing. */
export function describeAction(a: NavAction): string | null {
  switch (a.type) {
    case "none":
      return null;
    case "open-file":
      return `Open ${a.file}`;
    case "step":
      return `Go to the step that runs ${a.label} in this frame`;
    case "list":
      return `List ${a.targets.length} definition${a.targets.length === 1 ? "" : "s"} of ${a.label}`;
    case "goto": {
      const what = a.interfaceOnly ? "interface declaration (no implementation source)" : KIND_LABEL[a.target.kind];
      const owner = a.target.owner ? ` in ${a.target.owner}` : "";
      return `Go to ${what} of ${a.label}${owner}`;
    }
  }
}
