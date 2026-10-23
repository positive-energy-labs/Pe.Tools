/**
 * What the all-systems filter reads per system: its name, classification and unit tags (the row's
 * own words), the label of each unit and terminal, and the id of every element in its groups, so a
 * pasted element id narrows the list to the systems that hold it. Built once per snapshot.
 */
import type { DuctSnapshot } from "./types.ts";

export interface SystemSearch {
  text: string[];
  ids: number[];
}

export function systemSearch(snapshot: DuctSnapshot): Map<string, SystemSearch> {
  const byGroup = new Map(snapshot.groups.map((g) => [g.id, g]));
  const out = new Map<string, SystemSearch>();
  const of = (name: string) => out.get(name) ?? out.set(name, { text: [name], ids: [] }).get(name)!;
  for (const g of snapshot.groups)
    for (const name of g.systemNames) {
      const entry = of(name);
      entry.ids.push(...g.rootIds);
    }
  const add = (e: { id: number; groupId?: string | null; label?: string | null }, tag: boolean) => {
    const g = e.groupId ? byGroup.get(e.groupId) : undefined;
    for (const name of g?.systemNames ?? []) {
      const entry = of(name);
      entry.ids.push(e.id);
      if (tag && e.label) entry.text.push(e.label);
    }
  };
  for (const n of snapshot.nodes) add(n, n.kind === "equipment" || n.kind === "terminal");
  for (const s of snapshot.segments) add(s, false);
  for (const sys of snapshot.systems ?? []) of(sys.name).text.push(sys.classification ?? "");
  return out;
}
