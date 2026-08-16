/**
 * The authored family model — /family's ONE resolution path.
 *
 * RESOLUTION LAW: every surface (triptych, register cards, type matrix, geometry table,
 * inspector) reads a parameter through `resolveParam` and a dimension through
 * `resolveDim` / `evalLen`. There is exactly one copy of that path and it lives here. The
 * prototype kept a second copy to dodge an import cycle between the route and its helpers;
 * this module exists so that cycle never has to be dodged again.
 *
 * Precedence, in order: a TYPE OVERRIDE wins, then a formula's resolved value (evidence
 * injected, else the formula text verbatim), then the family value, then "—" for missing.
 * A parameter carries a value XOR a formula — that rule is the HOST's to enforce; the edit
 * helpers here only refuse the cases the schema already forbids, and never silently repair.
 *
 * Everything in this module is pure: `FamilyModel` values are immutable and every edit
 * returns a new model, so the route can diff before/after into JSON Pointer patches.
 */
import type { ParamAssociations } from "#/family/inspector";
import { familyModelPlaneOffset, familyModelPrismFaceCoordinate } from "#/family-model/preview";

// ── authored shape (v1, loosely typed for the projection) ───────────────────────────────────────

export interface ParamSpec {
  dataType: string;
  propertiesGroup?: string;
  resolvedValues?: Record<string, string>;
  value?: string;
  formula?: string;
  /** Authored schema carries a nullable `isInstance`; absent means TYPE (Revit's default). */
  isInstance?: boolean;
  /** LIVE lane only: Revit reports the parameter read-only, so no cell here may be edited. */
  readOnly?: boolean;
}

export interface PlaneSpec {
  from: string;
  by: string;
  direction: string;
}

export interface FrameSpec {
  origin: string[];
  normal: string;
  up: string;
}

export interface SolidSpec {
  kind: string;
  frame: string;
  width?: string;
  depth?: string;
  height?: string;
  diameter?: string;
}

export interface StubSpec {
  depth: string;
  direction: string;
}

export interface ConnectorSpec {
  domain: string;
  frame: string;
  shape: string;
  diameter?: string;
  width?: string;
  height?: string;
  stub?: StubSpec;
  systemType?: string;
  flowDirection?: string;
}

export interface NestedSpec {
  family: string;
  type?: string;
  frame: string;
  parameterBindings?: Record<string, string>;
}

export interface ArraySpec {
  kind: string;
  member: string;
  axis: string;
  halfCount: string;
  limits?: { start: string; end: string };
}

export interface FamilyModel {
  family: { name: string; category: string; template: string; placement: string };
  familyParameters: Record<string, ParamSpec>;
  sharedParameters?: Record<string, ParamSpec>;
  types: Record<string, Record<string, string>>;
  planes?: Record<string, PlaneSpec>;
  frames?: Record<string, FrameSpec>;
  solids?: Record<string, SolidSpec>;
  nestedFamilies?: Record<string, NestedSpec>;
  connectors?: Record<string, ConnectorSpec>;
  arrays?: Record<string, ArraySpec>;
  roomCalculationPoint?: { enabled: boolean };
  unmodeled?: unknown[];
}

/** Immutable edit channel: the route diffs before/after into staged JSON Pointer patches. */
export type Update = (fn: (model: FamilyModel) => FamilyModel) => void;

// ── portable-literal + reference helpers ────────────────────────────────────────────────────────

/** A portable length literal (`24in`, `2 1/2in`, `3ft`, `600mm`) in inches, or null. */
export function inches(text: string | undefined): number | null {
  if (!text) return null;
  const m = /^\s*(?:(\d+(?:\.\d+)?)(?:\s+(\d+)\/(\d+))?|(\d+)\/(\d+))\s*(in|ft|mm)\s*$/.exec(text);
  if (!m) return null;
  let n = m[1] ? Number.parseFloat(m[1]) : 0;
  if (m[2] && m[3]) n += Number(m[2]) / Number(m[3]);
  if (m[4] && m[5]) n = Number(m[4]) / Number(m[5]);
  return m[6] === "ft" ? n * 12 : m[6] === "mm" ? n / 25.4 : n;
}

export const fmtIn = (n: number) => `${Math.round(n * 2) / 2}in`;

/** `param:Body Width` → `Body Width`; anything else → null (it is a literal). */
export const paramRef = (text: string | undefined) =>
  text?.startsWith("param:") ? text.slice("param:".length) : null;

export function paramSpec(model: FamilyModel, name: string): ParamSpec | undefined {
  return model.familyParameters[name] ?? model.sharedParameters?.[name];
}

export type ValueSource = "override" | "value" | "formula" | "missing";

