/**
 * proto: encoding — which way the air runs in each segment of a group, for the flow encoding's
 * arrows. The walk is `groupTree`'s breadth-first walk from the fan's port: a segment's upstream end
 * is the connector that touches its parent in the walk (the root element's, the equipment). Supply
 * air runs with the walk, return and exhaust against it. A segment the walk never reached from the
 * port, or one whose system names neither, has no direction: absent from the map, never guessed.
 */
import { groupTree } from "@pe/ducts-domain/topology";
import type { DuctSnapshot } from "@pe/ducts-domain/types";

const sense = (classification: string | null | undefined): 1 | -1 | null => {
  const c = (classification ?? "").toLowerCase();
  if (c.includes("supply")) return 1;
  if (c.includes("return") || c.includes("exhaust")) return -1;
  return null;
};

const dist2 = (a: readonly number[], b: readonly number[]) =>
  (a[0]! - b[0]!) ** 2 + (a[1]! - b[1]!) ** 2 + (a[2]! - b[2]!) ** 2;

/** Segment id → +1 when air runs from `polyline[0]` to its last point, -1 against. */
export function flowDirections(snapshot: DuctSnapshot, groupId: string): Map<number, 1 | -1> {
  const out = new Map<number, 1 | -1>();
  if (!groupId) return out;
  const tree = groupTree(snapshot, groupId);
  if (!tree.root) return out;
  const reached = new Set<number>();
  const stack = [tree.root.element];
  while (stack.length) {
    const id = stack.pop()!;
    reached.add(id);
    stack.push(...(tree.children.get(id) ?? []));
  }
  for (const id of reached) {
    const segment = tree.parts.get(id)?.segment;
    if (!segment || segment.polyline.length < 2) continue;
    const s = sense(segment.classification);
    if (s == null) continue;
    const up = tree.parent.get(id) ?? tree.root.equipment;
    const port = segment.connectors.find((c) => c.connectedTo?.elementId === up);
    if (!port) continue;
    const firstIsUp =
      dist2(port.point, segment.polyline[0]!) <= dist2(port.point, segment.polyline.at(-1)!);
    out.set(id, ((firstIsUp ? 1 : -1) * s) as 1 | -1);
  }
  return out;
}
