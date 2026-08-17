// The canon data layer for /runs: the run pool, its packages, and the one registration transform
// the canvas underlay and the SVG overlay both use (so they cannot drift).
//
// Data source: the dev-only run-pool file server at `src/routes/api/runs-data.$.ts` (the
// `pe:takeoff-runs-pool` role; it is a TanStack Start API route, not a vite plugin). It serves
// the pool at .artifacts/takeoff-runs or PE_TAKEOFF_RUNS_DIR, and reports which directory that
// resolved to. A run package is exactly what the C# harness persists: report.json (v3) +
// zones/rooms_*.tsv + input/{ink,seals,close}_*.bin.
// Underlay law (kaitpw 2026-08-16): raster = what the run actually solved on (its own bins);
// rooms/residues/zones = SVG on top. Revit export images are queued as a later alternate underlay
// (docs/features/takeoff-runs/SHIMS.md #5).

export type RunMeta = {
  runId: string;
  generatedUtc: string;
  optionsHash: string;
  label: string | null;
};

export type RunIndexEntry = { id: string; meta: RunMeta | null };

/** The index answers WHICH pool it read, not just what was in it — `pool` is the absolute
 * directory the server resolved (PE_TAKEOFF_RUNS_DIR, else <repo>/.artifacts/takeoff-runs). An
 * empty `runs` with a real `pool` is the honest "nothing captured here yet" state. */
export type RunPool = { pool: string; runs: RunIndexEntry[] };

export type ZoneRecord = {
  Level: string;
  Zone: string;
  MinX: number;
  MinY: number;
  MaxX: number;
  MaxY: number;
  ZoneLoops: number[][][];
  Tsv: string;
  Ink: string;
  Seals: string;
  Close: string;
  OracleRooms: number;
  RawRooms: number;
  AcceptedRooms: number;
  HeldRooms: number;
  PartitionSqft: number;
  AcceptedSqft: number;
  HeldSqft: number;
  VoidSqft: number;
  ExcludedSqft: number;
  ZoneSqft: number;
  InkBackedEdgeFraction: number;
  StrictlyEditable: boolean;
  Contained: boolean;
  Rejections: Record<string, number>;
  RejectionDetails: Record<string, string>;
  /** Per-zone adaptive-policy deviations: knob name → the value this zone actually ran with.
   * Persisted on every zone (`ZonePolicy.AdaptedKnobs`, IReadOnlyDictionary<string,string>), but
   * empty across the whole current pool — the adaptive seam carries no live rules yet
   * (Contracts.cs `AdaptivePolicy = false`). Empty is a fact, not a missing field. */
  adaptedKnobs: Record<string, string>;
  census: { zoneSqft: number; inkSqft: number; inkRatio: number; edgeBandInkFraction: number };
  triage: { verdict: "solve" | "hold"; reason: string };
  closure: {
    doorHeadSqft: number;
    doorHeadOversizeSqft?: number;
    wallRunGapSqft: number;
    gapCloseSqft: number;
  };
};

export type RunReport = {
  SchemaVersion: number;
  GeneratedUtc: string;
  optionsHash: string;
  options: Record<string, unknown>;
  Zones: ZoneRecord[];
  RejectionHistogram: Record<string, number>;
};

export type Raster = {
  w: number;
  h: number;
  minX: number;
  minY: number;
  cellFt: number;
  bits: Uint8Array;
};

export type Ring = { kind: string; points: [number, number][] };
export type TsvRoom = { id: string; sqft: number; lx: number; ly: number; ceil: number };
export type TsvResidue = { id: string; reason: string; sqft: number; loops: [number, number][][] };
export type ZoneGeometry = {
  rooms: TsvRoom[];
  // POLY ring kind is passed through from the TSV; treat the first ring per room as the outer
  // boundary and any further rings as holes (matches eval/rhvac/overlay.py's consumption).
  polys: Map<string, Ring[]>;
  residues: TsvResidue[];
};

const BASE = "/api/runs-data";

