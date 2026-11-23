import { RELATIONS, type AddressRelation } from "../../../lib/addressRelations";

interface HasRelations {
  relations?: AddressRelation[];
}

/** How many rows on the page carry each kind. A row counts once per kind. */
export function countRelations(rows: readonly HasRelations[]): Record<AddressRelation, number> {
  const counts = Object.fromEntries(RELATIONS.map((r) => [r.kind, 0])) as Record<
    AddressRelation,
    number
  >;
  for (const row of rows) for (const kind of row.relations ?? []) counts[kind] += 1;
  return counts;
}

/**
 * The rows a reader keeps when they switch some kinds off. A row stays while
 * at least one of its kinds is still on. A row with no known kinds (an old
 * cached response, or a receipt the server could not read) always stays —
 * hiding it would claim a fact we do not have.
 */
export function filterByRelations<T extends HasRelations>(
  rows: readonly T[],
  hidden: ReadonlySet<AddressRelation>,
): T[] {
  if (hidden.size === 0) return [...rows];
  return rows.filter((row) => {
    const kinds = row.relations ?? [];
    return kinds.length === 0 || kinds.some((k) => !hidden.has(k));
  });
}
