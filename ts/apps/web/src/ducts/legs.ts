/**
 * The deterministic cut of a scene's subject. A subject is an ORDERED element-id list a person or
 * Pea authored; this folds it into legs between places, so prose and drawing can say "MAU-1 → Attic"
 * instead of eighty-eight ids. Nothing here is stored and nothing here is judged: ambiguity lives in
 * the subject and its claims, never in this builder (pressure-drop ledger, 2026-10-19).
 * - A node (equipment, accessory, terminal, cap) ends the leg and is a place.
 * - A level change between consecutive ducts (the snapshot's `levelId`, never z) ends the leg at
 *   a place of kind `level`, named for the level entered, id the first duct on it.
 * - A subject that starts or ends on a duct or fitting starts or ends at a place of kind `open`.
 * - Two consecutive ids that share no connector are a `gap`: a fact about the subject, not an error.
 *   The leg runs on through it.
 * - Mark is not a concept here (the firm does not use it): a place is named by `labelOf(id)`, else
 *   `family type`, else `kind id`.
 */
import { snapshotById, type DuctSnapshot } from "./readiness";

type Node = DuctSnapshot["nodes"][number];
type Segment = DuctSnapshot["segments"][number];
type Element = Node | Segment;

export interface Place {
  id: number;
  name: string;
  kind: "equipment" | "accessory" | "terminal" | "cap" | "open" | "level";
}

export interface Leg {
  /** The elements between `from` and `to`, in subject order; the places themselves are not members. */
  ids: number[];
  from: Place;
  to: Place;
  /** The level of the leg's ducts; null when it has none. */
  levelId: number | null;
  /** `${from.name} → ${to.name}` */
  name: string;
  /** Straight duct only; fittings are counted, not priced. */
  lengthFt: number;
  fittings: number;
  /** The duct size covering the most length in the leg; null with no duct. */
  size: string | null;
}

export interface SubjectCut {
  legs: Leg[];
  /** The element places and open ends, in subject order; level crossings are leg boundaries only. */
  nodes: Place[];
  /** `after` and `before` are the two consecutive subject ids that share no connector. */
  gaps: { after: number; before: number }[];
}

const PLACE_KINDS = new Set<Node["kind"]>(["equipment", "accessory", "terminal", "cap"]);
const isNode = (element: Element): element is Node => "category" in element;

const reaches = (a: Element, b: Element) =>
  a.connectors.some((c) => c.connectedTo?.elementId === b.id) ||
  b.connectors.some((c) => c.connectedTo?.elementId === a.id);

export function legsOf(
  snapshot: DuctSnapshot,
  ids: readonly number[],
  labelOf: (id: number) => string | null = () => null,
): SubjectCut {
  const { nodes: nodeById, segments: segmentById } = snapshotById(snapshot);
  const levelName = new Map(snapshot.levels.map((level) => [level.id, level.name]));
  const elementOf = (id: number): Element => {
    const element = nodeById.get(id) ?? segmentById.get(id);
    if (!element) throw new Error(`legsOf: subject id ${id} is not in the snapshot`);
    return element;
  };
  const place = (element: Element, kind: Place["kind"]): Place => {
    const label = labelOf(element.id);
    const typed = isNode(element) ? `${element.family ?? ""} ${element.type ?? ""}`.trim() : "";
    // A bare kind cannot tell two accessories apart, so the fallback carries the id.
    return { id: element.id, kind, name: label ?? (kind === "open" ? "open" : typed || `${kind} ${element.id}`) };
  };
  const levelPlace = (duct: Segment, levelId: number): Place => ({
    id: duct.id,
    kind: "level",
    name: labelOf(duct.id) ?? levelName.get(levelId) ?? `level ${levelId}`,
  });

  const legs: Leg[] = [];
  const nodes: Place[] = [];
  const gaps: SubjectCut["gaps"] = [];
  let from: Place | null = null;
  let members: Element[] = [];
  let legLevel: number | null = null;

  const close = (to: Place) => {
    const ducts = members.filter((m): m is Segment => !isNode(m));
    const byLength = new Map<string, number>();
    for (const duct of ducts)
      byLength.set(duct.size, (byLength.get(duct.size) ?? 0) + duct.lengthFt);
    const size = [...byLength.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    legs.push({
      ids: members.map((m) => m.id),
      from: from!,
      to,
      levelId: legLevel,
      name: `${from!.name} → ${to.name}`,
      lengthFt: ducts.reduce((sum, duct) => sum + duct.lengthFt, 0),
      fittings: members.filter((m) => isNode(m) && m.kind === "fitting").length,
      size,
    });
    from = to;
    members = [];
    legLevel = null;
  };

  const elements = ids.map(elementOf);
  elements.forEach((element, i) => {
    const next = elements[i + 1];
    if (next && !reaches(element, next)) gaps.push({ after: element.id, before: next.id });

    if (isNode(element) && PLACE_KINDS.has(element.kind)) {
      const here = place(element, element.kind as Place["kind"]);
      if (from) close(here);
      else from = here;
      nodes.push(here);
      return;
    }
    if (!from) {
      from = place(element, "open");
      nodes.push(from);
    }
    if (!isNode(element) && element.levelId != null) {
      if (legLevel != null && element.levelId !== legLevel)
        close(levelPlace(element, element.levelId));
      legLevel = element.levelId;
    }
    members.push(element);
  });

  const last = elements.at(-1);
  if (last && members.length) {
    const end = place(last, "open");
    close(end);
    nodes.push(end);
  }
  return { legs, nodes, gaps };
}
