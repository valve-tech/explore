export type HoverSource = "stack" | "storage" | "calldata" | "memory";
export interface HoverValue { name: string; type: string; value: string; source: HoverSource; note?: string; }
