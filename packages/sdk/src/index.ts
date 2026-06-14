// Canonical types
export type {
  AnalyzeRisksOptions,
  BalanceDelta,
  CallType,
  DecodedParam,
  GasProfile,
  GasProfileEntry,
  Log,
  OpcodeStep,
  RawCallFrame,
  RawCallType,
  RawLog,
  RawPrestateAccount,
  RawPrestateDiff,
  RawStructLog,
  RiskFlag,
  RiskFlagType,
  RiskSeverity,
  SourceLocation,
  StateDiff,
  StorageChange,
  Swap,
  SwapV2,
  SwapV3,
  TokenApproval,
  TokenDelta,
  TraceFrame,
  TraceResult,
} from "./types.js";

// Consumer-friendly type aliases.
// `CallNode` is the same shape as `TraceFrame` — exported under the name
// external consumers expect (per the SDK API contract).
export type { TraceFrame as CallNode } from "./types.js";

// Loaders
export {
  loadTraceFromObject,
  loadTraceFromFile,
  loadTraceFromHash,
  normalizeCallFrame,
  // Consumer-friendly alias for `normalizeCallFrame`. Same function, the
  // name the external API contract uses.
  normalizeCallFrame as parseCallTrace,
  normalizeStructLogs,
  type LoadObjectInput,
  type LoadHashOptions,
} from "./loaders/index.js";

// Traversal
export {
  walkCallTree,
  flattenCallTree,
  filterByAddress,
  filterBySelector,
  findRevertFrame,
  buildGasProfile,
  type WalkVisitor,
  type FlatFrame,
  type AddressMatchOptions,
} from "./traversal/index.js";

// Parsers
export {
  parseTokenDeltas,
  parsePrestateDiff,
  parseApprovals,
  parseSwaps,
  parseEvents,
  type MatchedEvent,
} from "./parsers/index.js";

// Storage decoding (pure — typed view of a single packed-slot variable)
export {
  decodeSlot,
  type DecodedValue,
  type DecodeSlotInput,
} from "./storage/index.js";

// Risks
export {
  analyzeRisks,
  BUILTIN_RULES,
  delegatecallUnrecognized,
  largeApproval,
  tokenSentToTokenContract,
  defineRule,
  getRuleById,
  BUILTIN_RULE_DEFS,
  RULE_DELEGATECALL_UNRECOGNIZED,
  RULE_LARGE_APPROVAL,
  RULE_TOKEN_SENT_TO_TOKEN_CONTRACT,
  type RiskRule,
  type Rule,
  type AnalyzableRule,
  type AnalyzeRisksOptionsWithRules,
} from "./risks/index.js";

// Components (React peer dep)
export {
  CallTree,
  GasFlamegraph,
  OpcodeViewer,
  FindingsPanel,
  StateDiffPanel,
  FrameDetailPanel,
  StepDebugger,
  SwapsPanel,
  ApprovalsPanel,
  SourceViewer,
  TokenDeltasPanel,
  buildFlamegraphLayout,
  adjustBrightness,
  getBarColor,
  classifyOpcode,
  getOpcodeColor,
  isExpensiveOp,
  OPCODE_CATEGORY_COLORS,
  truncateAddress,
  formatGas,
  formatWei,
  getFunctionSelector,
  type CallTreeProps,
  type CallTreeClassNames,
  type GasFlamegraphProps,
  type GasFlamegraphClassNames,
  type OpcodeViewerProps,
  type OpcodeViewerClassNames,
  type FindingsPanelProps,
  type FindingsPanelClassNames,
  type StateDiffPanelProps,
  type StateDiffPanelClassNames,
  type FrameDetailPanelProps,
  type FrameDetailPanelClassNames,
  type StepDebuggerProps,
  type StepDebuggerClassNames,
  type SwapsPanelProps,
  type SwapsPanelClassNames,
  type ApprovalsPanelProps,
  type ApprovalsPanelClassNames,
  type SourceViewerProps,
  type SourceViewerClassNames,
  type TokenDeltasPanelProps,
  type TokenDeltasPanelClassNames,
  type OpcodeCategory,
  type FlamegraphBar,
  type LayoutOptions,
} from "./components/index.js";

// Templates (composition of components — React peer dep)
export {
  CompactCallSummary,
  RevertExplainer,
  FullDebuggerLayout,
  type CompactCallSummaryProps,
  type CompactCallSummaryClassNames,
  type RevertExplainerProps,
  type RevertExplainerClassNames,
  type FullDebuggerLayoutProps,
  type FullDebuggerLayoutClassNames,
  type FullDebuggerTabId,
} from "./templates/index.js";

// Hooks (React peer dep)
export {
  useOpcodeNavigation,
  isCallOp,
  isStorageOp,
  isLogOp,
  type OpcodeNavigation,
  type UseOpcodeNavigationOptions,
} from "./hooks/index.js";

// Widgets (parser + panel embed primitives — React peer dep)
export {
  RisksWidget,
  SwapsWidget,
  ApprovalsWidget,
  TokenFlowsWidget,
  EmbedDashboard,
  type RisksWidgetProps,
  type SwapsWidgetProps,
  type ApprovalsWidgetProps,
  type TokenFlowsWidgetProps,
  type EmbedDashboardProps,
  type EmbedDashboardClassNames,
  type EmbedDashboardTab,
} from "./widgets/index.js";

// Icons (inline-SVG, dependency-free — React peer dep). These are the
// tree-shakable defaults behind every component's icon-override prop, exported
// here so consumers can import and reuse them directly. A consumer that never
// touches an icon (or overrides every one) never pulls these into their bundle.
export {
  ChevronRightIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  XIcon,
  type IconProps,
} from "./icons/index.js";