/** THE value trichotomy: type override → formula (resolved) → family value → missing. */
export function resolveParam(
  model: FamilyModel,
  typeName: string,
  name: string,
): { text: string; source: ValueSource } {
  const override = model.types[typeName]?.[name];
  if (override != null) return { text: override, source: "override" };
  const spec = paramSpec(model, name);
  if (!spec) return { text: "—", source: "missing" };
  if (spec.formula != null)
    return { text: spec.resolvedValues?.[typeName] ?? `= ${spec.formula}`, source: "formula" };
  return { text: spec.value ?? "—", source: "value" };
}

/** One authored dimension reference (`param:X` or a literal), resolved for one type. */
export function resolveDim(model: FamilyModel, typeName: string, raw: string | undefined) {
  if (!raw) return null;
  const param = paramRef(raw);
  if (!param) return { label: raw, text: raw, source: "value" as ValueSource, param: null };
  const resolved = resolveParam(model, typeName, param);
  return { label: raw, ...resolved, param };
}

/** The same reference as a NUMBER of inches — null when it does not resolve to a length. */
export function evalLen(
  model: FamilyModel,
  typeName: string,
  raw: string | undefined,
): number | null {
  if (!raw) return null;
  const param = paramRef(raw);
  if (!param) return inches(raw);
  const resolved = resolveParam(model, typeName, param);
  return resolved.source === "missing" ? null : inches(resolved.text);
}

// ── immutable edits ─────────────────────────────────────────────────────────────────────────────

export const setParamValue = (model: FamilyModel, name: string, value: string): FamilyModel => {
  const section = model.familyParameters[name] ? "familyParameters" : "sharedParameters";
  const specs = model[section] ?? {};
  const spec = specs[name];
  if (!spec || spec.formula != null) return model; // value XOR formula — formula params are locked
  return { ...model, [section]: { ...specs, [name]: { ...spec, value } } };
};

/** Stage a formula at /familyParameters/<name>/formula. An empty draft removes it.
 * The value-XOR-formula law is the HOST's to enforce: staging a formula over a param that
 * still carries values is allowed here and surfaces as an advisory, never a block. */
export const setParamFormula = (model: FamilyModel, name: string, formula: string): FamilyModel => {
  const section = model.familyParameters[name] ? "familyParameters" : "sharedParameters";
  const specs = model[section] ?? {};
  const spec = specs[name];
  if (!spec) return model;
  const next: ParamSpec = { ...spec };
  if (formula.trim()) next.formula = formula.trim();
  else delete next.formula;
  return { ...model, [section]: { ...specs, [name]: next } };
};

export const setOverride = (
  model: FamilyModel,
  typeName: string,
  name: string,
  value: string | null,
): FamilyModel => {
  if (paramSpec(model, name)?.formula != null) return model; // schema rule, enforced in the UI too
  const type = { ...model.types[typeName] };
  if (value == null) delete type[name];
  else type[name] = value;
  return { ...model, types: { ...model.types, [typeName]: type } };
};

export const addType = (model: FamilyModel, name: string): FamilyModel =>
  name && !model.types[name] ? { ...model, types: { ...model.types, [name]: {} } } : model;

export const setSolidDim = (
  model: FamilyModel,
  slug: string,
  field: keyof SolidSpec,
  value: string,
): FamilyModel => ({
  ...model,
  solids: { ...model.solids, [slug]: { ...(model.solids?.[slug] as SolidSpec), [field]: value } },
});

export const toggleStub = (model: FamilyModel, slug: string): FamilyModel => {
  const connector = model.connectors?.[slug];
  if (!connector?.stub) return model;
  const direction = connector.stub.direction === "Out" ? "In" : "Out";
  return {
    ...model,
    connectors: {
      ...model.connectors,
      [slug]: { ...connector, stub: { ...connector.stub, direction } },
    },
  };
};

export const toggleRcp = (model: FamilyModel): FamilyModel => ({
  ...model,
  roomCalculationPoint: { enabled: !(model.roomCalculationPoint?.enabled ?? false) },
});

// ── the dumb evaluator: params → arithmetic → plane intersection → face lookup ──────────────────

export type Axis = "x" | "y" | "z";

export interface Vec3 {
  x: number | null;
  y: number | null;
  z: number | null;
}

export interface SolidGeo {
  slug: string;
  kind: string;
  isVoid: boolean;
  isCyl: boolean;
  w: number | null;
  d: number | null;
  h: number | null;
}

export interface PlaneGeo {
  slug: string;
  axis: Axis | null;
  offset: number | null;
  param: string | null;
  editable: boolean;
  text: string;
}

export interface FrameGeo {
  slug: string;
  pos: Vec3;
  normal: string;
}

export interface ConnGeo {
  slug: string;
  domain: string;
  shape: string;
  pos: Vec3;
  normal: string;
  w: number | null;
  h: number | null;
  stub: number | null;
  stubDir: string | undefined;
}

