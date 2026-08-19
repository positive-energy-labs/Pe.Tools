/**
 * PROTOTYPE (round 1) — the family review board's world.
 *
 * THE QUESTION: what shape does a takeoff-style "looks good" board take over portable
 * `family.json` files, where the human eyeball is the final oracle on geometry?
 *
 * ONE RENDERER, TWO FEEDS. Both sides of every drawing come from the SAME run artifact:
 * `FamilyModelEvaluatorOracle.Predict` (what the portable document SAYS) and
 * `FamilyFoundryRuntimeProbe` (what Revit DID), dumped together by `ProbeJsonDump`. The web is a
 * projection, never a second predictor — a browser-side predictor that silently ignored `frame`
 * would make every verdict on this board a confident lie about a framed or turned family.
 * `#/family/family-model`'s `buildSheet` is exactly such an approximation (v1: every solid centred
 * on the family centre planes, on Bottom), which is why the board does not use it.
 *
 * That choice is a round-1 gate item, not a settled law — see the MAP.
 */
import type { FamilyModel } from "#/family/family-model";

export type Vec3 = readonly [number, number, number];

// ── the run artifact (ProbeJsonDump) ────────────────────────────────────────────────────────────

export interface ProbePlane {
  normal: Vec3;
  midpoint: Vec3;
}

export interface ProbeBox {
  sketchPlaneName: string | null;
  min: Vec3;
  max: Vec3;
  startOffset: number;
  endOffset: number;
  diameter?: number;
  isSolid: boolean;
}

export interface ProbeConnector {
  domain: string;
  profile: string;
  systemClassification: string | null;
  flowDirection: string | null;
  origin: Vec3;
  widthAxis: Vec3;
  lengthAxis: Vec3;
  faceNormal: Vec3;
  diameter: number | null;
  width: number | null;
  length: number | null;
}

export interface ProbeSettings {
  alwaysVertical: boolean | null;
  shared: boolean | null;
  cutWithVoidsWhenLoaded: boolean | null;
  partType: number | null;
  omniClass: string | null;
  roomCalculationPointEnabled: boolean;
  roomCalculationPointOffsetFeet: number | null;
  lookupTableNames: string[];
}

export interface PredictedSolid {
  slug: string;
  kind: string;
  isSolid: boolean;
  min: Vec3;
  max: Vec3;
  diameter: number | null;
}

export interface PredictedPlane {
  name: string;
  point: Vec3;
  normal: Vec3;
}

export interface Probe {
  familyName: string;
  typeName: string;
  predicted: { refusal: string | null; solids: PredictedSolid[]; planes: PredictedPlane[] };
  parameterValues: Record<string, number>;
  planes: Record<string, ProbePlane>;
  prisms: ProbeBox[];
  cylinders: ProbeBox[];
  connectors: ProbeConnector[];
  settings: ProbeSettings;
  counts: { referencePlanes: number; dimensions: number; extrusions: number; connectors: number };
}

/** One family on the board: the portable document, plus one probe per type Revit built. */
export interface BoardFamily {
  slug: string;
  name: string;
  model: FamilyModel;
  /** Empty when lowering refused the family — then `refusal` carries the typed reason. */
  probes: Record<string, Probe>;
  refusal: { code: string; detail: string } | null;
  /**
   * The Revit DOCUMENT the probe read, by name. A `family.json` may be materialized into many
   * documents across many years; this names the ONE this board's reading came from, and the
   * chrome states it. Null when nothing was ever built (a refusal).
   */
  documentName: string | null;
}

// ── agreement vocabulary ────────────────────────────────────────────────────────────────────────

/**
 * Six states, and the distinctions are the point. `revit-only` is what Revit built that nobody
 * authored (a template host placeholder, a connector stub); `unread` is authored truth the probe
 * cannot see at all (arrays, nested families) — the honest answer, never "agrees".
 */
export type Agreement =
  | "agrees"
  | "differs"
  | "authored-only"
  | "revit-only"
  | "refused"
  | "unread";

export const AGREEMENT_LABEL: Record<Agreement, string> = {
  agrees: "agrees",
  differs: "differs",
  "authored-only": "authored only",
  "revit-only": "Revit only",
  refused: "refused",
  unread: "no reading",
};

/** Every agreement's meaning-band role token. `agrees` is deliberately quiet: the board's job is
 *  to make disagreement findable, and a page of green ticks hides the one that is not. */
