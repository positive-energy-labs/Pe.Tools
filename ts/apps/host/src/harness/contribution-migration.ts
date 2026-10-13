import { parseContributionKey, type ContributionKind } from "@pe/agent-contracts";

export type ContributionMigration = { oldKey: string; key: string; kind: ContributionKind };

/** A caller supplies the pre-cut mapping. No current folder lookup can reconstruct lost identity. */
export function migrateContributionEvents(
  journal: string,
  mapping: readonly ContributionMigration[],
) {
  const diagnostics: string[] = [];
  const byOld = new Map<string, ContributionMigration>();
  const byNew = new Map<string, string>();
  for (const entry of mapping) {
    const parsed = parseContributionKey(entry.key);
    if (!parsed || parsed.kind !== entry.kind || byOld.has(entry.oldKey) || byNew.has(entry.key))
      diagnostics.push(
        `Ambiguous or invalid contribution mapping: ${entry.oldKey} -> ${entry.key}`,
      );
    byOld.set(entry.oldKey, entry);
    byNew.set(entry.key, entry.oldKey);
  }
  for (const entry of mapping)
    if (entry.oldKey !== entry.key && byOld.has(entry.key))
      diagnostics.push(`Mapping would remap a canonical target on the next cut: ${entry.key}`);
  let changed = 0;
  const lines = journal.split("\n").map((line, index) => {
    if (!line.trim()) return line;
    try {
      const event = JSON.parse(line);
      if (event.kind !== "prompt" || !Array.isArray(event.mentions)) return line;
      let touched = false;
      for (const mention of event.mentions) {
        const entry = byOld.get(mention.key);
        if (!entry) {
          const canonical = parseContributionKey(mention.key);
          if (byNew.has(mention.key) || canonical?.packageId === "pages") continue;
          if (["pod", "script", "page", "skill", "member"].includes(mention.kind))
            diagnostics.push(`Missing pre-cut mapping at line ${index + 1}: ${mention.key}`);
          continue;
        }
        if (mention.key === entry.key && mention.kind === entry.kind) continue;
        mention.key = entry.key;
        mention.kind = entry.kind;
        touched = true;
        changed++;
      }
      return touched ? JSON.stringify(event) : line;
    } catch (error) {
      diagnostics.push(`Invalid thread journal at line ${index + 1}: ${String(error)}`);
      return line;
    }
  });
  return diagnostics.length
    ? { ok: false as const, journal, changed: 0, diagnostics }
    : { ok: true as const, journal: lines.join("\n"), changed, diagnostics };
}
