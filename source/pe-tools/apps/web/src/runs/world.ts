export type RunMeta = {
  runId: string;
  generatedUtc: string;
  optionsHash: string;
  label: string | null;
  zoneFilter?: string | null;
  documentKey?: string;
  targetKey?: string;
};

export type RunIndexEntry = { id: string; meta: RunMeta | null };

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
  OracleRooms: number | null;
  RawRooms: number | null;
  AcceptedRooms: number | null;
  HeldRooms: number | null;
  PartitionSqft: number | null;
  AcceptedSqft: number | null;
  HeldSqft: number | null;
  VoidSqft: number | null;
  ExcludedSqft: number | null;
  ZoneSqft: number;
  InkBackedEdgeFraction: number | null;
  StrictlyEditable: boolean | null;
  Contained: boolean | null;
  Rejections: Record<string, number>;
  RejectionDetails: Record<string, string>;
  adaptedKnobs: Record<string, string>;
  census: {
    zoneSqft: number;
    inkSqft: number;
    inkRatio: number;
    edgeBandInkFraction: number;
  } | null;
  triage: { verdict: "solve" | "hold" | "error"; reason: string };
  closure: {
    doorHeadSqft: number;
    doorHeadOversizeSqft?: number;
    wallRunGapSqft: number;
    gapCloseSqft: number;
  } | null;
  plan?: { image: string; registration: string };
  capture?: {
    documentKey: string;
    capturedUtc: string;
    stamp: { Fresh: boolean; Epoch: number; BuiltUtc: string };
    result: string;
    manifest: string;
    hash: string;
    note: string;
    input?: string | null;
    proof?: Record<string, unknown> | null;
  };
  /** Stable cross-run zone identity (report v4, SHIMS.md #2 close): sha256 of level +
   * 0.5ft-quantized bbox, 12 hex chars. Absent on pre-v4 packages — pairing then falls back to
   * the positional zone NAME and must say so. */
  zoneKey?: string;
};