export const AGREEMENT_TONE: Record<Agreement, string> = {
  agrees: "var(--r-ink-mute)",
  differs: "var(--r-alarm)",
  "authored-only": "var(--r-caution)",
  "revit-only": "var(--r-caution)",
  refused: "var(--r-alarm)",
  unread: "var(--r-ink-mute)",
};

export type RowKind =
  | "solid"
  | "plane"
  | "connector"
  | "setting"
  | "lookup"
  | "array"
  | "nested"
  | "parameter";

export interface ReviewRow {
  key: string;
  kind: RowKind;
  label: string;
  /** What the portable document predicts, in words. */
  authored: string;
  /** What Revit reports, in words. */
  actual: string;
  /** Worst coordinate disagreement in feet, where both sides are numbers. */
  deviation: number | null;
  agreement: Agreement;
  /** Extra sentence a reader needs to judge the row. */
  note?: string;
}

// ── scenes: what a view draws ───────────────────────────────────────────────────────────────────

export interface SceneBox {
  key: string;
  min: Vec3;
  max: Vec3;
  isSolid: boolean;
  /** Plan draws a true circle; the elevations draw the honest silhouette (the box). */
  diameter?: number;
}

export interface ScenePlane {
  key: string;
  point: Vec3;
  normal: Vec3;
}

export interface SceneConnector {
  key: string;
  origin: Vec3;
  normal: Vec3;
}

export interface Scene {
  boxes: SceneBox[];
  planes: ScenePlane[];
  connectors: SceneConnector[];
}

export const EMPTY_SCENE: Scene = { boxes: [], planes: [], connectors: [] };

/** The oracle's prediction, drawn. Connectors are not predicted, so this side has none. */
export function authoredScene(probe: Probe): Scene {
  return {
    boxes: probe.predicted.solids.map((solid) => ({
      key: solid.slug,
      min: solid.min,
      max: solid.max,
      isSolid: solid.isSolid,
      diameter: solid.diameter ?? undefined,
    })),
    planes: probe.predicted.planes.map((plane) => ({
      key: plane.name,
      point: plane.point,
      normal: plane.normal,
    })),
    connectors: [],
  };
}

/** What Revit built. Stock template planes are drawn too — they are the frame the rest sits in. */
export function actualScene(probe: Probe): Scene {
  return {
    boxes: [
      ...probe.prisms.map((prism, index) => ({
        key: `prism ${index}`,
        min: prism.min,
        max: prism.max,
        isSolid: prism.isSolid,
      })),
      ...probe.cylinders.map((cylinder, index) => ({
        key: `cylinder ${index}`,
        min: cylinder.min,
        max: cylinder.max,
        isSolid: cylinder.isSolid,
        diameter: cylinder.diameter,
      })),
    ],
    planes: Object.entries(probe.planes).map(([name, plane]) => ({
      key: name,
      point: plane.midpoint,
      normal: plane.normal,
    })),
    connectors: probe.connectors.map((connector, index) => ({
      key: `connector ${index}`,
      origin: connector.origin,
      normal: connector.faceNormal,
    })),
  };
}

// ── views, mirroring ProbeSvgGallery so the board and the SVG gallery cannot disagree ──────────

export interface BoardView {
  title: string;
  axes: string;
  /** World axis index drawn along screen X, and along screen Y (up). */
  right: 0 | 1 | 2;
  up: 0 | 1 | 2;
  /** The axis looked ALONG — a plane whose normal is this axis is seen face-on and is not drawn. */
  depth: 0 | 1 | 2;
}

export const VIEWS: readonly BoardView[] = [
  { title: "Plan (+Z)", axes: "X right · Y up", right: 0, up: 1, depth: 2 },
  { title: "Front (−Y)", axes: "X right · Z up", right: 0, up: 2, depth: 1 },
  { title: "Right (+X)", axes: "Y right · Z up", right: 1, up: 2, depth: 0 },
];

/** One half-span in feet covering every scene passed, so predicted and actual share a frame. */
export function sceneHalfSpan(scenes: Scene[]): number {
  let half = 0.25;
  for (const scene of scenes) {
    for (const box of scene.boxes)
      for (let axis = 0; axis < 3; axis++)
        half = Math.max(half, Math.abs(box.min[axis]), Math.abs(box.max[axis]));
    for (const connector of scene.connectors)
      for (let axis = 0; axis < 3; axis++) half = Math.max(half, Math.abs(connector.origin[axis]));
  }
  return half;
}