export async function fetchRunIndex(): Promise<RunPool> {
  const res = await fetch(`${BASE}/index.json`);
  if (!res.ok) throw new Error(`run index: ${res.status}`);
  const body = (await res.json()) as RunPool;
  // Newest first — ids are timestamp-prefixed by construction.
  return { pool: body.pool, runs: [...body.runs].sort((a, b) => (a.id < b.id ? 1 : -1)) };
}

const reportCache = new Map<string, Promise<RunReport>>();
export function loadRunReport(runId: string): Promise<RunReport> {
  let cached = reportCache.get(runId);
  if (!cached) {
    cached = fetch(`${BASE}/${runId}/report.json`).then(async (res) => {
      if (!res.ok) throw new Error(`report ${runId}: ${res.status}`);
      return (await res.json()) as RunReport;
    });
    reportCache.set(runId, cached);
  }
  return cached;
}

// INKP raster: magic "INKP" (0x504B4E49 LE), int32 w, int32 h, f64 minX/minY/cellFt, then a
// row-major bitfield, LSB-first per byte (C# BitArray serialization order).
const rasterCache = new Map<string, Promise<Raster>>();
export function loadRaster(runId: string, relPath: string): Promise<Raster> {
  const key = `${runId}/${relPath}`;
  let cached = rasterCache.get(key);
  if (!cached) {
    cached = fetch(`${BASE}/${key}`).then(async (res) => {
      if (!res.ok) throw new Error(`raster ${key}: ${res.status}`);
      const buf = await res.arrayBuffer();
      const view = new DataView(buf);
      if (view.getUint32(0, true) !== 0x504b4e49) throw new Error(`${key}: not an INKP raster`);
      const w = view.getInt32(4, true);
      const h = view.getInt32(8, true);
      return {
        w,
        h,
        minX: view.getFloat64(12, true),
        minY: view.getFloat64(20, true),
        cellFt: view.getFloat64(28, true),
        bits: new Uint8Array(buf, 36, Math.ceil((w * h) / 8)),
      };
    });
    rasterCache.set(key, cached);
  }
  return cached;
}

export function rasterBit(raster: Raster, x: number, y: number): boolean {
  const i = y * raster.w + x;
  return (raster.bits[i >> 3]! >> (i & 7) & 1) === 1;
}

const tsvCache = new Map<string, Promise<ZoneGeometry>>();
export function loadZoneGeometry(runId: string, relPath: string): Promise<ZoneGeometry> {
  const key = `${runId}/${relPath}`;
  let cached = tsvCache.get(key);
  if (!cached) {
    cached = fetch(`${BASE}/${key}`).then(async (res) => {
      if (!res.ok) throw new Error(`tsv ${key}: ${res.status}`);
      return parseZoneTsv(await res.text());
    });
    tsvCache.set(key, cached);
  }
  return cached;
}

export function parseZoneTsv(text: string): ZoneGeometry {
  const rooms: TsvRoom[] = [];
  const polys = new Map<string, Ring[]>();
  const residues: TsvResidue[] = [];
  const parsePoints = (value: string): [number, number][] =>
    value.split("|").map((pair) => {
      const [x, y] = pair.split(";");
      return [Number(x), Number(y)];
    });
  for (const line of text.split(/\r?\n/)) {
    const parts = line.split("\t");
    if (parts[0] === "ROOM") {
      rooms.push({
        id: parts[1]!,
        sqft: Number(parts[2]),
        lx: Number(parts[4]),
        ly: Number(parts[5]),
        ceil: Number(parts[6]),
      });
    } else if (parts[0] === "POLY") {
      const rings = polys.get(parts[1]!) ?? [];
      rings.push({ kind: parts[2]!, points: parsePoints(parts[3]!) });
      polys.set(parts[1]!, rings);
    } else if (parts[0] === "META" && parts[1] === "residue" && parts.length >= 9) {
      residues.push({
        id: parts[2]!,
        reason: parts[3]!.toLowerCase(),
        sqft: Number(parts[4]),
        loops: parts.slice(8).filter(Boolean).map(parsePoints),
      });
    }
  }
  return { rooms, polys, residues };
}

// ---- registration helpers: model feet <-> zone-local pixels ----
// One transform shared by the <canvas> underlay and the <svg> overlay so they cannot drift.
// pxPerFt is the caller's zoom; y flips (model +Y up, screen +Y down).

