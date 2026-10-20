/**
 * The deterministic cut of a scene's subject. A subject is an ORDERED element-id list a person or
 * Pea authored; this folds it into legs between places, so prose and drawing can say "MAU-1 → Attic"
 * instead of eighty-eight ids. Nothing here is stored and nothing here is judged: ambiguity lives in
 * the subject and its claims, never in this builder (pressure-drop ledger, 2026-10-19).
 * - A node (equipment, accessory, terminal, cap) ends the leg and is a place.
 * - A level change between consecutive ducts (the snapshot's `levelId`, never z) ends the leg at
 *   a place of kind `level`, named for the level entered, id the first duct on it.
 * - A subject that starts or ends on a duct or fitting starts or ends at a place of kind `open`.
 * - Two consecutive ids that share no connector are a break, and the leg runs on through it. When
 *   the snapshot joins them through at most `OMISSION_HOPS` connections over elements outside the
 *   subject, the break is an `omission` carrying the skipped ids (the subject left them out).
 *   Else, when the tolerated graph (`tolerated`, Work's proximity verdicts honored, as the builder
 *   reads it) bridges it, the break is `inferred`, carrying the proximity finding: joined by
 *   proximity, a person rules on it. An inferred joint or tap bridges a break when it links the
 *   two sides, each side an element or one the snapshot joins it to (an end cap closing the host
 *   a duct lands on). Otherwise it is a `gap` (the model is not connected there). All are facts, not errors.
 * - Mark is not a concept here (the firm does not use it): a place is named by `labelOf(id)`, else
 *   `family type`, else `kind id`.
 */
import type { DuctClaim, DuctInferenceGrade } from "@pe/agent-contracts";

import type { DuctsRouteDocument } from "@pe/agent-contracts";
import { snapshotById } from "@pe/ducts-domain/readiness";
import { verdictOf } from "@pe/ducts-domain/proximity";
import { tolerated } from "@pe/ducts-domain/survey";
import type { DuctSnapshot } from "@pe/ducts-domain/types";

/** The proximity findings that join; a near miss across classifications joins nothing and stays a gap. */
const BRIDGES = new Set(["joined-by-proximity", "tap-by-proximity", "inline-by-inference"]);

type Node = DuctSnapshot["nodes"][number];
type Segment = DuctSnapshot["segments"][number];
type Element = Node | Segment;

/** A claim as the drawing reads it: a staged `DuctClaim` cell keyed by its id, its `ids` named `at`. */
export interface Claim {
  id: string;
  state: DuctClaim["state"];
  at: number[];
  text: string;
  verdict?: DuctClaim["verdict"];
  verdictBy?: string;
  verdictAt?: string;
}

/** The claims cells in key order, as the drawing reads them. */
export const claimsOf = (cells: Readonly<Record<string, DuctClaim>>): Claim[] =>
  Object.entries(cells).map(([id, { ids, ...rest }]) => ({ id, at: ids, ...rest }));

/** The authored half of a subject scene: the ordered ids and the claims over them. */
export interface Subject {
  ids: readonly number[];
  claims: readonly Claim[];
  /** A person's verdict on one claim; the route stages it. */
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
  /** `after` and `before` are two consecutive subject ids the snapshot does not connect. */
  gaps: { after: number; before: number }[];
  /** Consecutive ids the snapshot connects only through `skipped`, in path order, none in the subject. */
  omissions: { after: number; before: number; skipped: number[] }[];
  /** Consecutive ids only a proximity inference joins; `findingId` keys the verdict that rules on it. */
  /** Each with its finding's grade, and whether a person's staged connect confirmed it. */
  inferred: {
    after: number;
    before: number;
    findingId: string;
    grade: DuctInferenceGrade;
    confirmed: boolean;
  }[];
}

/** The longest chain of connections a break is searched across before it is called a gap. */
export const OMISSION_HOPS = 12;

const PLACE_KINDS = new Set<Node["kind"]>(["equipment", "accessory", "terminal", "cap"]);
const isNode = (element: Element): element is Node => "category" in element;

const reaches = (a: Element, b: Element) =>
  a.connectors.some((c) => c.connectedTo?.elementId === b.id) ||
  b.connectors.some((c) => c.connectedTo?.elementId === a.id);

/** Every element's connected neighbours, read from both ends of each connector. */
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

/** `legsOf`'s `labelOf` for a snapshot: the node's `label`, which `ducts.snapshot` fills from the staged labelParameter. */
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
    const typed = isNode(element) ? `${element.family ?? ""} ${element.type ?? ""}`.trim() : "";
    // A bare kind cannot tell two accessories apart, so the fallback carries the id.
    return {
      id: element.id,
      kind,
      name: label ?? (kind === "open" ? "open" : typed || `${kind} ${element.id}`),
    };
  };
  const levelPlace = (duct: Segment, levelId: number): Place => ({
    id: duct.id,
    kind: "level",
    name: labelOf(duct.id) ?? levelName.get(levelId) ?? `level ${levelId}`,
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