// ── pairing ─────────────────────────────────────────────────────────────────────────────────────

const AXIS_NAMES = ["X", "Y", "Z"] as const;

export const feet = (value: number) => `${(Math.round(value * 1000) / 1000).toFixed(3)}′`;

const point = (value: Vec3) => `[${value.map(feet).join(", ")}]`;

const boxText = (min: Vec3, max: Vec3) => `${point(min)} → ${point(max)}`;

/** The same worst-corner distance the C# oracle assertion uses, so a row and a test agree. */
function boxDistance(a: { min: Vec3; max: Vec3 }, b: { min: Vec3; max: Vec3 }): number {
  let worst = 0;
  for (let axis = 0; axis < 3; axis++)
    worst = Math.max(
      worst,
      Math.abs(a.min[axis] - b.min[axis]),
      Math.abs(a.max[axis] - b.max[axis]),
    );
  return worst;
}

const TOLERANCE = 1e-6;

/**
 * Every checkable claim in one family type, paired predicted-against-actual.
 *
 * Solids pair GEOMETRICALLY, because a Revit extrusion carries no authored slug — the same rule
 * `FamilyModelEvaluatorOracleAssert` uses. Planes pair by NAME, because an authored plane keeps
 * its name in the document.
 */
export function reviewRows(family: BoardFamily, typeName: string): ReviewRow[] {
  const probe = family.probes[typeName];
  if (!probe) return refusedRows(family);

  const rows: ReviewRow[] = [];
  const unclaimedPrisms = probe.prisms.map((box, index) => ({ box, index, taken: false }));
  const unclaimedCylinders = probe.cylinders.map((box, index) => ({ box, index, taken: false }));

  if (probe.predicted.refusal)
    rows.push({
      key: "prediction",
      kind: "solid",
      label: "prediction",
      authored: "refused",
      actual: `${probe.prisms.length + probe.cylinders.length} extrusions`,
      deviation: null,
      agreement: "refused",
      note: probe.predicted.refusal,
    });

  for (const predicted of probe.predicted.solids) {
    const round = predicted.diameter != null;
    const pool = round ? unclaimedCylinders : unclaimedPrisms;
    const candidates = pool.filter(
      (entry) => !entry.taken && entry.box.isSolid === predicted.isSolid,
    );
    let best: (typeof pool)[number] | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const candidate of candidates) {
      const distance = boxDistance(predicted, candidate.box);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = candidate;
      }
    }
    if (!best) {
      rows.push({
        key: `solid:${predicted.slug}`,
        kind: "solid",
        label: predicted.slug,
        authored: `${predicted.kind} ${boxText(predicted.min, predicted.max)}`,
        actual: "—",
        deviation: null,
        agreement: "authored-only",
        note: "Revit built no extrusion of this kind and solidity.",
      });
      continue;
    }
    best.taken = true;
    rows.push({
      key: `solid:${predicted.slug}`,
      kind: "solid",
      label: predicted.slug,
      authored: `${predicted.kind} ${boxText(predicted.min, predicted.max)}`,
      actual: boxText(best.box.min, best.box.max),
      deviation: bestDistance,
      agreement: bestDistance <= TOLERANCE ? "agrees" : "differs",
    });
  }

  for (const entry of [...unclaimedPrisms, ...unclaimedCylinders]) {
    if (entry.taken) continue;
    rows.push({
      key: `revit-solid:${entry.box.isSolid ? "s" : "v"}${entry.index}${entry.box.diameter ? "c" : "p"}`,
      kind: "solid",
      label: entry.box.sketchPlaneName ?? "unnamed extrusion",
      authored: "—",
      actual: `${entry.box.isSolid ? "solid" : "void"} ${boxText(entry.box.min, entry.box.max)}`,
      deviation: null,
      agreement: "revit-only",
      note: "Revit built this and the portable document never named it — a template placeholder or a connector stub.",
    });
  }

  for (const predicted of probe.predicted.planes) {
    const actual = probe.planes[predicted.name];
    if (!actual) {
      rows.push({
        key: `plane:${predicted.name}`,
        kind: "plane",
        label: predicted.name,
        authored: `${point(predicted.point)} n ${point(predicted.normal)}`,
        actual: "—",
        deviation: null,
        agreement: "authored-only",
      });
      continue;
    }
    // Plane identity is orientation + distance from the origin; a flipped normal is the same plane.
    const flip = dot(predicted.normal, actual.normal) < 0 ? -1 : 1;
    const normalGap = Math.max(
      ...AXIS_NAMES.map((_, axis) => Math.abs(predicted.normal[axis] - flip * actual.normal[axis])),
    );
    const distanceGap = Math.abs(
      dot(predicted.normal, predicted.point) - flip * dot(actual.normal, actual.midpoint),
    );
    const worst = Math.max(normalGap, distanceGap);
    rows.push({
      key: `plane:${predicted.name}`,
      kind: "plane",
      label: predicted.name,
      authored: `n ${point(predicted.normal)} · d ${feet(dot(predicted.normal, predicted.point))}`,
      actual: `n ${point(actual.normal)} · d ${feet(dot(actual.normal, actual.midpoint))}`,
      deviation: worst,
      agreement: worst <= 1e-5 ? "agrees" : "differs",
    });
  }

  rows.push(...connectorRows(family.model, probe));
  rows.push(...settingRows(family.model, probe));
  rows.push(...unreadRows(family.model));
  return rows;
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function connectorRows(model: FamilyModel, probe: Probe): ReviewRow[] {
  const authored = Object.entries(model.connectors ?? {});
  const rows: ReviewRow[] = authored.map(([slug, spec], index) => {
    const actual = probe.connectors[index];
    return {
      key: `connector:${slug}`,
      kind: "connector" as const,
      label: slug,
      authored: `${spec.domain} · ${spec.shape}`,
      actual: actual ? `${actual.domain} · ${actual.profile} at ${point(actual.origin)}` : "—",
      deviation: null,
      agreement: actual ? ("unread" as const) : ("authored-only" as const),
      note: actual
        ? "The oracle predicts no connector placement, so this pair is read side by side and judged by eye."
        : undefined,
    };
  });
  for (let index = authored.length; index < probe.connectors.length; index++) {
    const actual = probe.connectors[index];
    rows.push({
      key: `revit-connector:${index}`,
      kind: "connector",
      label: `${actual.domain} connector`,
      authored: "—",
      actual: `${actual.profile} at ${point(actual.origin)}`,
      deviation: null,
      agreement: "revit-only",
    });
  }
  return rows;
}