export const DATUM_AXIS: Record<string, Axis> = {
  "plane:family.Bottom": "z",
  "plane:family.CenterFB": "y",
  "plane:family.CenterLR": "x",
};

// ponytail: v1 lowering convention — solids centered on the family center planes, sitting ON
// family.Bottom, +Y is Front (normative dumb-evaluator rules + conformance vectors).
export function solidGeos(model: FamilyModel, typeName: string): SolidGeo[] {
  return Object.entries(model.solids ?? {}).map(([slug, solid]) => ({
    slug,
    kind: solid.kind,
    isVoid: solid.kind.startsWith("Void"),
    isCyl: solid.kind.endsWith("Cylinder"),
    w: evalLen(model, typeName, solid.width ?? solid.diameter),
    d: evalLen(model, typeName, solid.depth ?? solid.diameter),
    h: evalLen(model, typeName, solid.height),
  }));
}

export function planeGeos(model: FamilyModel, typeName: string): PlaneGeo[] {
  return Object.entries(model.planes ?? {}).map(([slug, plane]) => {
    const param = paramRef(plane.by);
    const spec = param ? paramSpec(model, param) : undefined;
    const value = evalLen(model, typeName, plane.by);
    return {
      slug,
      axis: DATUM_AXIS[plane.from] ?? null,
      offset:
        value == null
          ? null
          : familyModelPlaneOffset(plane.direction === "In" ? "In" : "Out", value),
      param,
      editable: spec != null && spec.formula == null,
      text: param ? resolveParam(model, typeName, param).text : plane.by,
    };
  });
}

function faceCoord(solids: SolidGeo[], ref: string): { axis: Axis; value: number | null } | null {
  const [slug, face] = ref.slice("face:".length).split(".");
  const solid = solids.find((entry) => entry.slug === slug);
  if (!solid || solid.w == null || solid.d == null || solid.h == null) return null;
  const coordinate = familyModelPrismFaceCoordinate(face, solid.w, solid.d, solid.h);
  return coordinate ? { axis: coordinate.axis, value: coordinate.coordinate } : null;
}

export function frameGeos(model: FamilyModel, solids: SolidGeo[], planes: PlaneGeo[]): FrameGeo[] {
  return Object.entries(model.frames ?? {}).map(([slug, frame]) => {
    const pos: Vec3 = { x: null, y: null, z: null };
    for (const ref of frame.origin) {
      if (ref.startsWith("face:")) {
        const coordinate = faceCoord(solids, ref);
        if (coordinate) pos[coordinate.axis] = coordinate.value;
      } else if (DATUM_AXIS[ref]) {
        pos[DATUM_AXIS[ref]] = 0;
      } else if (ref.startsWith("plane:")) {
        const plane = planes.find((entry) => entry.slug === ref.slice("plane:".length));
        if (plane?.axis) pos[plane.axis] = plane.offset;
      }
    }
    return { slug, pos, normal: frame.normal };
  });
}

export function connGeos(model: FamilyModel, typeName: string, frames: FrameGeo[]): ConnGeo[] {
  return Object.entries(model.connectors ?? {}).map(([slug, connector]) => {
    const frame =
      connector.frame === "frame:family"
        ? { pos: { x: 0, y: 0, z: 0 }, normal: "+Z" }
        : (frames.find((entry) => entry.slug === connector.frame.slice("frame:".length)) ?? {
            pos: { x: null, y: null, z: null },
            normal: "+Z",
          });
    const round = connector.shape === "Round";
    const diameter = evalLen(model, typeName, connector.diameter);
    return {
      slug,
      domain: connector.domain,
      shape: connector.shape,
      pos: frame.pos,
      normal: frame.normal,
      w: round ? diameter : evalLen(model, typeName, connector.width),
      h: round ? diameter : evalLen(model, typeName, connector.height),
      stub: evalLen(model, typeName, connector.stub?.depth),
      stubDir: connector.stub?.direction,
    };
  });
}

export interface Sheet {
  solids: SolidGeo[];
  planes: PlaneGeo[];
  frames: FrameGeo[];
  conns: ConnGeo[];
  ghosts: Array<{ typeName: string; solids: SolidGeo[] }>;
  rcp: Vec3 | null;
}

