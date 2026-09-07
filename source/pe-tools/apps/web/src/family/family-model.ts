import {
  familyModelFamilyPlane,
  familyModelPlaneOffset,
  familyModelPrismFaceCoordinate,
} from "#/family-model/preview";

/** Every authored construct that reads one parameter, grouped by how it reads it.
 * Inlined here (it used to live on the deleted inspector) because `paramAssociations`
 * below is its only producer — the shape belongs with the derivation. */
interface ParamAssociations {
  dimensions: string[];
  arrays: string[];
  nested: string[];
}

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

interface PlaneSpec {
  from: string;
  by: string;
  direction: string;
}

interface FrameSpec {
  origin: string[];
  normal: string;
  up: string;
}

export interface SolidSpec {
  kind: string;
  frame?: string;
  center?: string[];
  bottom?: string;
  void?: boolean;
  width?: string;
  depth?: string;
  height?: string;
  diameter?: string;
}

interface StubSpec {
  depth: string;
  direction: string;
}

export interface ConnectorSpec {
  domain: string;
  frame?: string;
  on?: string;
  at?: string[];
  associate?: Record<string, string>;
  shape?: string;
  diameter?: string;
  width?: string;
  height?: string;
  stub?: StubSpec;
  systemType?: string;
  flowDirection?: string;
}

interface NestedSpec {
  family: string;
  type?: string;
  frame: string;
  parameterBindings?: Record<string, string>;
}

interface ArraySpec {
  kind: string;
  member: string;
  axis: string;
  halfCount: string;
  label?: string;
  limits?: { start: string; end: string };
}

export interface FamilyModel {
  family: { name: string; category: string; template: string; placement: string };
  familyParameters: Record<string, ParamSpec>;
  /** Native name-keyed declarations, including shared:true. Legacy geometry editors remain separate. */
  parameters?: Record<string, ParamSpec>;
  sharedParameters?: Record<string, ParamSpec>;
  types: Record<string, Record<string, string>>;
  forms?: Record<string, SolidSpec>;
  datums?: Record<string, { normal: string; isLevel?: boolean }>;
  refPlanes?: Record<string, { normal: string; at: string }>;
  refLines?: Record<string, unknown>;
  dimensions?: Record<
    string,
    { between: string[]; label?: string; equality?: boolean; locked?: string }
  >;
  nested?: Record<
    string,
    { family: string; type?: string; host: string; associate?: Record<string, string> }
  >;
  coverage?: Record<string, string>;
  planes?: Record<string, PlaneSpec>;
  frames?: Record<string, FrameSpec>;
  solids?: Record<string, SolidSpec>;
  nestedFamilies?: Record<string, NestedSpec>;
  connectors?: Record<string, ConnectorSpec>;
  arrays?: Record<string, ArraySpec>;
  roomCalculationPoint?: { enabled: boolean; offset?: string };
  /** The closed family-global key set (wave 3). Each key is exactly one named Revit parameter. */
  settings?: {
    alwaysVertical?: boolean;
    shared?: boolean;
    cutWithVoidsWhenLoaded?: boolean;
    partType?: string;
    omniClass?: string;
  };
  /** Revit's own size-table CSV, verbatim — `LookupTableCsvCodec` is the one codec. */
  lookupTables?: Record<string, { csv: string }>;
  unmodeled?: unknown[];
}

/** Immutable edit channel: the route diffs before/after into staged JSON Pointer patches. */
export type Update = (fn: (model: FamilyModel) => FamilyModel) => void;

// ── portable-literal + reference helpers ────────────────────────────────────────────────────────

