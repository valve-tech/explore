import { useState, useEffect, useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Icon } from "@iconify/react";
import {
  isCallOp,
  isStorageOp,
  isLogOp,
  useOpcodeNavigation,
} from "@valve-tech/trace-sdk/hooks";
import {
  fetchOpcodeDetail,
  type OpcodeStep,
  type CallFrame,
  type StepDetail,
} from "../../api/debugger";
import { analyzeContract, type SlitherFinding } from "../../api/source";
import { useContractSource, useSourceMappings } from "../../hooks/useContractSource";
import { useContractMeta } from "../../hooks/useContractMeta";
import { useSignatures } from "../../hooks/useSignatures";
import FindingsPanel from "./SlitherFindingsPanel";
import { walkCallTree } from "./StepDebugger/callTreeHelpers";
import { mapFramesToSteps } from "./StepDebugger/callTreeModel";
import { computePcsByContract } from "./StepDebugger/executionScopes";
import { buildLogsByStep } from "./StepDebugger/logsByStep";
import { publishNavContext, publishNavState } from "./StepDebugger/navDiagnostics";
import { useTraceSourceMaps } from "../../hooks/useTraceSourceMaps";
import { useTraceSources } from "../../hooks/useTraceSources";
import { CollapsiblePanel } from "./StepDebugger/CollapsiblePanel";
import { ResizablePanel } from "./StepDebugger/ResizablePanel";
import { ControlsBar } from "./StepDebugger/ControlsBar";
import { CallContextBreadcrumb } from "./StepDebugger/CallContextBreadcrumb";
import { CallTreeFromOpcodes } from "./StepDebugger/CallTreeFromOpcodes";
import { findFunctionLine } from "./StepDebugger/findFunctionLine";
import { findDefinitionLine } from "./StepDebugger/findDefinitionLine";
import {
  emptyHistory,
  pushEntry as pushHistoryEntry,
  goBack as historyGoBack,
  goForward as historyGoForward,
  canGoBack as historyCanGoBack,
  canGoForward as historyCanGoForward,
  currentEntry as historyCurrentEntry,
} from "./StepDebugger/navHistory";
import { DecodedTrace } from "./StepDebugger/DecodedTrace";
import { SourceOpcodeSplit } from "./StepDebugger/SourceOpcodeSplit";
import { opcodeFrequencies } from "./StepDebugger/opcodeStats";
import { StoragePanel, type StorageDiff } from "./StepDebugger/StoragePanel";
import { StackPanel } from "./StepDebugger/StackPanel";
import { MemoryPanel } from "./StepDebugger/MemoryPanel";
import { ShortcutsHelp } from "./StepDebugger/ShortcutsHelp";
import { OperandBar } from "./StepDebugger/OperandBar";
import { describeOperands } from "./StepDebugger/opcodeOperands";
import { FrameOpcodesOverlay } from "./StepDebugger/FrameOpcodesOverlay";
import { DebuggerWorkspaceSuggest } from "./DebuggerWorkspaceSuggest";
import { Tooltip } from "../primitives/Tooltip";

interface DecodedLog {
  eventName: string;
  args: { type: string }[];
  logIndex: number;
}
interface RawLog {
  address: string;
  topics: string[];
  logIndex: number;
}

interface StepDebuggerProps {
  steps: OpcodeStep[];
  contractAddress?: string;
  callTrace?: CallFrame | null;
  txHash?: string | null;
  /** Receipt logs (emission order), used to decode the events in the tree. */
  decodedLogs?: DecodedLog[];
  rawLogs?: RawLog[];
}

// Per-step state (stack/memory/storage) is loaded lazily in chunks of this
// many steps. The skeleton trace carries none of it (it'd be ~70% of the
// payload across 100k+ steps); we fetch a window covering the cursor and let
// TanStack Query cache each chunk.
const DETAIL_CHUNK = 512;

// One row per remembered navigation. Tree-row clicks and identifier clicks
// push these; the toolbar's Recent dropdown reads them out, newest first.
interface RecentNav {
  step: number;
  overrideLine: number | null;
  label: string;
  kind: "function" | "definition";
  timestamp: number;
}
const RECENT_CAP = 20;

// Identifiers the Solidity compiler exposes globally — they have no user-source
// declaration to navigate to, so clicking them in the source pane should be a
// silent no-op. Covers value/data globals (msg/tx/block/abi), keyword-ish names
// (this/super, true/false), math/crypto helpers (keccak256, ecrecover, addmod),
// control-flow helpers (require/assert/revert), and the elementary type names
// the tokenizer flags as identifiers in casts (`address(0)`, `uint256(...)`).
const SOLIDITY_GLOBALS = new Set<string>([
  "msg", "tx", "block", "abi",
  "this", "super",
  "true", "false",
  "now",
  "require", "assert", "revert",
  "keccak256", "sha256", "sha3", "ripemd160", "ecrecover",
  "addmod", "mulmod", "blockhash", "gasleft", "selfdestruct", "suicide",
  "type",
  "address", "bool", "string", "bytes",
  "uint", "uint8", "uint16", "uint32", "uint64", "uint128", "uint256",
  "int", "int8", "int16", "int32", "int64", "int128", "int256",
  "bytes1", "bytes2", "bytes4", "bytes8", "bytes16", "bytes20", "bytes32",
]);

