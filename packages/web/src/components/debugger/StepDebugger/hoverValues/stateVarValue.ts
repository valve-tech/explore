import { decodeSlot, type DecodedValue } from "@valve-tech/trace-sdk";
import type { SolIndex } from "../sourceNav/solIndex";
import { resolveStateVar, type ResolveStateVarInput, type StateVarRef } from "./resolveStateVar";
import { normalizeStorage, slotKey } from "./slotWord";
import type { HoverValue } from "./types";

export interface StateVarValueInput extends ResolveStateVarInput {
  /**
   * Slots of the frame's storage address that the transaction touched up to
   * the current step. Use `frameStorageAt(...).storage`. Null when unknown.
   */
  storage: Readonly<Record<string, string>> | null | undefined;
  /** `frameStorageAt(...).prevStorage`: the map before this step. */
  prevStorage?: Readonly<Record<string, string>> | null;
  /** `frameStorageAt(...).writtenSlot`: the slot an SSTORE at this step writes. */
  writtenSlot?: string | null;
}

/** Names of the members of the enum behind a solc label such as "enum Vault.State". */
function enumMembers(index: SolIndex | undefined, label: string): string[] | null {
  if (!index) return null;
  const path = label.slice("enum ".length).split(".");
  const name = path.pop()!;
  const owner = path.pop() ?? null;
  const all = [...index.contracts.flatMap((c) => c.members), ...index.free];
  const hits = all.filter((d) => d.kind === "enum" && d.name === name && d.owner === owner);
  if (hits.length !== 1) return null;
  const text = index.files.get(hits[0]!.file)?.text.slice(hits[0]!.start, hits[0]!.end) ?? "";
  const open = text.indexOf("{");
  const close = text.lastIndexOf("}");
  if (open === -1 || close < open) return null;
  const members = text.slice(open + 1, close).split(",").map((s) => s.trim());
  return members.every((m) => /^[A-Za-z_$][\w$]*$/.test(m)) ? members : null;
}

function format(v: DecodedValue, ref: StateVarRef, index?: SolIndex): string | null {
  switch (v.kind) {
    case "address": return v.address;
    case "bool": return v.value ? "true" : "false";
    case "int": return v.value.toString();
    case "bytes": return v.hex;
    case "uint": {
      if (!ref.typeLabel.startsWith("enum ")) return v.value.toString();
      const members = enumMembers(index, ref.typeLabel);
      const name = members && v.value < BigInt(members.length) ? members[Number(v.value)] : null;
      return name ? `${name} (${v.value})` : v.value.toString();
    }
    case "unsupported": return null;
  }
}

/** Decode and format the variable from one 32-byte slot word. Null when not sure. */
export function formatSlotValue(ref: StateVarRef, slotWord: string, index?: SolIndex): string | null {
  if (ref.kind !== "value") return null;
  const typeLabel = ref.typeLabel === "address payable" ? "address" : ref.typeLabel;
  const v = decodeSlot({ slotValue: slotWord, typeLabel, offset: ref.offset, numberOfBytes: ref.numberOfBytes });
  return format(v, ref, index);
}

/** The text for a variable this module does not read: its type and its base slot. */
export const describeOpaque = (ref: StateVarRef): string => `${ref.typeLabel} at slot ${ref.slot}`;

/**
 * The hover value of an already resolved state variable. Returns null when
 * the storage map does not hold the slot: the transaction did not touch it.
 */
export function stateVarHoverValue(
  ref: StateVarRef,
  storage: Readonly<Record<string, string>> | null | undefined,
  opts: { prevStorage?: Readonly<Record<string, string>> | null; writtenSlot?: string | null; index?: SolIndex } = {},
): HoverValue | null {
  const base = { name: ref.name, type: ref.typeLabel, source: "storage" as const };
  if (ref.kind === "opaque") return { ...base, value: describeOpaque(ref) };
  if (!storage) return null;
  const key = slotKey(ref.slot);
  const word = normalizeStorage(storage)[key];
  if (!word) return null;
  const value = formatSlotValue(ref, word, opts.index);
  if (value === null) return null;
  const prevWord = opts.prevStorage ? normalizeStorage(opts.prevStorage)[key] : undefined;
  if (prevWord && prevWord !== word) {
    const old = formatSlotValue(ref, prevWord, opts.index);
    // A write to the slot can leave this packed variable as it was.
    if (old === value) return { ...base, value };
    return { ...base, value, note: old === null ? "written at this step" : `written at this step: ${old} → ${value}` };
  }
  if (!prevWord && opts.prevStorage && opts.writtenSlot?.toLowerCase() === key) {
    return { ...base, value, note: "slot written at this step; the trace does not hold the old value" };
  }
  return { ...base, value };
}

/**
 * The value of the contract state variable under the pointer, at the current
 * step. Null when the word is not a state variable, when a parameter or a
 * local hides it, when the source and the layout do not agree, or when the
 * transaction has not touched the slot yet.
 */
export function stateVarValueAt(input: StateVarValueInput): HoverValue | null {
  const ref = resolveStateVar(input);
  if (!ref) return null;
  return stateVarHoverValue(ref, input.storage, {
    prevStorage: input.prevStorage, writtenSlot: input.writtenSlot, index: input.index,
  });
}
