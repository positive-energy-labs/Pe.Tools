// wave-1 owns this file; stub for wave 2
/**
 * The subject cut into legs: the shapes wave 1 publishes (`Place`, `Leg`, `SubjectCut`, `Claim`)
 * and a naive `legsOf` so the drawing has something to draw. Wave 1's file replaces this whole
 * module; nothing here is polished on purpose.
 */
import { snapshotById, type DuctSnapshot } from "./readiness";

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
}
export interface Claim {
  id: string;
  text: string;
  at: number[];
  state: "proven" | "assumed" | "unproven";
  verdict?: "yes" | "no" | "not-this";
}

const PLACE_KINDS = new Set<Place["kind"]>(["equipment", "accessory", "terminal", "cap"]);
/** Two consecutive subject elements farther apart than this (nearest points) share no connector. */
const GAP_FT = 3;

const pointsOf = (snapshot: DuctSnapshot, id: number): number[][] => {
  const { nodes, segments } = snapshotById(snapshot);
  return segments.get(id)?.polyline ?? (nodes.get(id) ? [nodes.get(id)!.point] : []);
};
const nearest = (a: number[][], b: number[][]) =>
  Math.min(
    ...a.flatMap((p) => b.map((q) => Math.hypot(p[0]! - q[0]!, p[1]! - q[1]!, p[2]! - q[2]!))),
  );

/** Cut at equipment, accessories, terminals, caps and level changes; a gap where two consecutive ids do not touch. */
export const legsOf = (
  snapshot: DuctSnapshot,
  ids: readonly number[],
  labelOf: (id: number) => string | null = () => null,
): SubjectCut => {
  const { nodes, segments } = snapshotById(snapshot);
  const levelName = (levelId: number | null) =>
    snapshot.levels.find((level) => level.id === levelId)?.name ?? "no level";
  const levelOf = (id: number) => segments.get(id)?.levelId ?? nodes.get(id)?.levelId ?? null;
  const placeOf = (id: number): Place | null => {
    const node = nodes.get(id);
    if (!node || !PLACE_KINDS.has(node.kind as Place["kind"])) return null;
    const name = labelOf(id) ?? node.type ?? node.family ?? `${node.kind} ${id}`;
    return { id, name, kind: node.kind as Place["kind"] };
  };

  const legs: Leg[] = [];
  const places: Place[] = [];
  const gaps: SubjectCut["gaps"] = [];
  // The leg being built lives in a cell: the closures below write it, which control-flow
  // narrowing on a plain `let` cannot follow.
  const cell: { open: { from: Place; ids: number[]; levelId: number | null } | null } = {
    open: null,
  };
  const close = (to: Place) => {
    const open = cell.open;
    if (!open) return;
    const own = open.ids.map((id) => segments.get(id)).filter((s) => s !== undefined);
    const sizes = new Map<string, number>();
    for (const segment of own) sizes.set(segment.size, (sizes.get(segment.size) ?? 0) + 1);
    legs.push({
      ids: open.ids,
      from: open.from,
      to,
      levelId: open.levelId,
      name: `${open.from.name} → ${to.name}`,
      lengthFt: Math.round(own.reduce((sum, s) => sum + s.lengthFt, 0) * 10) / 10,
      fittings: open.ids.filter((id) => nodes.get(id)?.kind === "fitting").length,
      size: [...sizes].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
    });
    cell.open = null;
  };
  const start = (from: Place, levelId: number | null) => {
    cell.open = { from, ids: [], levelId };
    return cell.open;
  };

  ids.forEach((id, i) => {
    const previous = i ? ids[i - 1]! : null;
    const level = levelOf(id);
    if (
      previous !== null &&
      nearest(pointsOf(snapshot, previous), pointsOf(snapshot, id)) > GAP_FT
    ) {
      gaps.push({ after: previous, before: id });
      const at: Place = { id: previous, name: "gap", kind: "open" };
      close(at);
      places.push(at);
    }
    if (cell.open && cell.open.levelId !== level) {
      const crossing: Place = { id, name: levelName(level), kind: "level" };
      close(crossing);
      places.push(crossing);
      start(crossing, level);
    }
    const place = placeOf(id);
    if (place) {
      close(place);
      places.push(place);
      start(place, level);
      return;
    }
    const current =
      cell.open ??
      (() => {
        const opening: Place = { id, name: `open at ${levelName(level)}`, kind: "open" };
        places.push(opening);
        return start(opening, level);
      })();
    current.ids.push(id);
  });
  const last = ids.at(-1);
  if (cell.open && last !== undefined && cell.open.ids.length) {
    const end: Place = { id: last, name: "open end", kind: "open" };
    places.push(end);
    close(end);
  }
  return { legs: legs.filter((leg) => leg.ids.length), nodes: places, gaps };
};