function settingRows(model: FamilyModel, probe: Probe): ReviewRow[] {
  const settings = model.settings ?? {};
  const pairs: Array<[string, string | undefined, string | undefined]> = [
    ["alwaysVertical", text(settings.alwaysVertical), text(probe.settings.alwaysVertical)],
    ["shared", text(settings.shared), text(probe.settings.shared)],
    [
      "cutWithVoidsWhenLoaded",
      text(settings.cutWithVoidsWhenLoaded),
      text(probe.settings.cutWithVoidsWhenLoaded),
    ],
    ["partType", text(settings.partType), text(probe.settings.partType)],
    ["omniClass", text(settings.omniClass), text(probe.settings.omniClass)],
    [
      "roomCalculationPoint",
      text(model.roomCalculationPoint?.enabled),
      text(probe.settings.roomCalculationPointEnabled),
    ],
  ];
  const rows: ReviewRow[] = pairs.map(([label, authored, actual]) => ({
    key: `setting:${label}`,
    kind: "setting",
    label,
    authored: authored ?? "—",
    actual: actual ?? "—",
    deviation: null,
    // An omitted key is not a claim. Capture emits a setting only when it differs from a stated
    // default, so "the document is silent and the template's value stands" is the honest reading —
    // never "agrees", which would credit the document with a value it never wrote.
    agreement: authored === undefined ? "revit-only" : authored === actual ? "agrees" : "differs",
    note:
      authored === undefined
        ? "The portable document does not state this key, so Revit's value is the template's."
        : undefined,
  }));

  const authoredTables = Object.keys(model.lookupTables ?? {}).sort();
  const actualTables = [...probe.settings.lookupTableNames].sort();
  if (authoredTables.length || actualTables.length)
    rows.push({
      key: "setting:lookupTables",
      kind: "lookup",
      label: "lookupTables",
      authored: authoredTables.join(", ") || "—",
      actual: actualTables.join(", ") || "—",
      deviation: null,
      agreement: authoredTables.join("|") === actualTables.join("|") ? "agrees" : "differs",
    });
  return rows;
}