/** Everything the triptych draws for ONE type, plus the other types' solids as ghosts. */
export function buildSheet(model: FamilyModel, typeName: string): Sheet {
  const solids = solidGeos(model, typeName);
  const planes = planeGeos(model, typeName);
  const frames = frameGeos(model, solids, planes);
  const conns = connGeos(model, typeName, frames);
  const ghosts = Object.keys(model.types)
    .filter((name) => name !== typeName)
    .map((name) => ({ typeName: name, solids: solidGeos(model, name) }));
  // ponytail: fixed PE room-point convention — 12in, Unhosted → +Z, hosted → −Y (AddRoomDingler)
  const rcp = model.roomCalculationPoint?.enabled
    ? model.family.placement === "Unhosted"
      ? { x: 0, y: 0, z: 12 }
      : { x: 0, y: -12, z: 0 }
    : null;
  return { solids, planes, frames, conns, ghosts, rcp };
}

/** One shared world bbox (incl. ghosts) → one px/in factor → true relative scale everywhere. */
export function sheetBounds(sheet: Sheet): Record<Axis, [number, number]> {
  const extent: Record<Axis, number[]> = { x: [], y: [], z: [] };
  const solid = (geo: SolidGeo) => {
    if (geo.w != null) extent.x.push(-geo.w / 2, geo.w / 2);
    if (geo.d != null) extent.y.push(-geo.d / 2, geo.d / 2);
    if (geo.h != null) extent.z.push(0, geo.h);
  };
  sheet.solids.forEach(solid);
  for (const ghost of sheet.ghosts) ghost.solids.forEach(solid);
  for (const plane of sheet.planes)
    if (plane.axis && plane.offset != null) extent[plane.axis].push(plane.offset);
  for (const conn of sheet.conns)
    for (const axis of ["x", "y", "z"] as Axis[]) {
      const p = conn.pos[axis];
      if (p != null) extent[axis].push(p - (conn.stub ?? 0) - 2, p + (conn.stub ?? 0) + 2);
    }
  if (sheet.rcp)
    for (const axis of ["x", "y", "z"] as Axis[])
      if (sheet.rcp[axis] != null) extent[axis].push(sheet.rcp[axis] as number);
  const range = (values: number[]): [number, number] => {
    if (values.length === 0) return [-12, 12];
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const pad = Math.max(3, (hi - lo) * 0.14);
    return [lo - pad, hi + pad];
  };
  return { x: range(extent.x), y: range(extent.y), z: range(extent.z) };
}

// ── reference indices ───────────────────────────────────────────────────────────────────────────

/** Reverse reference index — who uses each constituent. Feeds the relationship caption. */
export function usedByIndex(model: FamilyModel): Record<string, string[]> {
  const index: Record<string, string[]> = {};
  const add = (id: string, user: string) => (index[id] = [...(index[id] ?? []), user]);
  for (const [slug, frame] of Object.entries(model.frames ?? {}))
    for (const ref of frame.origin) {
      if (ref.startsWith("face:")) add(`s:${ref.slice(5).split(".")[0]}`, `frame:${slug}`);
      else if (ref.startsWith("plane:") && !DATUM_AXIS[ref])
        add(`pl:${ref.slice(6)}`, `frame:${slug}`);
    }
  for (const [slug, connector] of Object.entries(model.connectors ?? {}))
    if (connector.frame !== "frame:family")
      add(`f:${connector.frame.slice(6)}`, `connector:${slug}`);
  for (const [slug, arraySpec] of Object.entries(model.arrays ?? {}))
    for (const limit of [arraySpec.limits?.start, arraySpec.limits?.end])
      if (limit?.startsWith("plane:") && !DATUM_AXIS[limit])
        add(`pl:${limit.slice(6)}`, `array:${slug}`);
  return index;
}

/** Every authored construct that reads this parameter — the inspector's "associates through",
 * derived from the authored model, never from a host GetAssociated call. */
export function paramAssociations(model: FamilyModel, name: string): ParamAssociations {
  const reads = (...refs: (string | undefined)[]) => refs.some((ref) => paramRef(ref) === name);
  const dimensions: string[] = [];
  for (const [slug, solid] of Object.entries(model.solids ?? {}))
    if (reads(solid.width, solid.depth, solid.height, solid.diameter))
      dimensions.push(`solid ${slug}`);
  for (const [slug, plane] of Object.entries(model.planes ?? {}))
    if (reads(plane.by)) dimensions.push(`plane ${slug}`);
  for (const [slug, connector] of Object.entries(model.connectors ?? {}))
    if (reads(connector.diameter, connector.width, connector.height, connector.stub?.depth))
      dimensions.push(`connector ${slug}`);
  const arrays = Object.entries(model.arrays ?? {})
    .filter(([, spec]) => reads(spec.halfCount))
    .map(([slug]) => `array ${slug}`);
  const nested = Object.entries(model.nestedFamilies ?? {}).flatMap(([slug, spec]) =>
    Object.entries(spec.parameterBindings ?? {})
      .filter(([, source]) => paramRef(source) === name || source === name)
      .map(([target]) => `${slug} · ${target}`),
  );
  return { dimensions, arrays, nested };
}
