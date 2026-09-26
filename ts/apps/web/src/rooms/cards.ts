/**
 * Feedback cards, pure: a mark's glyph is derived from its two persisted rungs plus the newest
 * partition run on its view, never stored; `cardsMarkdown` is what a person pastes to Claude and
 * what the chat send carries. Drafts are client-local and never reach here.
 */
import type { Mark, RoomsRouteDocument } from "@pe/agent-contracts";
import type { RoomsSnapshot } from "@pe/host-contracts/generated";

type Snapshot = RoomsSnapshot.Res.Response;
type Region = RoomsSnapshot.Res.RoomsRegion;
type Loop = readonly (readonly number[])[];
type Point = readonly [number, number];
export type MarkCell = RoomsRouteDocument["marks"][string];
export type MarkState = "proposed" | "accepted" | "pass" | "fail" | "stale" | "gone";
/** A card's state: a mark's derived glyph, or a note, which has no rungs. */
export type CardState = MarkState | "note";

/** Inbox order: what wants a person first; passing last among marks; notes after every mark. */
export const CARD_STATES = [
  "proposed",
  "fail",
  "stale",
  "gone",
  "accepted",
  "pass",
  "note",
] as const satisfies readonly CardState[];
const STATE_ORDER: readonly CardState[] = CARD_STATES;

/** Each state's glyph, its tone (null = plain ink) and what it means, then its next move. */
export const CARD_META: Record<
  CardState,
  { glyph: string; tone: "pea" | "done" | "alarm" | "caution" | null; says: string }
> = {
  proposed: {
    glyph: "◆",
    tone: "pea",
    says: "proposed · Pea's mark, not staged. Next: accept stages it, reject drops it.",
  },
  accepted: {
    glyph: "●",
    tone: null,
    says: "accepted · staged against the newest run. Next: a rerun honours it or not.",
  },
  pass: { glyph: "✓", tone: "done", says: "passing · the newest run honours it. Nothing to do." },
  fail: {
    glyph: "✗",
    tone: "alarm",
    says: "failing · the newest run does not honour it. Next: redraw it or delete it.",
  },
  stale: {
    glyph: "◐",
    tone: "caution",
    says: "stale · the region under it changed shape. Next: redraw it or delete it.",
  },
  gone: {
    glyph: "⊘",
    tone: null,
    says: "gone · no region of the newest run lies under it. Next: delete it.",
  },
  note: {
    glyph: "✎",
    tone: null,
    says: "note · text on a place, never staged. Next: delete it once read.",
  },
};
/** The run id Revit stamps on hand-drawn regions: never a partition run. */
const DRAWN = "drawn";

/**
 * The newest partition run on a view. The snapshot carries no run order and run ids are random, so
 * this reads provenance: a rerun restamps every machine region it keeps or creates, while locked
 * regions keep their old id, so the newest run is the id most rooms and held regions carry.
 */
export function newestRun(snapshot: Snapshot, view: string): string | null {
  const counts = new Map<string, number>();
  for (const region of snapshot.regions)
    if (region.view === view && region.role !== "zone" && region.runId !== DRAWN)
      counts.set(region.runId, (counts.get(region.runId) ?? 0) + 1);
  let best: [string, number] | null = null;
  for (const entry of counts)
    if (!best || entry[1] > best[1] || (entry[1] === best[1] && entry[0] < best[0])) best = entry;
  return best?.[0] ?? null;
}