export type RunReport = {
  documentKey?: string;
  targetKey?: string;
  SchemaVersion: number;
  GeneratedUtc: string;
  optionsHash: string;
  options: Record<string, unknown>;
  zoneFilter?: string | null;
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

export type ClassRaster = Omit<Raster, "bits"> & { classes: Uint8Array };

export type PlanRegistration = {
  width: number;
  height: number;
  topLeft: [number, number];
  topRight: [number, number];
  bottomLeft: [number, number];
};

export type RegisteredPlan = {
  image: ImageBitmap;
  registration: PlanRegistration;
};

export type Ring = { kind: string; points: [number, number][] };
/** disposition: persisted 8th ROOM column (SHIMS.md #3 close). `null` = the package predates the
 * column (or is raw detector output) — UNKNOWN, and the renderer must never dress it as accepted. */
export type TsvRoom = {
  id: string;
  sqft: number;
  lx: number;
  ly: number;
  ceil: number | null;
  disposition: "accepted" | "held" | "void" | "excluded" | null;
};
export type TsvResidue = { id: string; reason: string; sqft: number; loops: [number, number][][] };
export type ZoneGeometry = {
  rooms: TsvRoom[];
  polys: Map<string, Ring[]>;
  residues: TsvResidue[];
};

const BASE = "/api/runs-data";

export async function fetchRunIndex(): Promise<RunPool> {
  const res = await fetch(`${BASE}/index.json`);
  if (!res.ok) throw new Error(`run index: ${res.status}`);
  const body = (await res.json()) as RunPool;
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

// ---- scores.json (SHIMS.md #1 close) ---------------------------------------------------------

export type ScoreBoard = {
  oracleRoomsInZones: number;
  roomRecall: number | null;
  heldRecall: number | null;
  missing: number;
  savedWork: number | null;
  edgeOnInkAccepted: number | null;
  edgeOnInkHeld: number | null;
  swallowSf: number | null;
  meanEditCostAccepted: number | null;
};

export type RunScores =
  | {
      metricSchemaVersion?: never;
      currency?: string;
      board: ScoreBoard;
      boardV1RawOracle?: ScoreBoard;
    }
  | {
      metricSchemaVersion: number;
      board: { axes: Record<string, unknown> };
    };

export function scoreBoards(scores: RunScores): { v11: ScoreBoard | null; v1: ScoreBoard | null } {
  if (scores.metricSchemaVersion !== undefined) return { v11: null, v1: null };
  const isV11 = scores.currency?.startsWith("v1.1") ?? false;
  return {
    v11: isV11 ? scores.board : null,
    v1: scores.boardV1RawOracle ?? (isV11 ? null : scores.board),
  };
}

const scoresCache = new Map<string, Promise<RunScores | null>>();
export function loadRunScores(runId: string): Promise<RunScores | null> {
  let cached = scoresCache.get(runId);
  if (!cached) {
    cached = fetch(`${BASE}/${runId}/scores.json`).then(async (res) => {
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`scores ${runId}: ${res.status}`);
      return (await res.json()) as RunScores;
    });
    scoresCache.set(runId, cached);
  }
  return cached;
}

export type Partiality =
  | { kind: "full" }
  | { kind: "partial"; zone: string }
  | { kind: "possibly-partial"; zones: number; modal: number };

export function partiality(report: RunReport, modalZones: number | null): Partiality {
  if (typeof report.zoneFilter === "string") return { kind: "partial", zone: report.zoneFilter };
  if ("zoneFilter" in report) return { kind: "full" }; // explicit null = explicitly unfiltered
  if (modalZones !== null && report.Zones.length < modalZones) {
    return { kind: "possibly-partial", zones: report.Zones.length, modal: modalZones };
  }
  return { kind: "full" };
}

export function modalZoneCount(reports: RunReport[]): number | null {
  const counts = new Map<number, number>();
  for (const report of reports) {
    counts.set(report.Zones.length, (counts.get(report.Zones.length) ?? 0) + 1);
  }
  let best: number | null = null;
  let bestVotes = 0;
  for (const [zones, votes] of counts) {
    if (votes > bestVotes || (votes === bestVotes && best !== null && zones > best)) {
      best = zones;
      bestVotes = votes;
    }
  }
  return best;
}

export async function poolModalZones(runIds: string[]): Promise<number | null> {
  const reports = await Promise.all(runIds.map((id) => loadRunReport(id).catch(() => null)));
  return modalZoneCount(reports.filter((report): report is RunReport => report !== null));
}

// ---- A/B zone pairing (SHIMS.md #2 close) ----------------------------------------------------

export type ZonePair = {
  id: string;
  level: string;
  name: string;
  a: ZoneRecord | null;
  b: ZoneRecord | null;
  pairedBy: "key" | "name";
};

export function reportKeyed(report: RunReport | null): boolean {
  return !!report && report.Zones.length > 0 && report.Zones.every((zone) => !!zone.zoneKey);
}

export function pairZones(cur: RunReport, prev: RunReport | null): ZonePair[] {
  if (prev && !comparableRuns(cur, prev)) prev = null;
  const byKey = reportKeyed(cur) && reportKeyed(prev);
  const pairedBy: ZonePair["pairedBy"] = byKey ? "key" : "name";
  const prevZones = prev?.Zones ?? [];
  const matched = new Set<ZoneRecord>();
  const pairs: ZonePair[] = cur.Zones.map((zone) => {
    const twin = byKey
      ? (prevZones.find((candidate) => candidate.zoneKey === zone.zoneKey) ?? null)
      : (prevZones.find((candidate) => candidate.Zone === zone.Zone) ?? null);
    if (twin) matched.add(twin);
    return {
      id: byKey ? zone.zoneKey! : zone.Zone,
      level: zone.Level,
      name: zone.Zone,
      a: twin,
      b: zone,
      pairedBy,
    };
  });
  for (const zone of prevZones) {
    if (matched.has(zone)) continue;
    pairs.push({
      id: byKey ? zone.zoneKey! : zone.Zone,
      level: zone.Level,
      name: zone.Zone,
      a: zone,
      b: null,
      pairedBy,
    });
  }
  return pairs;
}

export function matchZone(candidates: ZoneRecord[], target: ZoneRecord): ZoneRecord | null {
  const keyed =
    !!target.zoneKey && candidates.length > 0 && candidates.every((zone) => !!zone.zoneKey);
  if (keyed) return candidates.find((zone) => zone.zoneKey === target.zoneKey) ?? null;
  return candidates.find((zone) => zone.Zone === target.Zone) ?? null;
}

const rasterCache = new Map<string, Promise<Raster>>();

export function classesPathForSeals(sealsPath: string): string {
  return sealsPath.replace(/(^|\/)seals_([^/]+)$/, "$1classes_$2");
}

const classRasterCache = new Map<string, Promise<ClassRaster | null>>();
export function loadSealClasses(runId: string, sealsPath: string): Promise<ClassRaster | null> {
  const relPath = classesPathForSeals(sealsPath);
  const key = `${runId}/${relPath}`;
  let cached = classRasterCache.get(key);
  if (!cached) {
    cached = fetch(`${BASE}/${key}`).then(async (res) => {
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`seal classes ${key}: ${res.status}`);
      const buf = await res.arrayBuffer();
      const view = new DataView(buf);
      if (view.getUint32(0, true) !== 0x434b4e49) throw new Error(`${key}: not an INKC raster`);
      const w = view.getInt32(4, true);
      const h = view.getInt32(8, true);
      return {
        w,
        h,
        minX: view.getFloat64(12, true),
        minY: view.getFloat64(20, true),
        cellFt: view.getFloat64(28, true),
        classes: new Uint8Array(buf, 36, w * h),
      };
    });
    classRasterCache.set(key, cached);
  }
  return cached;
}

