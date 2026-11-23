/** Hex helpers for 32-byte storage words. All results are lowercase. */

const HEX = /^[0-9a-f]{1,64}$/;

/** "0x" + 64 hex characters, or null when `raw` is not a 32-byte word. */
export function normalizeWord(raw: string): string | null {
  const body = (raw.startsWith("0x") || raw.startsWith("0X") ? raw.slice(2) : raw).toLowerCase();
  return HEX.test(body) ? "0x" + body.padStart(64, "0") : null;
}

/** The storage key of a slot number. */
export function slotKey(slot: bigint): string {
  return "0x" + slot.toString(16).padStart(64, "0");
}

/**
 * Normalize the keys and the values of a struct-log storage map. Geth writes
 * keys without "0x"; other clients write the prefix. An entry that is not a
 * 32-byte word is dropped.
 */
export function normalizeStorage(raw: Readonly<Record<string, string>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    const key = normalizeWord(k);
    const value = typeof v === "string" ? normalizeWord(v) : null;
    if (key && value) out[key] = value;
  }
  return out;
}