/** A portable length literal (`24in`, `2 1/2in`, `3ft`, `600mm`) in inches, or null. */
export function inches(text: string | undefined): number | null {
  if (!text) return null;
  const number = String.raw`(?:\d+(?:\.\d+)?(?:\s+\d+/\d+)?|\d+/\d+)`;
  const value = (raw: string) =>
    raw
      .trim()
      .split(/\s+/)
      .reduce((sum, part) => {
        const [n, d] = part.split("/").map(Number);
        return sum + (d === undefined ? n : n / d);
      }, 0);
  const suffixed = new RegExp(`^\\s*([+-]?)(${number})\\s*(in|ft|mm|cm|m)\\s*$`).exec(text);
  if (suffixed) {
    const n = value(suffixed[2]) * (suffixed[1] === "-" ? -1 : 1);
    return Number.isFinite(n)
      ? n * { in: 1, ft: 12, mm: 1 / 25.4, cm: 1 / 2.54, m: 1000 / 25.4 }[suffixed[3]]!
      : null;
  }
  // Same feet-inch display grammar as PortableScalar in FamilyModelContracts.cs.
  const display = new RegExp(
    `^\\s*([+-]?)\\s*(?:(${number})\\s*'\\s*-?\\s*)?(?:(${number})\\s*")?\\s*$`,
  ).exec(text);
  if (!display || (!display[2] && !display[3])) return null;
  const n =
    ((display[2] ? value(display[2]) * 12 : 0) + (display[3] ? value(display[3]) : 0)) *
    (display[1] === "-" ? -1 : 1);
  return Number.isFinite(n) ? n : null;
}

/** `param:Body Width` → `Body Width`; anything else → null (it is a literal). */
export const paramRef = (text: string | undefined) =>
  text?.startsWith("param:") ? text.slice("param:".length) : null;

export function paramSpec(model: FamilyModel, name: string): ParamSpec | undefined {
  return parameterSpecs(model)[name];
}

export const parameterSpecs = (model: FamilyModel): Record<string, ParamSpec> =>
  model.parameters ?? { ...model.familyParameters, ...model.sharedParameters };

export const parameterSection = (model: FamilyModel, name: string) =>
  model.parameters
    ? "parameters"
    : model.familyParameters?.[name]
      ? "familyParameters"
      : "sharedParameters";

export type ValueSource = "override" | "value" | "formula" | "missing";

/** PortableValue's boolean literals use Revit's Yes/No spelling; raw JSON remains untouched. */
export const parameterText = (value: unknown): string =>
  typeof value === "boolean" ? (value ? "Yes" : "No") : String(value ?? "");

/** THE value trichotomy: type override → formula (resolved) → family value → missing. */
export function resolveParam(
  model: FamilyModel,
  typeName: string,
  name: string,
): { text: string; source: ValueSource } {
  const override = model.types[typeName]?.[name];
  if (override != null) return { text: parameterText(override), source: "override" };
  const spec = paramSpec(model, name);
  if (!spec) return { text: "—", source: "missing" };
  if (spec.formula != null)
    return { text: spec.resolvedValues?.[typeName] ?? `= ${spec.formula}`, source: "formula" };
  return { text: spec.value == null ? "—" : parameterText(spec.value), source: "value" };
}

/** The same reference as a NUMBER of inches — null when it does not resolve to a length. */
function evalLen(model: FamilyModel, typeName: string, raw: string | undefined): number | null {
  if (!raw) return null;
  const param = paramRef(raw);
  if (!param) return inches(raw);
  const resolved = resolveParam(model, typeName, param);
  return resolved.source === "missing" ? null : inches(resolved.text);
}

// ── immutable edits ─────────────────────────────────────────────────────────────────────────────

export const setParamValue = (model: FamilyModel, name: string, value: string): FamilyModel => {
  const section = parameterSection(model, name);
  const specs = model[section] ?? {};
  const spec = specs[name];
  if (!spec || spec.formula != null) return model; // value XOR formula — formula params are locked
  return { ...model, [section]: { ...specs, [name]: { ...spec, value } } };
};

/** Stage a formula at /familyParameters/<name>/formula. An empty draft removes it.
 * The value-XOR-formula law is the HOST's to enforce: staging a formula over a param that
 * still carries values is allowed here and surfaces as an advisory, never a block. */