export function planSidecarPaths(inkPath: string): { image: string; registration: string } {
  const slash = inkPath.lastIndexOf("/");
  const directory = slash < 0 ? "" : inkPath.slice(0, slash + 1);
  const file = inkPath.slice(slash + 1);
  if (!file.startsWith("ink_") || !file.endsWith(".bin")) {
    throw new Error(`${inkPath}: not an ink raster path`);
  }
  const stem = file.slice(4, -4);
  return {
    image: `${directory}plan_${stem}.png`,
    registration: `${directory}plan_${stem}.json`,
  };
}

const planCache = new Map<string, Promise<RegisteredPlan | null>>();
export function loadPlan(
  runId: string,
  inkPath: string,
  explicit?: ZoneRecord["plan"],
): Promise<RegisteredPlan | null> {
  if (!explicit && !inkPath) return Promise.resolve(null);
  const paths = explicit ?? planSidecarPaths(inkPath);
  const key = `${runId}/${paths.registration}`;
  let cached = planCache.get(key);
  if (!cached) {
    cached = (async () => {
      const registrationResponse = await fetch(`${BASE}/${key}`);
      if (registrationResponse.status === 404) return null;
      if (!registrationResponse.ok) {
        throw new Error(`plan registration ${key}: ${registrationResponse.status}`);
      }
      const registration = (await registrationResponse.json()) as PlanRegistration;
      const imageResponse = await fetch(`${BASE}/${runId}/${paths.image}`);
      if (imageResponse.status === 404) return null;
      if (!imageResponse.ok)
        throw new Error(`plan image ${runId}/${paths.image}: ${imageResponse.status}`);
      return { registration, image: await createImageBitmap(await imageResponse.blob()) };
    })();
    planCache.set(key, cached);
  }
  return cached;
}
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

export function replayPathForInk(inkPath: string): string {
  const slash = inkPath.lastIndexOf("/");
  const directory = slash < 0 ? "" : inkPath.slice(0, slash + 1);
  const file = inkPath.slice(slash + 1);
  if (!file.startsWith("ink_")) throw new Error(`${inkPath}: not an ink raster path`);
  return `${directory}replay_${file.slice(4)}`;
}

export function parseReplaySeedInk(buffer: ArrayBuffer): Raster {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  let offset = 0;
  const requireBytes = (count: number, label: string) => {
    if (offset + count > buffer.byteLength)
      throw new Error(`detect snapshot truncated at ${label}`);
  };
  const uint32 = (label: string) => {
    requireBytes(4, label);
    const value = view.getUint32(offset, true);
    offset += 4;
    return value;
  };
  const int32 = (label: string) => {
    requireBytes(4, label);
    const value = view.getInt32(offset, true);
    offset += 4;
    return value;
  };
  const float64 = (label: string) => {
    requireBytes(8, label);
    const value = view.getFloat64(offset, true);
    offset += 8;
    return value;
  };
  const skipString = (label: string) => {
    let length = 0;
    for (let shift = 0; shift < 35; shift += 7) {
      requireBytes(1, `${label} length`);
      const byte = bytes[offset++]!;
      length |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) {
        requireBytes(length, label);
        offset += length;
        return;
      }
    }
    throw new Error(`detect snapshot has invalid ${label} length`);
  };

  if (uint32("magic") !== 0x54414b53) throw new Error("not a detect snapshot");
  int32("version");
  skipString("level");
  float64("elevation");
  skipString("capture options");
  const w = int32("width");
  const h = int32("height");
  const minX = float64("minX");
  const minY = float64("minY");
  const cellFt = float64("cellFt");
  const cells = w * h;
  if (w <= 0 || h <= 0 || !Number.isSafeInteger(cells)) {
    throw new Error(`invalid detect snapshot grid: ${w}x${h}`);
  }
  requireBytes(8 * cells, "floor/ceiling grids");
  offset += 8 * cells;
  const bitBytes = Math.ceil(cells / 8);
  requireBytes(bitBytes, "seed ink");
  return { w, h, minX, minY, cellFt, bits: bytes.slice(offset, offset + bitBytes) };
}

