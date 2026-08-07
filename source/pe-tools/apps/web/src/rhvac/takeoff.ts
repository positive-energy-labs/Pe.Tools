/**
 * Client-side mirror of the canonical takeoff TSV parse contract: META/ROOM/POLY
 * lines, tab-separated, with POLY loops preserved vertex-for-vertex as
 * "x;y|x;y|…" in feet, model coordinates (Y up — flipped at render). The C#
 * simplifier is an r10-export concern. Display-lenient where the canonical
 * parser throws: we surface a message instead of refusing the whole plan pane.
 */
import type {
  TakeoffFlagKind,
  TakeoffLevel,
  TakeoffResidueShape,
  TakeoffRoomShape,
} from "#/rhvac/types";

export function parseTakeoffTsv(tsvText: string): TakeoffLevel {
  let levelName: string | null = null;
  let elevation: number | null = null;
  const rooms: TakeoffRoomShape[] = [];
  const residues: TakeoffResidueShape[] = [];
  const byId = new Map<string, TakeoffRoomShape>();

  for (const rawLine of tsvText.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (line.length === 0) continue;
    const parts = line.split("\t");
    switch (parts[0]) {
      case "META":
        if (parts[1] === "level") levelName = parts[2] ?? null;
        else if (parts[1] === "elev") elevation = Number(parts[2]);
        else if (parts[1] === "flag") applyFlagMeta(parts[2] ?? "", byId);
        else if (parts[1] === "residue") {
          if (parts.length < 9)
            throw new Error(`malformed META residue line: ${line.slice(0, 80)}`);
          residues.push({
            id: parts[2]!,
            reason: parts[3] as TakeoffResidueShape["reason"],
            rawSqft: Number(parts[4]),
            label: [Number(parts[5]), Number(parts[6])],
            meanCeilingFt: Number(parts[7]),
            outer: parseLoop(parts[8]!),
            holes: parts.slice(9).map(parseLoop),
          });
        }
        // rooms / totalSqft are display metadata; ignored.
        break;
      case "ROOM": {
        if (parts.length < 7) throw new Error(`malformed ROOM line: ${line.slice(0, 80)}`);
        const room: TakeoffRoomShape = {
          id: parts[1]!,
          rawSqft: Number(parts[2]),
          perimeterFt: Number(parts[3]),
          label: [Number(parts[4]), Number(parts[5])],
          meanCeilingFt: Number(parts[6]),
          outer: [],
          holes: [],
        };
        rooms.push(room);
        byId.set(room.id, room);
        break;
      }
      case "POLY": {
        if (parts.length < 4) throw new Error(`malformed POLY line: ${line.slice(0, 80)}`);
        const target = byId.get(parts[1]!);
        if (!target) throw new Error(`POLY references unknown room '${parts[1]}'`);
        const loop = parseLoop(parts[3]!);
        if (parts[2] === "outer") target.outer.push(...loop);
        else if (parts[2] === "hole") target.holes.push(loop);
        else throw new Error(`unknown loop kind '${parts[2]}'`);
        break;
      }
      default:
        throw new Error(`unrecognized TSV line: ${line.slice(0, 80)}`);
    }
  }

  if (levelName === null || elevation === null || Number.isNaN(elevation))
    throw new Error("takeoff TSV has no META level/elev header");
  return { levelName, elevation, rooms: rooms.filter((r) => r.outer.length >= 3), residues };
}

/**
 * Ambiguity-flag META line payload: `<roomId>:<flag+flag>` (Contracts.cs ToTsv).
 * Lenient by design — old TSVs have no flag lines, and a flag naming a room the
 * parser dropped (or an id we've never seen) is silently ignored, matching the
 * "unknown META keys are skipped" contract of the other consumers.
 */
function applyFlagMeta(payload: string, byId: Map<string, TakeoffRoomShape>): void {
  const colon = payload.indexOf(":");
  if (colon <= 0) return;
  const room = byId.get(payload.slice(0, colon));
  if (!room) return;
  const kinds = payload
    .slice(colon + 1)
    .split("+")
    .filter((kind) => kind.length > 0) as TakeoffFlagKind[];
  if (kinds.length === 0) return;
  room.flags = [...new Set([...(room.flags ?? []), ...kinds])].sort();
}

function parseLoop(text: string): [number, number][] {
  return text.split("|").map((pair) => {
    const [x, y] = pair.split(";");
    const point: [number, number] = [Number(x), Number(y)];
    if (Number.isNaN(point[0]) || Number.isNaN(point[1]))
      throw new Error(`malformed POLY point '${pair}'`);
    return point;
  });
}

// ── render geometry helpers ──────────────────────────────────────────────────

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function levelBounds(level: TakeoffLevel): Bounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const shape of [...level.rooms, ...level.residues])
    for (const [x, y] of shape.outer) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

/** Model Y is up, SVG Y is down — mirror inside the level's own bounds. */
const flipY = (y: number, bounds: Bounds) => bounds.minY + bounds.maxY - y;

export function shapePathD(
  shape: Pick<TakeoffRoomShape, "outer" | "holes">,
  bounds: Bounds,
): string {
  const loopD = (loop: [number, number][]) =>
    loop
      .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)} ${flipY(y, bounds).toFixed(2)}`)
      .join("") + "Z";
  return [loopD(shape.outer), ...shape.holes.map(loopD)].join("");
}

/** Area-weighted centroid of the outer loop (shoelace), in flipped (SVG) coordinates. */
export function shapeCentroid(shape: TakeoffRoomShape, bounds: Bounds): [number, number] {
  const pts = shape.outer;
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i]!;
    const [x1, y1] = pts[(i + 1) % pts.length]!;
    const cross = x0 * y1 - x1 * y0;
    area += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  if (Math.abs(area) < 1e-9) {
    const [x, y] = pts[0]!;
    return [x, flipY(y, bounds)];
  }
  area *= 0.5;
  return [cx / (6 * area), flipY(cy / (6 * area), bounds)];
}
