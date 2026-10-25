import type { Neighbour } from "@pe/ducts-domain/neighbours";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import type { Label } from "./annotations";

/** One system name per connecting unit, anchored on that system's own stub geometry. */
export function stubLabels(
  snapshot: DuctSnapshot,
  neighbours: readonly Neighbour[],
  opened: ReadonlySet<number>,
): Label[] {
  const elements = new Map([...snapshot.nodes, ...snapshot.segments].map((e) => [e.id, e]));
  const labels = new Map<string, Label>();
  for (const neighbour of neighbours)
    for (const id of neighbour.stub) {
      const element = elements.get(id);
      if (opened.has(id) || !element?.systemName) continue;
      const key = `stub:${neighbour.unit}:${element.systemName}`;
      const before = labels.get(key);
      if (before) {
        if (!before.ids.includes(id)) labels.set(key, { ...before, ids: [...before.ids, id] });
        continue;
      }
      const cut = neighbour.cuts.find((cut) => cut.id === id);
      const line = cut ? [cut.from, cut.at] : "polyline" in element ? element.polyline : null;
      const at = line
        ? line.length === 2
          ? line[0]!.map((v, i) => (v + line[1]![i]!) / 2)
          : line[Math.floor(line.length / 2)]
        : "point" in element
          ? element.point
          : null;
      if (at)
        labels.set(key, {
          key,
          at,
          text: element.systemName,
          ids: [id],
          priced: false,
          stub: true,
        });
    }
  return [...labels.values()];
}
