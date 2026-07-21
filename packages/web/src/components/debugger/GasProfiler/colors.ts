const CATEGORY_COLORS: Record<string, string> = {
  Storage: "#f97316",
  "External Calls": "#ef4444",
  Memory: "#22c55e",
  Compute: "#8B5CF6",
  Hashing: "#06b6d4",
  Stack: "#6366f1",
  Logging: "#eab308",
  "Control Flow": "#64748b",
  Environment: "#ec4899",
};

const CALL_TYPE_COLORS: Record<string, string> = {
  CALL: "#8B5CF6",
  STATICCALL: "#38bdf8",
  DELEGATECALL: "#fbbf24",
  CREATE: "#3fb950",
  CREATE2: "#3fb950",
  CALLCODE: "#fb923c",
};

export function getCategoryColor(cat: string): string {
  return CATEGORY_COLORS[cat] ?? "#8b949e";
}

export function getCallTypeColor(type: string): string {
  return CALL_TYPE_COLORS[type] ?? "#8b949e";
}

export function formatGas(val: number): string {
  return val.toLocaleString();
}