const text = (value: string | number | boolean | null | undefined): string | undefined =>
  value == null ? undefined : String(value);

/** Authored facts the runtime probe has no reading for. Naming them is the honesty. */
function unreadRows(model: FamilyModel): ReviewRow[] {
  return [
    ...Object.entries(model.nestedFamilies ?? {}).map(([slug, spec]) => ({
      key: `nested:${slug}`,
      kind: "nested" as const,
      label: slug,
      authored: `${spec.family}${spec.type ? ` · ${spec.type}` : ""} on ${spec.frame}`,
      actual: "not read",
      deviation: null,
      agreement: "unread" as const,
      note: "The probe reads extrusions, planes and connectors. A nested family instance is none of those.",
    })),
    ...Object.entries(model.arrays ?? {}).map(([slug, spec]) => ({
      key: `array:${slug}`,
      kind: "array" as const,
      label: slug,
      authored: `${spec.kind} of ${spec.member} along ${spec.axis}`,
      actual: "not read",
      deviation: null,
      agreement: "unread" as const,
      note: "Array membership and count have no probe reading; only the drawing shows whether it happened.",
    })),
  ];
}

/** A family lowering refused: the whole authored document is the predicted side and Revit has none. */
function refusedRows(family: BoardFamily): ReviewRow[] {
  const refusal = family.refusal;
  const rows: ReviewRow[] = [
    {
      key: "refusal",
      kind: "solid",
      label: refusal?.code ?? "refused",
      authored: "the whole document",
      actual: "nothing built",
      deviation: null,
      agreement: "refused",
      note: refusal?.detail,
    },
  ];
  for (const [slug, solid] of Object.entries(family.model.solids ?? {}))
    rows.push({
      key: `solid:${slug}`,
      kind: "solid",
      label: slug,
      authored: `${solid.kind} on ${solid.frame}`,
      actual: "—",
      deviation: null,
      agreement: "refused",
    });
  for (const [slug, connector] of Object.entries(family.model.connectors ?? {}))
    rows.push({
      key: `connector:${slug}`,
      kind: "connector",
      label: slug,
      authored: `${connector.domain} · ${connector.shape}`,
      actual: "—",
      deviation: null,
      agreement: "refused",
    });
  return rows;
}

// ── board-level rollups ─────────────────────────────────────────────────────────────────────────

export function tally(rows: ReviewRow[]): Record<Agreement, number> {
  const counts: Record<Agreement, number> = {
    agrees: 0,
    differs: 0,
    "authored-only": 0,
    "revit-only": 0,
    refused: 0,
    unread: 0,
  };
  for (const row of rows) counts[row.agreement] += 1;
  return counts;
}

/** The one word a family wears before anyone looks at the drawing. */
export function headline(rows: ReviewRow[]): Agreement {
  const counts = tally(rows);
  if (counts.refused) return "refused";
  if (counts.differs) return "differs";
  if (counts["authored-only"]) return "authored-only";
  if (counts.unread) return "unread";
  return "agrees";
}

/** The human's call. Nothing computes it, which is the whole point of the board. */
export type Verdict = "unjudged" | "good" | "wrong" | "unsure";

export const VERDICT_LABEL: Record<Verdict, string> = {
  unjudged: "—",
  good: "looks good",
  wrong: "looks wrong",
  unsure: "not sure",
};

// ── constituents: what is actually IN this portable document ────────────────────────────────────

/**
 * One kind of thing the `family.json` declares, counted and named.
 *
 * Read off the AUTHORED document, never the probe: this answers "what is in the json I have",
 * which is the library half of the surface's model. What Revit made of it is the row table's job.
 * Empty kinds do not list — a family with no connectors says nothing about connectors.
 */
export interface Constituent {
  kind: string;
  count: number;
  names: string[];
}

export function constituents(family: BoardFamily): Constituent[] {
  const model = family.model;
  const settingsNames = Object.keys(model.settings ?? {});
  if (model.roomCalculationPoint != null) settingsNames.push("roomCalculationPoint");
  for (const table of Object.keys(model.lookupTables ?? {})) settingsNames.push(`table ${table}`);
  const groups: Constituent[] = [
    named("solids", model.solids),
    named("planes", model.planes),
    named("connectors", model.connectors),
    // Nested families and arrays are listed even though NO probe reads them — leaving them out
    // would draw `PE GRD Supply`, whose whole content is planes plus a nested vane plus an array,
    // as a nearly empty family.
    named("nested", model.nestedFamilies),
    named("arrays", model.arrays),
    { kind: "settings", count: settingsNames.length, names: settingsNames.sort() },
  ];
  return groups.filter((group) => group.count > 0);
}

