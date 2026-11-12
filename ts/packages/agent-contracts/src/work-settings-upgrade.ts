import { z } from "zod";

// ADR 0039 normally discards changed Work. The h6 ruling preserves pre-h2 cells while
// settings move out of Work; no other old version or invalid remaining cell is accepted.
export function upgradeSettingsWork(raw: unknown, previous: number, removed: readonly string[], emptyOnly: readonly string[] = []) {
  const record = z.record(z.string(), z.unknown());
  const saved = record.safeParse(raw);
  if (!saved.success || saved.data.schemaVersion !== previous) return null;
  const doc = record.safeParse(saved.data.doc);
  if (!doc.success) return null;
  const strip = (value: unknown) => {
    const parsed = record.safeParse(value);
    if (!parsed.success) return value;
    return Object.fromEntries(Object.entries(parsed.data).filter(([key, cell]) => {
      if (removed.includes(key)) return false;
      const old = record.safeParse(cell);
      return !(emptyOnly.includes(key) && old.success && Object.keys(old.data).length === 0);
    }));
  };
  const history = Array.isArray(saved.data.history) ? saved.data.history.map(entry => {
    const parsed = record.safeParse(entry);
    return parsed.success ? { ...parsed.data, after: strip(parsed.data.after) } : entry;
  }) : saved.data.history;
  const hasEdit = (cell: unknown): boolean => cell != null &&
    (typeof cell !== "object" || ("edit" in cell ? cell.edit != null : Object.values(cell).some(hasEdit)));
  const dropped = removed.filter(key => hasEdit(doc.data[key]))
    .map(key => `Dropped ${key}: ${JSON.stringify(doc.data[key])}.`);
  return {
    value: { ...saved.data, schemaVersion: previous + 1, doc: strip(doc.data), history },
    reason: dropped.length ? `${dropped.join(" ")} These values are now settings at the project or firm tier; set them there explicitly.` : undefined,
  };
}