export const inLoop = (x: number, y: number, loop: Loop) => {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const [xi = 0, yi = 0] = loop[i]!;
    const [xj = 0, yj = 0] = loop[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
export const shoelace = (loop: Loop) =>
  Math.abs(
    loop.reduce((sum, [x = 0, y = 0], i) => {
      const [nx = 0, ny = 0] = loop[(i + 1) % loop.length]!;
      return sum + x * ny - nx * y;
    }, 0),
  ) / 2;
const box = (loop: Loop) => {
  const xs = loop.map((p) => p[0] ?? 0);
  const ys = loop.map((p) => p[1] ?? 0);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] as const;
};

// ponytail: sampled IoU, exact clipping if a mark ever needs sub-foot accuracy
/** Intersection over union of a polygon and a region (outer minus holes), sampled on a grid. */
export function iou(polygon: Loop, region: Pick<Region, "outer" | "holes">): number {
  const a = box(polygon);
  const b = box(region.outer);
  if (a[2] < b[0] || b[2] < a[0] || a[3] < b[1] || b[3] < a[1]) return 0;
  const step = Math.max(0.25, Math.sqrt(shoelace(polygon)) / 60);
  let inA = 0;
  let inB = 0;
  let both = 0;
  for (let x = Math.min(a[0], b[0]) + step / 2; x < Math.max(a[2], b[2]); x += step)
    for (let y = Math.min(a[1], b[1]) + step / 2; y < Math.max(a[3], b[3]); y += step) {
      const pa = inLoop(x, y, polygon);
      const pb = inLoop(x, y, region.outer) && !region.holes.some((hole) => inLoop(x, y, hole));
      inA += +pa;
      inB += +pb;
      both += +(pa && pb);
    }
  const union = inA + inB - both;
  return union ? both / union : 0;
}

/** A mark's glyph: its rungs, then its anchor's overlap with the newest run on its view. */
export function markState(cell: MarkCell, snapshot: Snapshot): MarkState {
  const mark = cell.staged?.value;
  if (!mark) return "proposed";
  const newest = newestRun(snapshot, mark.anchor.view);
  if (newest === null || newest === mark.run) return "accepted";
  let best: { region: Region; score: number } | null = null;
  for (const region of snapshot.regions) {
    if (region.view !== mark.anchor.view || region.role === "zone") continue;
    const score = iou(mark.anchor.polygon, region);
    if (!best || score > best.score) best = { region, score };
  }
  if (!best || best.score < 0.2) return "gone";
  if (best.score < 0.6) return "stale";
  switch (mark.kind) {
    case "merge":
      return best.region.role === "room" ? "pass" : "fail";
    case "reject":
      return best.region.role === "held" && best.region.reason === "rejected" ? "pass" : "fail";
    // ponytail: wall and split fail until their ops exist; nothing can honour them yet.
    case "wall":
    case "split":
      return "fail";
  }
}

const ft = (n: number) => n.toFixed(1);
// ponytail: vertex mean, not the area centroid; it points a reader, it is not geometry.
const centroid = (polygon: Loop) => {
  const mean = (axis: 0 | 1) => polygon.reduce((s, p) => s + (p[axis] ?? 0), 0) / polygon.length;
  return `(${ft(mean(0))}, ${ft(mean(1))})`;
};
const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The Work's marks and notes as markdown: one section per view, deterministic order. */
export function cardsMarkdown(doc: RoomsRouteDocument, snapshot: Snapshot): string {
  const regions = new Map(snapshot.regions.map((region) => [region.guid, region]));
  const label = (guid: string) => {
    const region = regions.get(guid);
    if (!region) return null;
    const name = region.name || guid.slice(0, 8);
    if (region.role !== "held") return name;
    return `${name} (held${region.reason ? `: ${region.reason}` : ""})`;
  };
  const lines: { view: string; rank: number; id: string; text: string }[] = [];
  for (const [id, cell] of Object.entries(doc.marks)) {
    const mark: Mark | undefined = cell.staged?.value ?? cell.proposal?.value;
    if (!mark) continue;
    const state = markState(cell, snapshot);
    const labels = (mark.guids ?? []).map(label).filter((name) => name !== null);
    const parts = [
      `${CARD_META[state].glyph} ${state}`,
      `${mark.kind} ${id}`,
      `${mark.anchor.level} at ${centroid(mark.anchor.polygon)} ft`,
      `${shoelace(mark.anchor.polygon).toFixed(0)} sf`,
      ...(labels.length ? [`regions: ${labels.join(", ")}`] : []),
      `run ${mark.run}`,
      ...(mark.note ? [JSON.stringify(mark.note)] : []),
    ];
    const rank = STATE_ORDER.indexOf(state);
    lines.push({ view: mark.anchor.view, rank, id, text: parts.join(" · ") });
  }
  for (const [id, note] of Object.entries(doc.notes)) {
    const parts = [
      `✎ note ${id}`,
      `${note.anchor.level} at ${centroid(note.anchor.polygon)} ft`,
      `by ${note.by} ${note.at}`,
      JSON.stringify(note.text),
    ];
    lines.push({ view: note.anchor.view, rank: STATE_ORDER.length, id, text: parts.join(" · ") });
  }
  if (!lines.length) return "# Rooms feedback\n\nNo marks or notes.\n";
  const views = [...new Set(lines.map((line) => line.view))].sort(byText);
  const sections = views.map((view) => {
    const body = lines
      .filter((line) => line.view === view)
      .sort((a, b) => a.rank - b.rank || byText(a.id, b.id))
      .map((line) => `- ${line.text}`);
    return [`## ${view} · newest run ${newestRun(snapshot, view) ?? "none"}`, "", ...body].join(
      "\n",
    );
  });
  return ["# Rooms feedback", ...sections].join("\n\n") + "\n";
}

/** One inbox card: a mark or a note on one view. Its state is derived on read, never stored. */
export interface Card {
  id: string;
  state: CardState;
  /** Pea (a mark with a proposal rung, a note by Pea) or a person. */
  by: "pea" | "person";
  kind: Mark["kind"] | "note";
  polygon: Loop;
  /** The regions it concerns: the mark's guids, else the regions under its first point. */
  guids: string[];
  sqft: number;
  text: string;
  cell?: MarkCell;
}

/** The inbox for one view: its marks and notes in `CARD_STATES` order, then by id. */
export function inboxCards(doc: RoomsRouteDocument, snapshot: Snapshot, view: string): Card[] {
  const regions = snapshot.regions.filter((r) => r.view === view && r.role !== "zone");
  const under = ([x = 0, y = 0]: readonly number[]) =>
    regions.filter((r) => inLoop(x, y, r.outer)).map((r) => r.guid);
  const cards: Card[] = [];
  for (const [id, cell] of Object.entries(doc.marks)) {
    const mark = cell.staged?.value ?? cell.proposal?.value;
    if (!mark || mark.anchor.view !== view) continue;
    const polygon = mark.anchor.polygon;
    cards.push({
      id,
      state: markState(cell, snapshot),
      by: cell.proposal ? "pea" : "person",
      kind: mark.kind,
      polygon,
      guids: mark.guids ?? under(polygon[0]!),
      sqft: shoelace(polygon),
      text: mark.note ?? "",
      cell,
    });
  }
  for (const [id, note] of Object.entries(doc.notes)) {
    if (note.anchor.view !== view) continue;
    const polygon = note.anchor.polygon;
    cards.push({
      id,
      state: "note",
      by: note.by,
      kind: "note",
      polygon,
      guids: under(polygon[0]!),
      sqft: polygon.length > 2 ? shoelace(polygon) : 0,
      text: note.text,
    });
  }
  const rank = (card: Card) => STATE_ORDER.indexOf(card.state);
  return cards.sort((a, b) => rank(a) - rank(b) || byText(a.id, b.id));
}

/** The regions a drawn polygon covers at least half of, by sampled area (V6's `coverage`). */
export function coverage(polygon: Loop, regions: readonly Region[]): string[] {
  const [x0, y0, x1, y1] = box(polygon);
  const step = Math.max(0.25, Math.sqrt((x1 - x0) * (y1 - y0)) / 60);
  const hits = new Map<string, number>();
  for (let x = x0 + step / 2; x < x1; x += step)
    for (let y = y0 + step / 2; y < y1; y += step) {
      if (!inLoop(x, y, polygon)) continue;
      const hit = regions.find(
        (r) => r.role !== "zone" && inLoop(x, y, r.outer) && !r.holes.some((h) => inLoop(x, y, h)),
      );
      if (hit) hits.set(hit.guid, (hits.get(hit.guid) ?? 0) + 1);
    }
  return regions
    .filter((r) => ((hits.get(r.guid) ?? 0) * step * step) / Math.max(r.sqft, 1e-9) >= 0.5)
    .map((r) => r.guid);
}

/** Ramer-Douglas-Peucker: drop every point within `eps` of its chord. */
export function rdp<P extends Point>(points: readonly P[], eps: number): P[] {
  if (points.length < 3) return [...points];
  const a = points[0]!;
  const b = points.at(-1)!;
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-9;
  let far = 0;
  let at = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const [x, y] = points[i]!;
    const d = Math.abs((b[1] - a[1]) * x - (b[0] - a[0]) * y + b[0] * a[1] - b[1] * a[0]) / length;
    if (d > far) [far, at] = [d, i];
  }
  return far > eps
    ? [...rdp(points.slice(0, at + 1), eps).slice(0, -1), ...rdp(points.slice(at), eps)]
    : [a, b];
}