export const setParamFormula = (model: FamilyModel, name: string, formula: string): FamilyModel => {
  const section = parameterSection(model, name);
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

interface PlaneGeo {
  slug: string;
  axis: Axis | null;
  offset: number | null;
  param: string | null;
  editable: boolean;
  text: string;
}

interface FrameGeo {
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

/** The stock family reference planes, keyed by the reference an authored document writes. */
const DATUM_AXIS: Record<string, Axis> = Object.fromEntries(
  ["Bottom", "CenterFB", "CenterLR"].map((member) => [
    `plane:family.${member}`,
    familyModelFamilyPlane(member)!.axis,
  ]),
);

/** The direction an `Out` offset travels from a stock family plane: right (+X), FRONT (−Y), up (+Z). */
function datumOutwardSign(reference: string): number {
  const member = reference.startsWith("plane:family.")
    ? familyModelFamilyPlane(reference.slice("plane:family.".length))
    : null;
  if (!member) return 1;
  return member.outward[member.axis === "x" ? 0 : member.axis === "y" ? 1 : 2];
}

// ponytail: v1 lowering convention — solids centered on the family center planes, sitting ON
// family.Bottom. Face names and family-plane directions come from the conformance conventions,
// which do NOT agree on the Y sign: a solid's Front face is +Y, a family plane's Out is −Y.
function solidGeos(model: FamilyModel, typeName: string): SolidGeo[] {
  const planes = model.forms ? planeGeos(model, typeName) : [];
  return Object.entries(model.forms ?? model.solids ?? {}).map(([slug, solid]) => {
    // ponytail: native macros draw only at a resolved stock origin; arbitrary constrained placement needs Revit.
    const centered =
      !model.forms ||
      (solid.center?.length === 2 &&
        ["x", "y"].every((axis) =>
          solid.center!.some((name) =>
            planes.some((p) => p.slug === name && p.axis === axis && p.offset === 0),
          ),
        ) &&
        planes.some((p) => p.slug === solid.bottom && p.axis === "z" && p.offset === 0));
    return {
      slug,
      kind: solid.kind,
      isVoid: solid.void ?? solid.kind.startsWith("Void"),
      isCyl: solid.kind.endsWith("Cylinder"),
      w: centered ? evalLen(model, typeName, solid.width ?? solid.diameter) : null,
      d: centered ? evalLen(model, typeName, solid.depth ?? solid.diameter) : null,
      h: centered ? evalLen(model, typeName, solid.height) : null,
    };
  });
}

export function planeGeos(model: FamilyModel, typeName: string): PlaneGeo[] {
  if (model.datums || model.refPlanes)
    return Object.entries({ ...model.datums, ...model.refPlanes }).map(([slug, plane]) => {
      const direction = /^(Plus|Minus)?(X|Y|Z)$/.exec(plane.normal);
      const text = "at" in plane ? plane.at : "0in";
      const seed = inches(text);
      return {
        slug,
        axis: direction ? (direction[2].toLowerCase() as Axis) : null,
        offset: seed == null ? null : seed * (direction?.[1] === "Minus" ? -1 : 1),
        param: null,
        editable: false,
        text: `${text} seed`,
      };
    });
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
          : familyModelPlaneOffset(plane.direction === "In" ? "In" : "Out", value) *
            datumOutwardSign(plane.from),
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

function frameGeos(model: FamilyModel, solids: SolidGeo[], planes: PlaneGeo[]): FrameGeo[] {
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

function connGeos(
  model: FamilyModel,
  typeName: string,
  frames: FrameGeo[],
  planes: PlaneGeo[],
  solids: SolidGeo[],
): ConnGeo[] {
  return Object.entries(model.connectors ?? {})
    .filter(([, connector]) => connector.frame || connector.on)
    .map(([slug, connector]) => {
      const native = connector.on ? nativeConnectorFrame(model, connector, planes, solids) : null;
      const frame =
        native ??
        (connector.frame === "frame:family"
          ? { pos: { x: 0, y: 0, z: 0 }, normal: "+Z" }
          : (frames.find((entry) => entry.slug === connector.frame?.slice("frame:".length)) ?? {
              pos: { x: null, y: null, z: null },
              normal: "+Z",
            }));
      const shape = connector.shape ?? (connector.diameter ? "Round" : "Unspecified");
      const round = shape === "Round";
      const diameter = evalLen(model, typeName, connector.diameter);
      return {
        slug,
        domain: connector.domain,
        shape,
        pos: frame.pos,
        normal: frame.normal,
        w: round ? diameter : evalLen(model, typeName, connector.width),
        h: round ? diameter : evalLen(model, typeName, connector.height),
        stub: evalLen(model, typeName, connector.stub?.depth),
        stubDir: connector.stub?.direction,
      };
    });
}

/** Native `on` + `at` references are intersections, not legacy frames. Ref-plane coordinates are authored seeds. */
function nativeConnectorFrame(
  model: FamilyModel,
  connector: ConnectorSpec,
  planes: PlaneGeo[],
  solids: SolidGeo[],
): FrameGeo {
  const pos: Vec3 = { x: null, y: null, z: null };
  let normal = "";
  for (const ref of [connector.on!, ...(connector.at ?? [])]) {
    const plane = planes.find((p) => p.slug === ref);
    let axis = plane?.axis;
    let coordinate = plane?.offset;
    let direction = (model.refPlanes?.[ref] ?? model.datums?.[ref])?.normal;
    if (!plane) {
      const dot = ref.lastIndexOf(".");
      const solid = solids.find((g) => g.slug === ref.slice(0, dot));
      const face = ref.slice(dot + 1);
      if (solid) {
        const faces: Record<string, [Axis, number | null, string]> = {
          left: ["x", solid.w == null ? null : -solid.w / 2, "PlusX"],
          right: ["x", solid.w == null ? null : solid.w / 2, "PlusX"],
          front: ["y", solid.d == null ? null : -solid.d / 2, "PlusY"],
          back: ["y", solid.d == null ? null : solid.d / 2, "PlusY"],
          top: ["z", solid.h, "PlusZ"],
        };
        [axis, coordinate, direction] = faces[face] ?? [undefined, null, undefined];
      }
    }
    if (axis) pos[axis] = coordinate ?? null;
    if (ref === connector.on) normal = direction?.replace("Plus", "+").replace("Minus", "-") ?? "";
  }
  return { slug: connector.on!, pos, normal };
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
  const conns = connGeos(model, typeName, frames, planes, solids);
  const ghosts = Object.keys(model.types)
    .filter((name) => name !== typeName)
    .map((name) => ({ typeName: name, solids: solidGeos(model, name) }));
  // ponytail: fixed PE room-point convention — 12in, Unhosted → +Z, hosted → −Y (AddRoomDingler)
  const rcp =
    !model.parameters && model.roomCalculationPoint?.enabled
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

/** Every authored construct that reads this parameter — the inspector's "associates through",
 * derived from the authored model, never from a host GetAssociated call. */
export function paramAssociations(model: FamilyModel, name: string): ParamAssociations {
  const reads = (...refs: (string | undefined)[]) => refs.some((ref) => paramRef(ref) === name);
  const dimensions: string[] = [];
  for (const [slug, solid] of Object.entries(model.forms ?? model.solids ?? {}))
    if (reads(solid.width, solid.depth, solid.height, solid.diameter))
      dimensions.push(`solid ${slug}`);
  for (const [slug, plane] of Object.entries(model.planes ?? {}))
    if (reads(plane.by)) dimensions.push(`plane ${slug}`);
  for (const [slug, connector] of Object.entries(model.connectors ?? {}))
    if (reads(connector.diameter, connector.width, connector.height, connector.stub?.depth))
      dimensions.push(`connector ${slug}`);
  const arrays = Object.entries(model.arrays ?? {})
    .filter(([, spec]) => reads(spec.halfCount, spec.label))
    .map(([slug]) => `array ${slug}`);
  const nested = Object.entries(model.nestedFamilies ?? {}).flatMap(([slug, spec]) =>
    Object.entries(spec.parameterBindings ?? {})
      .filter(([, source]) => paramRef(source) === name || source === name)
      .map(([target]) => `${slug} · ${target}`),
  );
  for (const [slug, dim] of Object.entries(model.dimensions ?? {}))
    if (dim.label === name) dimensions.push(`dimension ${slug}`);
  for (const [slug, spec] of Object.entries(model.nested ?? {}))
    for (const [target, source] of Object.entries(spec.associate ?? {}))
      if (reads(source)) nested.push(`${slug} / ${target}`);
  return { dimensions, arrays, nested };
}