const named = (kind: string, section: Record<string, unknown> | undefined): Constituent => {
  const names = Object.keys(section ?? {});
  return { kind, count: names.length, names };
};

// ── editing a claim, staged in memory ───────────────────────────────────────────────────────────

/**
 * Which claims can be WRITTEN, and what shape the value takes.
 *
 * A `settings` key is exactly one named parameter with one scalar value, so it has a single
 * writable home in the document. Nothing else on the board does: a solid row's numbers are the
 * ORACLE'S PREDICTION about a box, derived from parameters and a frame — writing "0.5′" back into
 * it has no destination. Making that refusal visible per cell is the point; a table where every
 * cell looks writable and half of them silently swallow the edit is the worse surface.
 */
export type ClaimEdit = "boolean" | "text";

const BOOLEAN_SETTINGS = new Set([
  "alwaysVertical",
  "shared",
  "cutWithVoidsWhenLoaded",
  "roomCalculationPoint",
]);

export function claimEdit(row: ReviewRow): ClaimEdit | null {
  if (row.kind !== "setting") return null;
  return BOOLEAN_SETTINGS.has(row.label) ? "boolean" : "text";
}

/** Why a claim refuses the caret. Rendered as the cell's `capReason`, never as silence. */
export function uneditableReason(row: ReviewRow): string {
  switch (row.kind) {
    case "solid":
      return "geometry is the oracle's PREDICTION about a box, not a field — edit the parameter or frame that drives it";
    case "plane":
      return "a plane is derived from its `from` / `by` / `direction` — edit those, not the resulting normal and distance";
    case "connector":
      return "a connector's placement comes from its frame — edit the frame, not the origin Revit reports";
    case "lookup":
      return "a lookup table is a CSV blob in the document; this board shows only which tables exist";
    case "array":
    case "nested":
      return "no probe reads this claim, so there is nothing here to reconcile an edit against";
    default:
      return "this claim has no single writable home in the family.json";
  }
}

/** One unsaved edit to a claim's authored side. Nothing writes it anywhere — see `EDIT_HOME`. */
export interface StagedEdit {
  stageKey: string;
  rowKey: string;
  /** The `settings` key (or other dotted path) the edit would land on, if it had a home. */
  path: string;
  from: string;
  to: string;
}

export type EditBook = Record<string, StagedEdit>;

export const editKey = (stageKey: string, rowKey: string) => `${stageKey}/${rowKey}`;

/**
 * Stage one edit, or REFUSE it with a reason.
 *
 * The refusal string is the editable `StateCell`'s own contract: return a reason and the cell
 * restores the prior value and says why, right there, without resizing the row. So the validation
 * lives here — pure, testable without a DOM — and the cell only renders what it decides.
 *
 * Committing the ORIGINAL value back un-stages the edit rather than staging a no-op; an unsaved
 * mark on a cell that holds the document's own value is a lie about what saving would do.
 */
export function stageEdit(
  book: EditBook,
  stageKey: string,
  row: ReviewRow,
  text: string,
): EditBook | string {
  const shape = claimEdit(row);
  if (shape == null) return uneditableReason(row);
  const trimmed = text.trim();
  if (trimmed === "") return "blank commits nothing — an emptied key is not `false`";
  if (shape === "boolean" && trimmed !== "true" && trimmed !== "false")
    return `"${trimmed}" is not true or false — nothing committed`;

  const key = editKey(stageKey, row.key);
  const next = { ...book };
  // `row.authored` is the document's own text — "—" when the document is silent on the key, which
  // stages as an edit from nothing rather than reading as agreement.
  if (trimmed === row.authored) delete next[key];
  else
    next[key] = {
      stageKey,
      rowKey: row.key,
      path: row.kind === "setting" ? `settings.${row.label}` : row.label,
      from: row.authored,
      to: trimmed,
    };
  return next;
}

/** What the cell shows: the staged text if any, otherwise the document's own. */
export const stagedValue = (book: EditBook, stageKey: string, row: ReviewRow): string =>
  book[editKey(stageKey, row.key)]?.to ?? row.authored;