const replayCache = new Map<string, Promise<Raster>>();
export function loadReplaySeedInk(runId: string, inkPath: string): Promise<Raster> {
  const relPath = replayPathForInk(inkPath);
  const key = `${runId}/${relPath}`;
  let cached = replayCache.get(key);
  if (!cached) {
    cached = fetch(`${BASE}/${key}`).then(async (res) => {
      if (!res.ok) throw new Error(`replay ${key}: ${res.status}`);
      if (!res.body) throw new Error(`replay ${key}: empty response`);
      const stream = res.body.pipeThrough(new DecompressionStream("gzip"));
      return parseReplaySeedInk(await new Response(stream).arrayBuffer());
    });
    replayCache.set(key, cached);
  }
  return cached;
}

export function rasterBit(raster: Raster, x: number, y: number): boolean {
  const i = y * raster.w + x;
  return ((raster.bits[i >> 3]! >> (i & 7)) & 1) === 1;
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
        ceil: parts[6]?.trim() ? Number(parts[6]) : null,
        disposition:
          parts[7] === "accepted" ||
          parts[7] === "held" ||
          parts[7] === "void" ||
          parts[7] === "excluded"
            ? parts[7]
            : null,
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

export type ZoneViewport = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  pxPerFt: number;
  widthPx: number;
  heightPx: number;
};

export function zoneViewport(
  zone: Pick<ZoneRecord, "MinX" | "MinY" | "MaxX" | "MaxY">,
  pxPerFt: number,
  padFt = 4,
): ZoneViewport {
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

export function planCanvasTransform(
  plan: PlanRegistration,
  vp: ZoneViewport,
): [number, number, number, number, number, number] {
  return [
    ((plan.topRight[0] - plan.topLeft[0]) * vp.pxPerFt) / plan.width,
    (-(plan.topRight[1] - plan.topLeft[1]) * vp.pxPerFt) / plan.width,
    ((plan.bottomLeft[0] - plan.topLeft[0]) * vp.pxPerFt) / plan.height,
    (-(plan.bottomLeft[1] - plan.topLeft[1]) * vp.pxPerFt) / plan.height,
    (plan.topLeft[0] - vp.minX) * vp.pxPerFt,
    (vp.maxY - plan.topLeft[1]) * vp.pxPerFt,
  ];
}

export function planFrame(plan: PlanRegistration): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  const bottomRight: [number, number] = [
    plan.topRight[0] + plan.bottomLeft[0] - plan.topLeft[0],
    plan.topRight[1] + plan.bottomLeft[1] - plan.topLeft[1],
  ];
  const xs = [plan.topLeft[0], plan.topRight[0], plan.bottomLeft[0], bottomRight[0]];
  const ys = [plan.topLeft[1], plan.topRight[1], plan.bottomLeft[1], bottomRight[1]];
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

export function paintPlan(
  ctx: CanvasRenderingContext2D,
  plan: RegisteredPlan,
  vp: ZoneViewport,
  zones: [number, number][][][],
  blackPoint: number,
  whitePoint: number,
  insideOpacity: number,
  outsideOpacity: number,
): void {
  const zonePath = new Path2D(
    ringPath(
      vp,
      zones.flatMap((zone) => zone),
    ),
  );
  const stretch = 255 / (whitePoint - blackPoint);
  const contrast = 1 + (2 * stretch * blackPoint) / 255;
  const filter = `brightness(${stretch / contrast}) contrast(${contrast})`;
  const draw = (opacity: number) => {
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.filter = filter;
    ctx.setTransform(...planCanvasTransform(plan.registration, vp));
    ctx.drawImage(plan.image, 0, 0);
    ctx.restore();
  };

  ctx.save();
  const outside = new Path2D();
  outside.rect(0, 0, vp.widthPx, vp.heightPx);
  outside.addPath(zonePath);
  ctx.clip(outside, "evenodd");
  draw(outsideOpacity);
  ctx.restore();

  ctx.save();
  ctx.clip(zonePath, "evenodd");
  draw(insideOpacity);
  ctx.restore();
}

export function ringPath(vp: ZoneViewport, rings: [number, number][][]): string {
  return rings
    .map(
      (ring) =>
        ring
          .map((point, index) => {
            const [x, y] = toPx(vp, point[0], point[1]);
            return `${index === 0 ? "M" : "L"}${x} ${y}`;
          })
          .join(" ") + " Z",
    )
    .join(" ");
}

function blendPixel(
  data: Uint8ClampedArray,
  offset: number,
  rgba: [number, number, number, number],
): void {
  const sourceAlpha = rgba[3] / 255;
  const destinationAlpha = data[offset + 3]! / 255;
  const alpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);
  for (let channel = 0; channel < 3; channel++) {
    data[offset + channel] =
      (rgba[channel]! * sourceAlpha +
        data[offset + channel]! * destinationAlpha * (1 - sourceAlpha)) /
      alpha;
  }
  data[offset + 3] = alpha * 255;
}