export type ZoneViewport = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  pxPerFt: number;
  widthPx: number;
  heightPx: number;
};

export function zoneViewport(zone: ZoneRecord, pxPerFt: number, padFt = 4): ZoneViewport {
  const minX = zone.MinX - padFt;
  const minY = zone.MinY - padFt;
  const maxX = zone.MaxX + padFt;
  const maxY = zone.MaxY + padFt;
  return {
    minX,
    minY,
    maxX,
    maxY,
    pxPerFt,
    widthPx: Math.ceil((maxX - minX) * pxPerFt),
    heightPx: Math.ceil((maxY - minY) * pxPerFt),
  };
}

export function toPx(vp: ZoneViewport, xFt: number, yFt: number): [number, number] {
  return [(xFt - vp.minX) * vp.pxPerFt, (vp.maxY - yFt) * vp.pxPerFt];
}

export function ringPath(vp: ZoneViewport, rings: [number, number][][]): string {
  return rings
    .map((ring) =>
      ring
        .map((point, index) => {
          const [x, y] = toPx(vp, point[0], point[1]);
          return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
        })
        .join(" ") + " Z",
    )
    .join(" ");
}

/**
 * Paint a raster's set cells into an ImageData-backed canvas, cropped to the viewport.
 * `screen` skips every other cell in a checkerboard — the "invented, not received" treatment
 * from the contact-sheet color law (render forensics 2026-08-16).
 */
export function paintRaster(
  ctx: CanvasRenderingContext2D,
  raster: Raster,
  vp: ZoneViewport,
  rgba: [number, number, number, number],
  screen = false,
): void {
  const image = ctx.getImageData(0, 0, vp.widthPx, vp.heightPx);
  const cellPx = raster.cellFt * vp.pxPerFt;
  const x0 = Math.max(0, Math.floor((vp.minX - raster.minX) / raster.cellFt));
  const y0 = Math.max(0, Math.floor((vp.minY - raster.minY) / raster.cellFt));
  const x1 = Math.min(raster.w, Math.ceil((vp.maxX - raster.minX) / raster.cellFt));
  const y1 = Math.min(raster.h, Math.ceil((vp.maxY - raster.minY) / raster.cellFt));
  for (let cy = y0; cy < y1; cy++) {
    for (let cx = x0; cx < x1; cx++) {
      if (screen && (cx + cy) % 2 === 1) continue;
      if (!rasterBit(raster, cx, cy)) continue;
      const ftX = raster.minX + cx * raster.cellFt;
      const ftY = raster.minY + (cy + 1) * raster.cellFt;
      const [px, py] = toPx(vp, ftX, ftY);
      const pw = Math.max(1, Math.round(cellPx));
      for (let dy = 0; dy < pw; dy++) {
        for (let dx = 0; dx < pw; dx++) {
          const ix = Math.round(px) + dx;
          const iy = Math.round(py) + dy;
          if (ix < 0 || iy < 0 || ix >= vp.widthPx || iy >= vp.heightPx) continue;
          const offset = (iy * vp.widthPx + ix) * 4;
          image.data[offset] = rgba[0];
          image.data[offset + 1] = rgba[1];
          image.data[offset + 2] = rgba[2];
          image.data[offset + 3] = rgba[3];
        }
      }
    }
  }
  ctx.putImageData(image, 0, 0);
}

// Convenience: the derived board line a run card shows. Kept minimal — anything richer belongs
// to scores.json once the python scorer's output joins the run package
// (docs/features/takeoff-runs/SHIMS.md #1).
export function boardSummary(report: RunReport) {
  const zones = report.Zones;
  return {
    zones: zones.length,
    solved: zones.filter((zone) => zone.triage.verdict === "solve").length,
    acceptedRooms: zones.reduce((sum, zone) => sum + zone.AcceptedRooms, 0),
    acceptedSqft: zones.reduce((sum, zone) => sum + zone.AcceptedSqft, 0),
    heldSqft: zones.reduce((sum, zone) => sum + zone.HeldSqft, 0),
    rejectionTop: Object.entries(report.RejectionHistogram)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3),
  };
}
