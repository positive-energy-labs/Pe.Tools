/** Ordered subject cuts. Snapshot connectivity owns omissions; tolerated connectivity owns inferences. */
import type { DuctClaim, DuctInferenceGrade, DuctsRouteDocument } from "@pe/agent-contracts";
import { subjectName } from "@pe/ducts-domain/words";
import { snapshotById } from "@pe/ducts-domain/readiness";
import { verdictOf } from "@pe/ducts-domain/proximity";
import { tolerated } from "@pe/ducts-domain/survey";
import type { DuctSnapshot } from "@pe/ducts-domain/types";

const BRIDGES = new Set(["joined-by-proximity", "tap-by-proximity", "inline-by-inference"]);

type Node = DuctSnapshot["nodes"][number];
type Segment = DuctSnapshot["segments"][number];
type Element = Node | Segment;

export type Claim = Omit<DuctClaim, "ids"> & { id: string; at: number[] };

export const claimsOf = (cells: Readonly<Record<string, DuctClaim>>): Claim[] =>
  Object.entries(cells).map(([id, { ids, ...rest }]) => ({ id, at: ids, ...rest }));

export interface Subject {
  ids: readonly number[];
  claims: readonly Claim[];
  onVerdict: (claim: Claim, verdict: NonNullable<Claim["verdict"]>) => void;
  /** The Work whose staged ignore verdicts the cut's proximity inferences honor; null honors none. */
  work?: DuctsRouteDocument | null;
}

export interface Place {
  id: number;
  name: string;
  kind: "equipment" | "accessory" | "terminal" | "cap" | "open" | "level";
}

export interface Leg {
  ids: number[];
  from: Place;
  to: Place;
  levelId: number | null;
  name: string;
  lengthFt: number;
  fittings: number;
  size: string | null;
}

export interface SubjectCut {
  legs: Leg[];
  nodes: Place[];
  gaps: { after: number; before: number }[];
  omissions: { after: number; before: number; skipped: number[] }[];
  /** Consecutive ids only a proximity inference joins; `findingId` keys the verdict that rules on it. */
  inferred: {
    after: number;
    before: number;
    findingId: string;
    grade: DuctInferenceGrade;
    confirmed: boolean;
  }[];
}

const OMISSION_HOPS = 12;

const PLACE_KINDS = new Set<Node["kind"]>(["equipment", "accessory", "terminal", "cap"]);
const isNode = (element: Element): element is Node => "category" in element;

const reaches = (a: Element, b: Element) =>
  a.connectors.some((c) => c.connectedTo?.elementId === b.id) ||
  b.connectors.some((c) => c.connectedTo?.elementId === a.id);

function neighboursOf(snapshot: DuctSnapshot): Map<number, Set<number>> {
  const out = new Map<number, Set<number>>();
  const link = (a: number, b: number) => {
    if (!out.has(a)) out.set(a, new Set());
    out.get(a)!.add(b);
  };
  for (const element of [...snapshot.nodes, ...snapshot.segments])
    for (const connector of element.connectors) {
      const to = connector.connectedTo?.elementId;
      if (to == null || to === element.id) continue;
      link(element.id, to);
      link(to, element.id);
    }
  return out;
}

/**
 * The elements strictly between `from` and `to` on the shortest connected path that crosses no
 * `subject` element, within `OMISSION_HOPS` connections; null when there is none.
 */
function skippedBetween(
  neighbours: ReadonlyMap<number, ReadonlySet<number>>,
  from: number,
  to: number,
  subject: ReadonlySet<number>,
): number[] | null {
  const parent = new Map<number, number>([[from, from]]);
  let frontier = [from];
  for (let hop = 0; hop < OMISSION_HOPS && frontier.length; hop++) {
    const next: number[] = [];
    for (const id of frontier)
      for (const n of neighbours.get(id) ?? []) {
        if (parent.has(n) || (n !== to && subject.has(n))) continue;
        parent.set(n, id);
        if (n === to) {
          const path: number[] = [];
          for (let at = parent.get(to)!; at !== from; at = parent.get(at)!) path.unshift(at);
          return path;
        }
        next.push(n);
      }
    frontier = next;
  }
  return null;
}

export const labelOfNode = (snapshot: DuctSnapshot) => {
  const { nodes } = snapshotById(snapshot);
  return (id: number) => nodes.get(id)?.label ?? null;
};

export function legsOf(
  snapshot: DuctSnapshot,
  ids: readonly number[],
  labelOf: (id: number) => string | null = () => null,
  work: DuctsRouteDocument | null = null,
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
    // A Revit-internal family name (`Damper_Volume_Round`) is not a person's word; its type is.
    const typed = isNode(element)
      ? `${element.family?.includes("_") && element.type ? "" : (element.family ?? "")} ${element.type ?? ""}`.trim()
      : "";
    return {
      id: element.id,
      kind,
      name: subjectName(kind, label || typed),
    };
  };
  const levelPlace = (duct: Segment, levelId: number): Place => ({
    id: duct.id,
    kind: "level",
    name: subjectName("level", labelOf(duct.id) ?? levelName.get(levelId)),
  });

  const legs: Leg[] = [];
  const nodes: Place[] = [];
  const gaps: SubjectCut["gaps"] = [];
  const omissions: SubjectCut["omissions"] = [];
  const inferred: SubjectCut["inferred"] = [];
  const subject = new Set(ids);
  let neighbours: Map<number, Set<number>> | null = null;
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

  const side = (id: number) => new Set([id, ...(neighbours!.get(id) ?? [])]);
  const bridgeOf = (after: number, before: number) => {
    const [a, b] = [side(after), side(before)];
    return tolerated(snapshot, work).findings.find(
      ({ kind, elementIds: [x, y] }) =>
        BRIDGES.has(kind) && ((a.has(x!) && b.has(y!)) || (a.has(y!) && b.has(x!))),
    );
  };

  const elements = ids.map(elementOf);
  elements.forEach((element, i) => {
    const next = elements[i + 1];
    if (next && !reaches(element, next)) {
      neighbours ??= neighboursOf(snapshot);
      const skipped = skippedBetween(neighbours, element.id, next.id, subject);
      const finding = skipped?.length ? undefined : bridgeOf(element.id, next.id);
      if (skipped?.length) omissions.push({ after: element.id, before: next.id, skipped });
      else if (finding)
        inferred.push({
          after: element.id,
          before: next.id,
          findingId: finding.id,
          grade: finding.grade ?? "stretched",
          confirmed: verdictOf(work, finding.id) === "connect",
        });
      else gaps.push({ after: element.id, before: next.id });
    }

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
  return { legs, nodes, gaps, omissions, inferred };
}