export function paintRaster(
  ctx: CanvasRenderingContext2D,
  raster: Raster,
  vp: ZoneViewport,
  rgba: [number, number, number, number],
): void {
  const image = ctx.getImageData(0, 0, vp.widthPx, vp.heightPx);
  const cellPx = raster.cellFt * vp.pxPerFt;
  const x0 = Math.max(0, Math.floor((vp.minX - raster.minX) / raster.cellFt));
  const y0 = Math.max(0, Math.floor((vp.minY - raster.minY) / raster.cellFt));
  const x1 = Math.min(raster.w, Math.ceil((vp.maxX - raster.minX) / raster.cellFt));
  const y1 = Math.min(raster.h, Math.ceil((vp.maxY - raster.minY) / raster.cellFt));
  for (let cy = y0; cy < y1; cy++) {
    for (let cx = x0; cx < x1; cx++) {
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
          blendPixel(image.data, offset, rgba);
        }
      }
    }
  }
  ctx.putImageData(image, 0, 0);
}

export function paintClassRaster(
  ctx: CanvasRenderingContext2D,
  raster: ClassRaster,
  vp: ZoneViewport,
  classes: Set<number>,
  rgba: [number, number, number, number],
): void {
  const image = ctx.getImageData(0, 0, vp.widthPx, vp.heightPx);
  const cellPx = raster.cellFt * vp.pxPerFt;
  const x0 = Math.max(0, Math.floor((vp.minX - raster.minX) / raster.cellFt));
  const y0 = Math.max(0, Math.floor((vp.minY - raster.minY) / raster.cellFt));
  const x1 = Math.min(raster.w, Math.ceil((vp.maxX - raster.minX) / raster.cellFt));
  const y1 = Math.min(raster.h, Math.ceil((vp.maxY - raster.minY) / raster.cellFt));
  for (let cy = y0; cy < y1; cy++) {
    for (let cx = x0; cx < x1; cx++) {
      if (!classes.has(raster.classes[cy * raster.w + cx]!)) continue;
      const [px, py] = toPx(
        vp,
        raster.minX + cx * raster.cellFt,
        raster.minY + (cy + 1) * raster.cellFt,
      );
      const size = Math.max(1, Math.round(cellPx));
      for (let dy = 0; dy < size; dy++) {
        for (let dx = 0; dx < size; dx++) {
          const x = Math.round(px) + dx;
          const y = Math.round(py) + dy;
          if (x < 0 || y < 0 || x >= vp.widthPx || y >= vp.heightPx) continue;
          blendPixel(image.data, (y * vp.widthPx + x) * 4, rgba);
        }
      }
    }
  }
  ctx.putImageData(image, 0, 0);
}

export const difference = (b: number | null, a: number | null): number | null =>
  b === null || a === null ? null : b - a;

export const sumKnown = (values: (number | null)[]): number | null =>
  values.some((v) => v === null) ? null : values.reduce<number>((sum, v) => sum + v!, 0);

/** Legacy pairs keep their original behavior; a known document never pairs with an unknown one. */
export function comparableRuns(
  a: Pick<RunReport, "documentKey" | "targetKey">,
  b: Pick<RunReport, "documentKey" | "targetKey">,
): boolean {
  if (!a.documentKey && !b.documentKey) return true;
  return (
    !!a.documentKey && a.documentKey === b.documentKey && !!a.targetKey && a.targetKey === b.targetKey
  );
}

export function boardSummary(report: RunReport) {
  const zones = report.Zones;
  return {
    zones: zones.length,
    solved: zones.filter((zone) => zone.triage.verdict === "solve").length,
    errors: zones.filter((zone) => zone.triage.verdict === "error").length,
    acceptedRooms: sumKnown(zones.map((zone) => zone.AcceptedRooms)),
    acceptedSqft: sumKnown(zones.map((zone) => zone.AcceptedSqft)),
    heldSqft: sumKnown(zones.map((zone) => zone.HeldSqft)),
    rejectionTop: Object.entries(report.RejectionHistogram)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3),
  };
}
