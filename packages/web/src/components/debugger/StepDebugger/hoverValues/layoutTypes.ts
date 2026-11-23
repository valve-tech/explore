/**
 * The solc storage layout, as /api/source/:address/storage-layout returns it.
 * This is a superset of the shape in lib/storageDecode.ts: it keeps the
 * mapping key, the mapping value and the struct members.
 */
export interface LayoutEntry {
  label: string;
  /** Decimal string. For a struct member, relative to the struct's slot. */
  slot: string;
  offset: number;
  type: string;
  /**
   * "file:Contract" of the COMPILED contract. solc writes the same value on
   * every entry, also on inherited ones. It does not name the declaring base.
   */
  contract: string;
}

export interface LayoutType {
  /** "inplace" | "mapping" | "dynamic_array" | "bytes" */
  encoding: string;
  label: string;
  /** Decimal string. */
  numberOfBytes: string;
  key?: string;
  value?: string;
  base?: string;
  members?: LayoutEntry[];
}

export interface HoverStorageLayout {
  storage: LayoutEntry[];
  types: Record<string, LayoutType>;
}