export default function StepDebugger({
  steps,
  contractAddress,
  callTrace,
  txHash,
  decodedLogs,
  rawLogs,
}: StepDebuggerProps) {
  const nav = useOpcodeNavigation(steps);
  const { currentIndex: currentStep, totalSteps } = nav;

  // Lazy per-step state for the chunk containing the cursor. The first fetch
  // for a tx warms a server-side full-trace cache (~seconds); later chunks are
  // instant. Diffs read current + previous step out of the same chunk — so
  // every chunk after the first asks for one extra step at its front. Without
  // that one-step overlap, landing on step 512 (or any DETAIL_CHUNK boundary)
  // would show an empty storage diff because step 511's detail lives in the
  // previous chunk that's no longer in cache.
  const chunkStart = Math.floor(currentStep / DETAIL_CHUNK) * DETAIL_CHUNK;
  const fetchFrom = Math.max(0, chunkStart - 1);
  const detailQuery = useQuery({
    queryKey: ["opcode-detail", txHash, fetchFrom],
    queryFn: () =>
      fetchOpcodeDetail(txHash!, fetchFrom, chunkStart + DETAIL_CHUNK),
    enabled: !!txHash && steps.length > 0,
    staleTime: Infinity,
    gcTime: Infinity,
  });
  const detailMap = detailQuery.data?.detail ?? null;
  const detailLoading = detailQuery.isFetching && !detailMap;
  const currentDetail: StepDetail | null = detailMap?.[currentStep] ?? null;
  const prevDetail: StepDetail | null =
    currentStep > 0 ? detailMap?.[currentStep - 1] ?? null : null;

  const [opcodeFilter, setOpcodeFilter] = useState("");
  const [contentView, setContentView] = useState<"debugger" | "trace">("debugger");
  // Call-tree column width — resizable so long frame labels are readable.
  const [treeWidth, setTreeWidth] = useState(() => {
    const saved = Number(localStorage.getItem("debugger:treeWidth"));
    return saved >= 240 && saved <= 760 ? saved : 360;
  });
  const handleTreeResize = useCallback((w: number) => {
    setTreeWidth(w);
    localStorage.setItem("debugger:treeWidth", String(w));
  }, []);
  // A call frame whose opcode slice is shown in the expand overlay.
  const [expandedFrame, setExpandedFrame] = useState<
    { frame: CallFrame; from: number; label: string } | null
  >(null);
  const [slitherFindings, setSlitherFindings] = useState<SlitherFinding[]>([]);
  const [slitherLoading, setSlitherLoading] = useState(false);
  const [showFindings, setShowFindings] = useState(false);
  const [overrideLine, setOverrideLine] = useState<number | null>(null);
  // A queued function-name search that couldn't be resolved at click time
  // because the target contract's source hadn't loaded yet. The resolver effect
  // runs the (pure) findFunctionLine helper once sourcesByAddr catches up.
  const [pendingSearch, setPendingSearch] = useState<
    { funcName: string; contractAddr?: string } | null
  >(null);
  // User-visible error when a click asked for a function we couldn't locate
  // (e.g. the search found nothing in the target contract's source). Auto-
  // cleared on the next successful navigation.
  const [navError, setNavError] = useState<string | null>(null);
  const [scrollKey, setScrollKey] = useState(0);
  // Browser-style bidirectional navigation history. Tree-row clicks and source
  // identifier clicks push; back/forward (Cmd+[ / Cmd+]) walk without pushing.
  const [navHistory, setNavHistory] = useState(emptyHistory);
  // List-style "recent navigation" — distinct from the linear back/forward
  // history above. Records labeled jumps in time order so the user can pop a
  // dropdown and skip back to anywhere they've been, not just one step. Per-
  // mount (the parent keys this component by txHash, so a new tx starts fresh).
  const [recents, setRecents] = useState<RecentNav[]>([]);
  const [recentsOpen, setRecentsOpen] = useState(false);
  const pushRecent = useCallback(
    (nav: Omit<RecentNav, "timestamp">) => {
      setRecents((prev) => {
        const head = prev[0];
        if (head && head.step === nav.step && head.label === nav.label) return prev;
        return [{ ...nav, timestamp: Date.now() }, ...prev].slice(0, RECENT_CAP);
      });
    },
    [],
  );

  const maxDepth = useMemo(() => {
    let max = 1;
    for (const s of steps) if (s.depth > max) max = s.depth;
    return max;
  }, [steps]);

  // Exact opcode match: filtering to "ADD" should not also catch "ADDRESS",
  // and the highlighted count must equal the frequency tag's count.
  // Returns a Set so per-row membership checks in the virtualized trace pane
  // are O(1) — an array .includes() per visible row used to scale with the
  // filter size during scroll.
  const filteredIndices = useMemo<Set<number> | null>(() => {
    if (!opcodeFilter) return null;
    const upper = opcodeFilter.toUpperCase();
    const set = new Set<number>();
    for (let i = 0; i < steps.length; i++) {
      if (steps[i]!.op === upper) set.add(i);
    }
    return set;
  }, [opcodeFilter, steps]);

  const opcodeFreqs = useMemo(() => opcodeFrequencies(steps), [steps]);

  const toggleOpcode = useCallback(
    (op: string) => setOpcodeFilter((prev) => (prev === op ? "" : op)),
    [],
  );

  const handleAnalyze = useCallback(async () => {
    if (!contractAddress || slitherLoading) return;
    setSlitherLoading(true);
    setNavError(null);
    try {
      const res = await analyzeContract(contractAddress);
      if (res.ok && res.analysis) {
        // Always reveal the panel — its own empty-state message handles the
        // 0-findings case, which used to render nothing and looked like the
        // analysis had silently failed.
        setSlitherFindings(res.analysis.findings);
        setShowFindings(true);
        setContentView("debugger");
      } else {
        setNavError(res.error ?? "Slither analysis failed.");
      }
    } catch (err) {
      setNavError(`Slither analysis failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSlitherLoading(false);
    }
  }, [contractAddress, slitherLoading]);

  // Collect every address and selector reachable from the call tree
  // so we can warm contract-name and 4byte-signature caches up-front.
  const callTreeAddresses = useMemo(() => {
    if (!callTrace) return [];
    const addrs = new Set<string>();
    walkCallTree(callTrace, (f) => { if (f.to) addrs.add(f.to); });
    return [...addrs];
  }, [callTrace]);

  const callTreeSelectors = useMemo(() => {
    if (!callTrace) return [];
    const sels = new Set<string>();
    walkCallTree(callTrace, (f) => {
      if (f.input && f.input.length >= 10) sels.add(f.input.slice(0, 10).toLowerCase());
    });
    return [...sels];
  }, [callTrace]);

  const { names: contractNames, abiSelectors, eventTopics } = useContractMeta(callTreeAddresses);
  const { data: signatureMap = {} } = useSignatures(callTreeSelectors);

  // Frame → entry-step mapping (lifted here so per-contract source maps can be
  // computed once and shared with the call tree).
  const frameStepMap = useMemo(
    () => (callTrace ? mapFramesToSteps(callTrace, steps) : new Map<CallFrame, number>()),
    [callTrace, steps],
  );

  // Step ranges of every frame that actually ran code, from the same
  // frameStepMap the call tree uses. The previous approach counted CALL-family
  // opcodes and paired them with the flattened tree in order; a codeless callee
  // (EOA / precompile) or any call whose op/frame ordering didn't line up threw
  // the count off by one and every later step resolved to the wrong contract
  // ("fine until WPLS.balanceOf, then downhill"). Depth-bounded ranges don't
  // drift: a frame owns [entry, end) where end is the first shallower step.
  const frameRanges = useMemo(() => {
    if (!callTrace) return [] as Array<{ addr: string | null; entry: number; end: number; depth: number }>;
    const out: Array<{ addr: string | null; entry: number; end: number; depth: number }> = [];
    const visit = (frame: CallFrame, parentDepth: number) => {
      const entry = frameStepMap.get(frame);
      if (entry === undefined) return;
      const depth = steps[entry]?.depth ?? parentDepth + 1;
      // A frame "ran code" only if it executed at a deeper depth than its
      // parent; a codeless callee is mapped to the parent-depth CALL op and is
      // skipped so it can't masquerade as the active contract.
      const ranCode = depth > parentDepth;
      if (ranCode) {
        let end = steps.length;
        for (let i = entry + 1; i < steps.length; i++) {
          if (steps[i]!.depth < depth) { end = i; break; }
        }
        out.push({ addr: frame.to ?? null, entry, end, depth });
        for (const c of frame.calls ?? []) visit(c, depth);
      } else {
        for (const c of frame.calls ?? []) visit(c, parentDepth);
      }
    };
    visit(callTrace, 0);
    return out;
  }, [callTrace, frameStepMap, steps]);

  // Source maps for EVERY contract in the trace, so the call tree can trace
  // internal functions across all of them (Remix's model), not just the active
  // contract. Keyed by the pcs each contract actually executed.
  const pcsByContract = useMemo(
    () => (callTrace ? computePcsByContract(callTrace, frameStepMap, steps) : {}),
    [callTrace, frameStepMap, steps],
  );
  const { data: traceSourceMaps = {} } = useTraceSourceMaps(pcsByContract);
  // Source files per contract, so the tree can name internal functions exactly
  // and split library calls from a contract's own internals.
  const traceSourceAddrs = useMemo(() => Object.keys(pcsByContract), [pcsByContract]);
  const { data: sourcesByAddr, refetch: refetchSources } = useTraceSources(traceSourceAddrs);

  // Decoded events keyed by the LOG opcode's step, so the call tree can show
  // each emitted event nested in the function that fired it.
  const logsByStep = useMemo(
    () => buildLogsByStep(steps, rawLogs ?? [], eventTopics, decodedLogs ?? []),
    [steps, rawLogs, eventTopics, decodedLogs],
  );

  const uniquePcs = useMemo(() => [...new Set(steps.map((s) => s.pc))], [steps]);

  // ---- Navigation ----
  // useOpcodeNavigation owns the cursor + traversal primitives. These wrappers
  // add the web-specific side effect of clearing `overrideLine` (manual
  // source-line override from func-search) on every navigation event.
  const goTo = nav.jumpTo;

  const stepForward = useCallback(() => { setOverrideLine(null); nav.goForward(); }, [nav]);
  const stepBackward = useCallback(() => { setOverrideLine(null); nav.goBack(); }, [nav]);

  // The expanded frame's opcode slice — from its entry until execution returns
  // above its depth (so nested sub-calls are included). Hoisted up here so the
  // keyboard handler below can clamp arrow nav to the frame when an overlay is
  // open. Returns null when no frame is expanded.
  const expandedRange = useMemo(() => {
    if (!expandedFrame) return null;
    const from = expandedFrame.from;
    const baseDepth = steps[from]?.depth ?? 1;
    let to = steps.length;
    for (let i = from + 1; i < steps.length; i++) {
      if (steps[i]!.depth < baseDepth) { to = i; break; }
    }
    return { from, to };
  }, [expandedFrame, steps]);

  // Recording navigate: every explicit user-initiated jump (button click,
  // C/S/L hotkey, source-line click, opcode-row click) routes through here so
  // it lands in nav history and is reversible with Cmd+[. Arrow-stepping and
  // the slider intentionally bypass this — they'd flood the history.
  const recordingNavigate = useCallback(
    (step: number, overrideLine: number | null = null) => {
      setOverrideLine(overrideLine);
      goTo(step);
      setNavHistory((h) => pushHistoryEntry(h, { step, overrideLine }));
    },
    [goTo],
  );

  // Jump to a step from the call tree. The debugger split shows source AND
  // the opcode trace, so the click always visibly navigates: the opcode pane
  // auto-scrolls to the step even when there's no verified source, and the
  // source pane scrolls to the function when one exists.
  //
  // The optional `hint` carries a target function name (and the contract it
  // lives in). It's only supplied for rows whose source-map JUMPDEST the
  // optimizer dropped — value transfers (receive/fallback) and bare selectors.
  // We resolve the line synchronously here when the target contract's source is
  // already loaded (the common case, since useTraceSources warms every contract
  // in the trace up-front). A missed lookup raises a visible navError instead
  // of silently falling back to the entry step's source map — which was the
  // root of the "lands at contract base, then jumps" flicker.
  const jumpToAndShowSource = useCallback(
    (step: number, hint?: { funcName: string; contractAddr?: string }) => {
      // Reset any prior nav state so a leftover override / error from an
      // earlier click can't bleed into this one.
      setOverrideLine(null);
      setNavError(null);
      setPendingSearch(null);
      goTo(step);
      setContentView("debugger");
      setScrollKey((k) => k + 1);

      // Resolve the target overrideLine eagerly so we can push the right entry.
      let resolvedLine: number | null = null;
      if (hint) {
        const addrKey = hint.contractAddr?.toLowerCase();
        const files = addrKey ? sourcesByAddr[addrKey] : undefined;
        const where = hint.contractAddr ? `${hint.contractAddr.slice(0, 8)}…` : "this contract";

        if (files === undefined) {
          setPendingSearch(hint); // not loaded yet — resolver effect will pick it up
        } else if (files.length === 0) {
          setNavError(`No verified source for ${where} — can't locate \`${hint.funcName}()\`.`);
        } else {
          const hit = findFunctionLine(files, hint.funcName);
          if (hit) {
            resolvedLine = hit.line;
            setOverrideLine(hit.line);
          } else {
            setNavError(`Couldn't locate \`${hint.funcName}()\` in ${where}'s source.`);
          }
        }
      }
      setNavHistory((h) => pushHistoryEntry(h, { step, overrideLine: resolvedLine }));
      if (hint?.funcName) {
        pushRecent({ step, overrideLine: resolvedLine, label: hint.funcName, kind: "function" });
      }
    },
    [goTo, sourcesByAddr, pushRecent],
  );

  // Jump to the next opcode satisfying `predicate`, but only within the active
  // frame's [entry, end) — i.e. this frame and its descendants. Walking out of
  // the frame would surface SSTOREs/CALLs/LOGs from unrelated code further
  // down the trace; users almost always want "next thing in THIS execution".
  const jumpToNext = useCallback(
    (predicate: (op: string) => boolean): void => {
      let end = steps.length;
      let bestDepth = -1;
      for (const f of frameRanges) {
        if (f.entry <= currentStep && currentStep < f.end && f.depth > bestDepth) {
          bestDepth = f.depth;
          end = f.end;
        }
      }
      for (let j = currentStep + 1; j < end; j++) {
        if (predicate(steps[j]!.op)) {
          recordingNavigate(j);
          return;
        }
      }
    },
    [recordingNavigate, steps, frameRanges, currentStep],
  );

  // Whether a "next CALL / SSTORE / LOG" exists in the active frame from the
  // current cursor onward. Drives the disabled state of the C/S/L hotkeys and
  // toolbar buttons so the user gets feedback when they've reached the last
  // one instead of silent no-op clicks. One forward scan covers all three
  // predicates; we early-exit as soon as each is found.
  const hasNext = useMemo(() => {
    let end = steps.length;
    let bestDepth = -1;
    for (const f of frameRanges) {
      if (f.entry <= currentStep && currentStep < f.end && f.depth > bestDepth) {
        bestDepth = f.depth;
        end = f.end;
      }
    }
    let call = false, store = false, log = false;
    for (let j = currentStep + 1; j < end && (!call || !store || !log); j++) {
      const op = steps[j]!.op;
      if (!call && isCallOp(op)) call = true;
      if (!store && isStorageOp(op)) store = true;
      if (!log && isLogOp(op)) log = true;
    }
    return { call, store, log };
  }, [steps, frameRanges, currentStep]);

  // Go-to-definition: triggered when the user clicks any identifier token in
  // the source pane. Resolves the symbol in the active contract's flattened
  // sources and scrolls the source pane there.
  //
  // Misses are SILENT — many clicked identifiers are things we can't
  // navigate to: Solidity globals (msg, tx, block, abi), function parameters,
  // local variables, member-access right-hand sides (`x.sender`), inherited
  // symbols from external libs. Firing a red error banner for every one of
  // those felt like "the tool is broken." Silent no-op matches what an IDE
  // does when you cmd-click something it can't resolve.
  const jumpToDefinition = useCallback(
    (name: string) => {
      // Solidity globals never have a declaration in user source. Bail before
      // even searching so we never even render a flash.
      if (SOLIDITY_GLOBALS.has(name)) return;

      let addr: string | null = null;
      let frame: { entry: number; end: number } | null = null;
      let bestDepth = -1;
      for (const f of frameRanges) {
        if (f.entry <= currentStep && currentStep < f.end && f.depth > bestDepth) {
          bestDepth = f.depth;
          addr = f.addr;
          frame = { entry: f.entry, end: f.end };
        }
      }
      const addrKey = addr?.toLowerCase();
      const files = addrKey ? sourcesByAddr[addrKey] : undefined;
      if (!files || files.length === 0) return; // no source — silent
      const hit = findDefinitionLine(files, name);
      if (!hit) return; // unresolved — silent

      // Couple the execution cursor: find the first opcode in the active frame
      // that maps to the target source line. Walk only within [frame.entry,
      // frame.end) so we don't jump out of the execution context the user is
      // currently inspecting. If no opcode maps to that line in this frame
      // (e.g. clicking a contract NAME at the contract declaration line — no
      // opcode lives there), the source pane still moves but the cursor stays.
      let targetStep: number | null = null;
      if (addrKey && frame) {
        const pcMap = traceSourceMaps[addrKey];
        if (pcMap) {
          for (let j = frame.entry; j < frame.end; j++) {
            const loc = pcMap[steps[j]!.pc];
            if (loc && loc.file === hit.file && loc.line === hit.line) {
              targetStep = j;
              break;
            }
          }
        }
      }

      setNavError(null);
      setOverrideLine(hit.line);
      setScrollKey((k) => k + 1);
      if (targetStep !== null) goTo(targetStep);
      const landedStep = targetStep ?? currentStep;
      setNavHistory((h) =>
        pushHistoryEntry(h, { step: landedStep, overrideLine: hit.line }),
      );
      pushRecent({ step: landedStep, overrideLine: hit.line, label: name, kind: "definition" });
    },
    [frameRanges, currentStep, sourcesByAddr, traceSourceMaps, steps, goTo, pushRecent],
  );

  // Apply a history entry (back/forward). Same shape as the other navigators
  // — clear pending state, restore step + line — but does NOT push to history,
  // so back→forward returns you to where you were, not a new branch.
  const applyHistoryEntry = useCallback(
    (entry: { step: number; overrideLine: number | null }) => {
      setPendingSearch(null);
      setNavError(null);
      setOverrideLine(entry.overrideLine);
      goTo(entry.step);
      setContentView("debugger");
      setScrollKey((k) => k + 1);
    },
    [goTo],
  );
  const navGoBack = useCallback(() => {
    const next = historyGoBack(navHistory);
    if (next === navHistory) return;
    const entry = historyCurrentEntry(next);
    if (entry) applyHistoryEntry(entry);
    setNavHistory(next);
  }, [navHistory, applyHistoryEntry]);
  const navGoForward = useCallback(() => {
    const next = historyGoForward(navHistory);
    if (next === navHistory) return;
    const entry = historyCurrentEntry(next);
    if (entry) applyHistoryEntry(entry);
    setNavHistory(next);
  }, [navHistory, applyHistoryEntry]);
  const canBack = historyCanGoBack(navHistory);
  const canForward = historyCanGoForward(navHistory);

  // Dev-only: publish nav history under window.__traceNav.history so we can
  // verify whether multiple jumps are actually accumulating entries. Read in
  // the browser console: `__traceNav.history`.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as { __traceNav?: Record<string, unknown> };
    w.__traceNav = { ...(w.__traceNav ?? {}), history: navHistory };
  }, [navHistory]);

  // Dev-only: expose useTraceSources' refetch so a console user can force a
  // re-check of contracts that came back unverified (the call tree degrades to
  // address-only labels without sources; verifying mid-session and calling
  // `__traceNav.refetchSources()` repaints without a hard reload).
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as { __traceNav?: Record<string, unknown> };
    w.__traceNav = { ...(w.__traceNav ?? {}), refetchSources };
  }, [refetchSources]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      // When the call tree has focus, it owns the arrow/enter keys (expand /
      // collapse / move). Don't also scrub the trace from underneath it.
      if (e.target instanceof HTMLElement && e.target.closest("[data-debugger-tree]")) return;
      // When the frame overlay is open, nav scopes to that frame's range —
      // arrows clamp at its boundaries, Home/End jump to its endpoints — so
      // you can't walk the cursor out of the focused frame without explicitly
      // closing the overlay (Esc) or using nav-history (Cmd+[).
      // Clamping only kicks in when the cursor is INSIDE the frame; if it's
      // already outside (e.g. walked there via Cmd+[), stepping is unrestricted.
      switch (e.key) {
        case "ArrowRight":
        case " ":
          e.preventDefault();
          if (expandedRange && currentStep === expandedRange.to - 1) break;
          stepForward();
          break;
        case "ArrowLeft":
          e.preventDefault();
          if (expandedRange && currentStep === expandedRange.from) break;
          stepBackward();
          break;
        case "Home":
          e.preventDefault();
          recordingNavigate(expandedRange?.from ?? 0);
          break;
        case "End":
          e.preventDefault();
          recordingNavigate(expandedRange ? expandedRange.to - 1 : totalSteps - 1);
          break;
        case "c": case "C":
          e.preventDefault(); jumpToNext(isCallOp); break;
        case "s": case "S":
          e.preventDefault(); jumpToNext(isStorageOp); break;
        case "l": case "L":
          e.preventDefault(); jumpToNext(isLogOp); break;
        case "[":
          // Cmd/Ctrl+[ — go back in nav history (browser convention).
          if (e.metaKey || e.ctrlKey) { e.preventDefault(); navGoBack(); }
          break;
        case "]":
          // Cmd/Ctrl+] — go forward in nav history.
          if (e.metaKey || e.ctrlKey) { e.preventDefault(); navGoForward(); }
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [stepForward, stepBackward, recordingNavigate, totalSteps, jumpToNext, navGoBack, navGoForward, expandedRange, currentStep]);

  const step = steps[currentStep];

  // Stack diff: compare from TOS so PUSH/POP/DUP/SWAP highlight correctly.
  // Stack values come from the lazily-loaded detail, not the skeleton step.
  const stackChanges = useMemo(() => {
    if (!currentDetail || !prevDetail) return new Set<number>();
    const changes = new Set<number>();
    const curr = currentDetail.stack;
    const prev = prevDetail.stack;
    const maxLen = Math.max(curr.length, prev.length);
    for (let i = 0; i < maxLen; i++) {
      const currIdx = curr.length - 1 - i;
      const prevIdx = prev.length - 1 - i;
      const currVal = currIdx >= 0 ? curr[currIdx] : undefined;
      const prevVal = prevIdx >= 0 ? prev[prevIdx] : undefined;
      if (currVal !== prevVal && currIdx >= 0) changes.add(currIdx);
    }
    return changes;
  }, [currentDetail, prevDetail]);

  // What the current opcode operates on — its stack inputs (consumed slots),
  // output count, and the memory region / storage slot it touches. Pre-stack
  // is the lazily-loaded detail's stack (geth reports it before the op runs).
  const operands = useMemo(
    () => (step && currentDetail ? describeOperands(step.op, currentDetail.stack) : null),
    [step, currentDetail],
  );
  const inputIndices = useMemo(
    () => new Set(operands?.inputIndices ?? []),
    [operands],
  );

  const onExpandFrame = useCallback(
    (frame: CallFrame, entryStep: number, label: string) =>
      setExpandedFrame({ frame, from: entryStep, label }),
    [],
  );


  const storageDiff = useMemo<StorageDiff[]>(() => {
    if (!currentDetail) return [];
    const curr: Record<string, string> = currentDetail.storage;
    const prev: Record<string, string> = prevDetail?.storage ?? {};
    const diffs: StorageDiff[] = [];
    for (const [slot, value] of Object.entries(curr)) {
      if (prev[slot] !== value) {
        diffs.push({ slot, oldValue: prev[slot] ?? null, newValue: value });
      }
    }
    return diffs;
  }, [currentDetail, prevDetail]);

  // The contract executing at the cursor = the deepest frame whose range covers
  // the current step. For DELEGATECALL the frame's `to` is the code contract,
  // which is exactly the source we want to show.
  const activeContractAddress = useMemo(() => {
    let best: string | null = null;
    let bestDepth = -1;
    for (const f of frameRanges) {
      if (f.entry <= currentStep && currentStep < f.end && f.depth > bestDepth) {
        bestDepth = f.depth;
        best = f.addr;
      }
    }
    return best ?? callTrace?.to ?? contractAddress ?? null;
  }, [frameRanges, currentStep, callTrace, contractAddress]);

  const { data: sourceData = null, isLoading: sourceLoading } = useContractSource(activeContractAddress);

  const { data: sourceMappings = {} } = useSourceMappings(
    sourceData?.hasSourceMap ? activeContractAddress : null,
    uniquePcs,
  );

  // Resolver for a click whose target contract's source wasn't loaded yet.
  // Re-runs the pure helper once sourcesByAddr (or, for the no-addr fallback,
  // sourceData) catches up. Mirrors the three-branch logic in the sync handler
  // — missing key keeps waiting, empty array fails fast with navError, populated
  // runs the search. The sync path handles the common case; this is "click
  // landed before the network did".
  useEffect(() => {
    if (!pendingSearch) return;
    const addrKey = pendingSearch.contractAddr?.toLowerCase();
    const files = addrKey ? sourcesByAddr[addrKey] : sourceData?.files;
    if (files === undefined) return; // still loading — wait for another tick

    const where = pendingSearch.contractAddr ? `${pendingSearch.contractAddr.slice(0, 8)}…` : "this contract";
    if (files.length === 0) {
      setNavError(`No verified source for ${where} — can't locate \`${pendingSearch.funcName}()\`.`);
    } else {
      const hit = findFunctionLine(files, pendingSearch.funcName);
      if (hit) {
        setOverrideLine(hit.line);
        setScrollKey((k) => k + 1);
      } else {
        setNavError(`Couldn't locate \`${pendingSearch.funcName}()\` in ${where}'s source.`);
      }
    }
    setPendingSearch(null);
  }, [pendingSearch, sourcesByAddr, sourceData]);

  const currentSourceLocation = step ? sourceMappings[step.pc] ?? null : null;
  const currentSourceFile = sourceData
    ? currentSourceLocation
      ? sourceData.files.find((f) => f.name === currentSourceLocation.file) ?? sourceData.files[0] ?? null
      : sourceData.files[0] ?? null
    : null;

  // While a navigation is mid-flight (waiting for source to load so the search
  // can resolve), don't fall back to the entry step's source-map location —
  // that's what produced the "lands at contract base, then jumps to receive"
  // flicker. Show the previous line until the resolver lands the real one.
  const navigationInFlight = pendingSearch !== null;
  const effectiveLine = navigationInFlight
    ? overrideLine
    : overrideLine ?? currentSourceLocation?.line ?? null;

  // Exact sub-expression highlight from the source map. Suppressed when a
  // manual func-search override is active (those carry only a line), when the
  // mapped location is for a different file than the one shown, or when the
  // span is so large (a JUMPDEST mapping to a whole function/contract body)
  // that boxing it would just paint the screen — there the line accent is
  // clearer. The MAX_SPAN_LINES cap is the threshold for "still a sub-expr".
  const MAX_SPAN_LINES = 4;
  const highlightSpan =
    overrideLine === null &&
    currentSourceLocation !== null &&
    currentSourceFile !== null &&
    currentSourceLocation.file === currentSourceFile.name &&
    currentSourceLocation.endLine - currentSourceLocation.line < MAX_SPAN_LINES
      ? {
          startLine: currentSourceLocation.line,
          startCol: currentSourceLocation.column,
          endLine: currentSourceLocation.endLine,
          endCol: currentSourceLocation.endColumn,
        }
      : null;

  // ---- Dev nav instrumentation (stripped from prod bundles) ----
  // Publishes the step→contract→source-map resolver and the built tree on
  // window.__traceNav, so a headless check can verify, for any tree node, that
  // its jump target resolves to the source location it should. Pure derived
  // data — no click-time bookkeeping.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    publishNavContext({ steps, frameRanges, traceSourceMaps });
  }, [steps, frameRanges, traceSourceMaps]);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    publishNavState({
      currentStep,
      activeContract: activeContractAddress,
      file: currentSourceFile?.name ?? null,
      effectiveLine,
    });
  }, [currentStep, activeContractAddress, currentSourceFile, effectiveLine]);

  // Reverse link: which source lines have an opcode (so their gutter is a
  // clickable jump target), and the first step that lands on each line. Built
  // for the file currently shown so clicking a line jumps execution there.
  const { executableLines, lineToFirstStep } = useMemo(() => {
    const lines = new Set<number>();
    const firstStep = new Map<number, number>();
    if (!currentSourceFile) return { executableLines: lines, lineToFirstStep: firstStep };
    for (let i = 0; i < steps.length; i++) {
      const loc = sourceMappings[steps[i]!.pc];
      if (loc && loc.file === currentSourceFile.name) {
        lines.add(loc.line);
        if (!firstStep.has(loc.line)) firstStep.set(loc.line, i);
      }
    }
    return { executableLines: lines, lineToFirstStep: firstStep };
  }, [steps, sourceMappings, currentSourceFile]);

  const jumpToLine = useCallback(
    (line: number) => {
      const idx = lineToFirstStep.get(line);
      if (idx !== undefined) recordingNavigate(idx);
    },
    [lineToFirstStep, recordingNavigate],
  );

  // All hooks are above this point; the early return is safe here (the cursor
  // is always in range once there are steps, but guard for the empty trace).
  if (!step) return null;

  const callTreeProps = {
    steps, onJumpTo: jumpToAndShowSource, signatureMap, frameStepMap,
    traceSourceMaps, callTrace, contractNames, abiSelectors, logsByStep,
    sourcesByAddr, treeStateKey: txHash, onExpandFrame,
  };

  return (
    <div className="flex flex-col gap-0">
      {txHash && traceSourceAddrs.length > 0 && (
        <DebuggerWorkspaceSuggest
          txHash={txHash}
          addresses={traceSourceAddrs}
        />
      )}
      <ControlsBar
        currentStep={currentStep}
        totalSteps={totalSteps}
        goTo={goTo}
        jumpToStart={() => recordingNavigate(0)}
        jumpToEnd={() => recordingNavigate(totalSteps - 1)}
        stepForward={stepForward}
        stepBackward={stepBackward}
        jumpToNext={jumpToNext}
        hasNext={hasNext}
        opcodeFilter={opcodeFilter}
        setOpcodeFilter={setOpcodeFilter}
        filteredCount={filteredIndices?.size ?? null}
        contractAddress={contractAddress}
        contentView={contentView}
        setContentView={setContentView}
        sourceLoading={sourceLoading}
        handleAnalyze={handleAnalyze}
        slitherLoading={slitherLoading}
        showFindings={showFindings}
        slitherFindingsCount={slitherFindings.length}
      />

      <CallContextBreadcrumb step={step} currentSourceLocation={currentSourceLocation} />

      {showFindings && (
        <FindingsPanel findings={slitherFindings} />
      )}

      <div className="flex flex-col lg:flex-row gap-0 lg:min-h-[500px]">
        {/* Tree column stretches to the content column's height (no dead space
            below it) while staying sticky and capped to the viewport so it
            remains a self-contained, scrollable pane as you move down the page. */}
        <div className="hidden lg:flex sticky top-0 self-stretch" style={{ maxHeight: "100vh" }}>
          <ResizablePanel width={treeWidth} onResize={handleTreeResize} height="100%">
            <CallTreeFromOpcodes {...callTreeProps} />
          </ResizablePanel>
        </div>
        <div className="lg:hidden">
          <CollapsiblePanel title="Call Tree" count={steps.length} suffix="ops" defaultOpen={false}>
            <div style={{ maxHeight: "250px" }} className="overflow-y-auto">
              <CallTreeFromOpcodes {...callTreeProps} inline />
            </div>
          </CollapsiblePanel>
        </div>

        <div className="flex-1 min-w-0 flex flex-col gap-0">
          <div className="flex items-center bs-b">
            {(["debugger", "trace"] as const).map((view) => (
              <button
                key={view}
                onClick={() => setContentView(view)}
                className={`px-4 py-2 text-xs font-medium transition-colors ${contentView === view ? "theme-text" : "theme-text-muted"}`}
                style={{
                  boxShadow:
                    contentView === view
                      ? "0 2px 0 0 var(--color-accent)"
                      : "0 2px 0 0 transparent",
                  backgroundColor: "transparent",
                }}
              >
                {view === "debugger" ? "Source + Opcodes" : "Decoded Trace"}
              </button>
            ))}
            {/* Back / forward through the linear nav history (Cmd+[/]), plus
                a list-style Recent dropdown that shows every labeled jump in
                time order — same shape as the explorer's recents rail, scoped
                to this tx. The two coexist because they answer different
                questions: ← / → walks the browser-style trail; Recent jumps
                anywhere you've been without losing your spot. */}
            <div className="ml-auto flex items-center gap-tight pr-2 relative">
              <Tooltip label="Back (⌘[)">
                <button
                  onClick={navGoBack}
                  disabled={!canBack}
                  className={`px-2 py-1 text-xs font-mono transition-opacity ${canBack ? "theme-text-secondary" : "theme-text-muted"}`}
                  style={{
                    opacity: canBack ? 1 : 0.35,
                    cursor: canBack ? "pointer" : "not-allowed",
                  }}
                >
                  <Icon icon="heroicons:chevron-left" className="w-4 h-4" aria-hidden />
                </button>
              </Tooltip>
              <Tooltip label="Forward (⌘])">
                <button
                  onClick={navGoForward}
                  disabled={!canForward}
                  className={`px-2 py-1 text-xs font-mono transition-opacity ${canForward ? "theme-text-secondary" : "theme-text-muted"}`}
                  style={{
                    opacity: canForward ? 1 : 0.35,
                    cursor: canForward ? "pointer" : "not-allowed",
                  }}
                >
                  <Icon icon="heroicons:chevron-right" className="w-4 h-4" aria-hidden />
                </button>
              </Tooltip>
              {recents.length > 0 && (
                <Tooltip label="Recent jumps">
                  <button
                    onClick={() => setRecentsOpen((o) => !o)}
                    className={`px-2 py-1 text-xs font-mono transition-opacity ${recentsOpen ? "theme-accent" : "theme-text-secondary"}`}
                    style={{
                      cursor: "pointer",
                    }}
                  >
                    Recent
                  </button>
                </Tooltip>
              )}
              {recentsOpen && recents.length > 0 && (
                <>
                  {/* Click-away overlay */}
                  <div
                    onClick={() => setRecentsOpen(false)}
                    style={{
                      position: "fixed",
                      inset: 0,
                      zIndex: 40,
                    }}
                  />
                  <div
                    className="absolute right-0 top-full mt-1 overflow-y-auto theme-card-bg"
                    style={{
                      zIndex: 50,
                      minWidth: "240px",
                      maxWidth: "360px",
                      maxHeight: "320px",
                      boxShadow: "0 0 0 1px var(--color-border-default), 0 8px 24px rgba(0,0,0,0.4)",
                    }}
                  >
                    <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-widest theme-text-muted bs-b-muted">
                      Recent jumps · {recents.length}
                    </div>
                    {recents.map((r, i) => (
                      <button
                        key={`${r.timestamp}-${i}`}
                        onClick={() => {
                          applyHistoryEntry({ step: r.step, overrideLine: r.overrideLine });
                          setRecentsOpen(false);
                        }}
                        className={`w-full text-left px-3 py-2 text-xs flex items-center gap-inline transition-colors hover:opacity-90 theme-mono theme-text bs-b-muted${r.step === currentStep ? " theme-accent-bg" : ""}`}
                      >
                        <span className={r.kind === "function" ? "theme-accent" : "theme-text-secondary"}>
                          {r.kind === "function" ? (
                            "ƒ"
                          ) : (
                            <Icon icon="heroicons:chevron-right" className="w-3.5 h-3.5" aria-hidden />
                          )}
                        </span>
                        <span className="flex-1 truncate">{r.label}</span>
                        <span className="theme-text-muted">step {r.step.toLocaleString()}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          {contentView === "trace" && (
            <DecodedTrace
              steps={steps}
              currentStep={currentStep}
              signatureMap={signatureMap}
              sourceMappings={sourceMappings}
              callTrace={callTrace}
              contractNames={contractNames}
              onJumpTo={jumpToAndShowSource}
            />
          )}

          {navError && (
            <Tooltip label="Click to dismiss" className="w-full">
              <div
                role="alert"
                onClick={() => setNavError(null)}
                className="w-full text-xs px-2 py-1 cursor-pointer theme-danger theme-mono"
                style={{
                  backgroundColor: "rgba(248, 81, 73, 0.08)",
                  boxShadow: "0 1px 0 0 var(--color-danger)",
                }}
              >
                {navError}
              </div>
            </Tooltip>
          )}

          {contentView === "debugger" && (
            <SourceOpcodeSplit
              currentSourceFile={currentSourceFile}
              allFiles={sourceData?.files ?? []}
              effectiveLine={effectiveLine}
              highlightSpan={highlightSpan}
              scrollKey={scrollKey}
              slitherFindings={slitherFindings}
              sourceLoading={sourceLoading}
              activeContractAddress={activeContractAddress}
              executableLines={executableLines}
              onJumpToLine={jumpToLine}
              onIdentifierClick={jumpToDefinition}
              steps={steps}
              currentStep={currentStep}
              goTo={recordingNavigate}
              filteredIndices={filteredIndices}
              maxDepth={maxDepth}
              opcodeFreqs={opcodeFreqs}
              opcodeFilter={opcodeFilter}
              onToggleOpcode={toggleOpcode}
            />
          )}

          <OperandBar op={step.op} operands={operands} />
          <StoragePanel
            diffs={storageDiff}
            currentOp={step.op}
            loading={detailLoading}
            highlightSlot={operands?.storageSlot ?? null}
          />
          <StackPanel
            stack={currentDetail?.stack ?? []}
            changedIndices={stackChanges}
            inputIndices={inputIndices}
            loading={detailLoading}
          />
          <MemoryPanel
            memory={currentDetail?.memory ?? []}
            loading={detailLoading}
            highlight={operands?.memory ?? null}
          />
        </div>
      </div>

      <ShortcutsHelp />

      {expandedFrame && expandedRange && (
        <FrameOpcodesOverlay
          steps={steps}
          from={expandedRange.from}
          to={expandedRange.to}
          label={expandedFrame.label}
          frameType={expandedFrame.frame.type}
          currentStep={currentStep}
          onJumpTo={(s) => { recordingNavigate(s); setContentView("debugger"); setScrollKey((k) => k + 1); }}
          onClose={() => setExpandedFrame(null)}
        />
      )}
    </div>
  );
}
