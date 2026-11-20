/** Refuse a duplicate declaration before merging the source records. */
export function assertUniqueProductKeys(kind: string, definitions: readonly Readonly<Record<string, unknown>>[]) {
  const keys = new Set<string>();
  for (const definition of definitions) {
    for (const key of Object.keys(definition)) {
      if (keys.has(key)) throw Error(`Duplicate ${kind} declaration '${key}'`);
      keys.add(key);
    }
  }
}
