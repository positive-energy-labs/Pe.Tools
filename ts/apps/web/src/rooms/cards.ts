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
export type MarkCell = RoomsRouteDocument["marks"][string];
export type MarkState = "proposed" | "accepted" | "pass" | "fail" | "stale" | "gone";

const MARK_GLYPH: Record<MarkState, string> = {
  proposed: "◆",
  accepted: "●",
  pass: "✓",
  fail: "✗",
  stale: "◐",
  gone: "⊘",
};
const STATE_ORDER: MarkState[] = ["proposed", "fail", "stale", "gone", "accepted", "pass"];
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

const inLoop = (x: number, y: number, loop: Loop) => {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const [xi = 0, yi = 0] = loop[i]!;
    const [xj = 0, yj = 0] = loop[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const shoelace = (loop: Loop) =>
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
      `${MARK_GLYPH[state]} ${state}`,
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
