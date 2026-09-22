/**
 * The /families capture picks and the matrix row identity, both by family NAME (ruling,
 * msg-authority-family-identity). An element id is reissued on reload, and a UniqueId survives a
 * rename; the name is what the person sees, so a renamed family is the old row gone and a new row.
 */

type PickRow = { key: string; familyName: string };

/** A matrix row's key: one family type, by name (a JSON tuple, so no name collides). */
export const typeRowKey = (family: { familyName: string }, typeName: string) =>
  JSON.stringify([family.familyName, typeName]);

/** The rows the picks select: every type of a picked family. */
export const pickedRowKeys = (rows: readonly PickRow[], picked: ReadonlySet<string>) =>
  new Set(rows.filter((row) => picked.has(row.familyName)).map((row) => row.key));

/** Picking a type picks its family: the picks after the table's selection moved to `keys`. */
export function nextPicks(
  rows: readonly PickRow[],
  picked: ReadonlySet<string>,
  keys: ReadonlySet<string>,
): Set<string> {
  const selectedKeys = pickedRowKeys(rows, picked);
  const next = new Set(picked);
  const changed = new Set(
    rows
      .filter((row) => keys.has(row.key) !== selectedKeys.has(row.key))
      .map((row) => row.familyName),
  );
  for (const familyName of changed) {
    if (
      rows.some(
        (row) =>
          row.familyName === familyName &&
          keys.has(row.key) !== selectedKeys.has(row.key) &&
          keys.has(row.key),
      )
    )
      next.add(familyName);
    else next.delete(familyName);
  }
  return next;
}
