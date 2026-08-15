import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  type SettingsProposalSource,
  settingsFieldPointer,
  settingsFieldSegments,
} from "@pe/agent-contracts";
import { ThemeToggle } from "#/components/ThemeToggle";
import { RfaChip, RvtChip } from "#/components/document-chips";
import { Sentence, type SlotSpec } from "#/components/sentence";
import {
  type CitationTarget,
  FamilyDocPane,
  resolveCitations,
  useFamilyGrounding,
} from "#/family/doc-pane";
import {
  type FormulaProblem,
  authoredFormulaParams,
  formulaAncestry,
  validateFormula,
} from "#/family/formula";
import { FamilyInspector, type ParamAssociations } from "#/family/inspector";
import {
  LIVE_DOCUMENT_ENTRY,
  type LiveApplyFailure,
  type LiveLaneApi,
  readAgo,
  useFamilyEditorLane,
} from "#/family/live";
import {
  FAMILY_MODULE,
  type EvidenceSlice,
  type FamilyStore,
  type FieldState,
  useLiveFamilyStore,
  useMockFamilyStore,
} from "#/family/store";
import { familyModelPlaneOffset, familyModelPrismFaceCoordinate } from "#/family-model/preview";

export const Route = createFileRoute("/family")({
  /** Both params are optional, so every `<Link to="/family">` stays search-free. */
  validateSearch: (search: Record<string, unknown>): { mock?: true; family?: string } => ({
    mock: search.mock != null && search.mock !== false ? true : undefined,
    /** `?family=<elementId>` — /families row navigation. The URL is the only state. */
    family:
      typeof search.family === "string" && search.family.trim() ? search.family.trim() : undefined,
  }),
  component: FamilyRoute,
});

/** The store seam is chosen once, here: `?mock` mounts a self-contained fixture. */
function FamilyRoute() {
  const { mock } = Route.useSearch();
  return mock ? <MockFamily /> : <LiveFamily />;
}

function MockFamily() {
  return <Page store={useMockFamilyStore()} lane={AUTHORED_LANE} />;
}

/* ------------------------------------------------------------------------------------------------
 * /family — THE surface for ONE family, in one of two lanes.
 *
 * LANE LAW: binding IS the choice. The sentence's document slot lists the authored
 * family.json documents AND, whenever the bound session has a family open, one live entry
 * ("family open in <world>"). Picking one binds its lane; there is no toggle, and the lane
 * is only ever DISPLAYED — as a chip beside the sentence.
 *
 *   AUTHORED — a family.json. route:settings owns the document (snapshot, field trichotomy,
 *     validate/save lifecycle); route:family owns the sibling context: spec doc (OCR blocks
 *     + image ids) and Revit evidence (resolved per-type values, provenance-stamped for
 *     staleness). Anatomy sheet (true-scale triptych) + type flex matrix + grounded doc pane,
 *     one hover vocabulary across all three: cell ↔ constituent ↔ cited document region.
 *   LIVE — the family open in the bound session's family editor, via family.editor.snapshot.
 *     Same matrix, formula column, review/staging machinery, doc pane, and inspector; no
 *     anatomy (a live family has no authored constituents to draw), no build/evidence lane,
 *     no validate command. Save is family.editor.apply, where per-edit failure is real.
 *
 * CAPTURE IS THE BRIDGE: in the live lane the capture verb promotes the live family to an
 * authored document (revit.detail.family-model → settings create → bind), landing the user
 * in the authored lane of the same family. That is the ONLY crossing between the lanes.
 * ---------------------------------------------------------------------------------------------- */

// ── the two lanes ───────────────────────────────────────────────────────────────────────────────

/** What the route knows about the lane it is in. `live` is present only in the live lane. */
interface Lane {
  kind: "authored" | "live";
  /** Chip text beside the sentence — the lane is DISPLAYED, never toggled. */
  chip: string;
  live: LiveLaneApi | null;
}

const AUTHORED_LANE: Lane = { kind: "authored", chip: "authored · family.json", live: null };

/**
 * The lane chooser. It holds one piece of state — which document slot entry is bound — and
 * everything else follows from it. A live entry appears only while the bound session's
 * ACTIVE document is a family document; if that stops being true, the lane falls back to
 * authored rather than rendering a stale snapshot.
 */
function LiveFamily() {
  const { family: requestedFamily } = Route.useSearch();
  const authored = useLiveFamilyStore();
  const [wantsLive, setWantsLive] = useState(false);
  const { store: liveStore, api } = useFamilyEditorLane(authored, wantsLive);

  /* `?family=<id>` — /families row navigation. Opening it in the family editor is what
     MAKES the live lane available, so this does not wait for availability; it waits only
     for a bound world. Once per id, then out of the way: the URL is the only state. */
  const apiRef = useRef(api);
  apiRef.current = api;
  const requested = useRef<string | null>(null);
  useEffect(() => {
    if (!requestedFamily || !authored.boundTarget || requested.current === requestedFamily) return;
    requested.current = requestedFamily;
    setWantsLive(true);
    void apiRef.current.openFamily(requestedFamily);
  }, [requestedFamily, authored.boundTarget]);

  const live = wantsLive && api.available;
  const lane: Lane = live
    ? { kind: "live", chip: `live · ${api.world ?? "bound world"}`, live: api }
    : AUTHORED_LANE;

  return (
    <Page
      store={live ? liveStore : authored}
      lane={lane}
      liveEntry={api.available ? LIVE_DOCUMENT_ENTRY : null}
      onPickLane={setWantsLive}
    />
  );
}

// ── model types (v1 authored shape, loosely typed for the projection) ───────────────────────────
interface ParamSpec {
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
interface SolidSpec {
  kind: string;
  frame: string;
  width?: string;
  depth?: string;
  height?: string;
  diameter?: string;
}
interface StubSpec {
  depth: string;
  direction: string;
}
interface ConnectorSpec {
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
  limits?: { start: string; end: string };
}
interface FamilyModel {
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

// ── portable-literal + reference helpers ────────────────────────────────────────────────────────
function inches(text: string | undefined): number | null {
  if (!text) return null;
  const m = /^\s*(?:(\d+(?:\.\d+)?)(?:\s+(\d+)\/(\d+))?|(\d+)\/(\d+))\s*(in|ft|mm)\s*$/.exec(text);
  if (!m) return null;
  let n = m[1] ? Number.parseFloat(m[1]) : 0;
  if (m[2] && m[3]) n += Number(m[2]) / Number(m[3]);
  if (m[4] && m[5]) n = Number(m[4]) / Number(m[5]);
  return m[6] === "ft" ? n * 12 : m[6] === "mm" ? n / 25.4 : n;
}
const fmtIn = (n: number) => `${Math.round(n * 2) / 2}in`;

const paramRef = (text: string | undefined) =>
  text?.startsWith("param:") ? text.slice("param:".length) : null;

function paramSpec(model: FamilyModel, name: string): ParamSpec | undefined {
  return model.familyParameters[name] ?? model.sharedParameters?.[name];
}

type ValueSource = "override" | "value" | "formula" | "missing";
function resolveParam(
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

function resolveDim(model: FamilyModel, typeName: string, raw: string | undefined) {
  if (!raw) return null;
  const param = paramRef(raw);
  if (!param) return { label: raw, text: raw, source: "value" as ValueSource, param: null };
  const resolved = resolveParam(model, typeName, param);
  return { label: raw, ...resolved, param };
}

// ── immutable edits (staged via route:settings field patches) ───────────────────────────────────
type Update = (fn: (model: FamilyModel) => FamilyModel) => void;

const setParamValue = (model: FamilyModel, name: string, value: string): FamilyModel => {
  const section = model.familyParameters[name] ? "familyParameters" : "sharedParameters";
  const specs = model[section] ?? {};
  const spec = specs[name];
  if (!spec || spec.formula != null) return model; // value XOR formula — formula params are locked
  return { ...model, [section]: { ...specs, [name]: { ...spec, value } } };
};

/** Stage a formula at /familyParameters/<name>/formula. An empty draft removes it.
 * The value-XOR-formula law is the HOST's to enforce: staging a formula over a param that
 * still carries values is allowed here and surfaces as an advisory, never a block. */
const setParamFormula = (model: FamilyModel, name: string, formula: string): FamilyModel => {
  const section = model.familyParameters[name] ? "familyParameters" : "sharedParameters";
  const specs = model[section] ?? {};
  const spec = specs[name];
  if (!spec) return model;
  const next: ParamSpec = { ...spec };
  if (formula.trim()) next.formula = formula.trim();
  else delete next.formula;
  return { ...model, [section]: { ...specs, [name]: next } };
};

const setOverride = (
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

const addType = (model: FamilyModel, name: string): FamilyModel =>
  name && !model.types[name] ? { ...model, types: { ...model.types, [name]: {} } } : model;

const setSolidDim = (
  model: FamilyModel,
  slug: string,
  field: keyof SolidSpec,
  value: string,
): FamilyModel => ({
  ...model,
  solids: { ...model.solids, [slug]: { ...(model.solids?.[slug] as SolidSpec), [field]: value } },
});

const toggleStub = (model: FamilyModel, slug: string): FamilyModel => {
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

const toggleRcp = (model: FamilyModel): FamilyModel => ({
  ...model,
  roomCalculationPoint: { enabled: !(model.roomCalculationPoint?.enabled ?? false) },
});

// ── the dumb evaluator: params → arithmetic → plane intersection → face lookup ──────────────────
type Axis = "x" | "y" | "z";
interface Vec3 {
  x: number | null;
  y: number | null;
  z: number | null;
}
interface SolidGeo {
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
interface ConnGeo {
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

const DATUM_AXIS: Record<string, Axis> = {
  "plane:family.Bottom": "z",
  "plane:family.CenterFB": "y",
  "plane:family.CenterLR": "x",
};

function evalLen(model: FamilyModel, typeName: string, raw: string | undefined): number | null {
  if (!raw) return null;
  const param = paramRef(raw);
  if (!param) return inches(raw);
  const resolved = resolveParam(model, typeName, param);
  return resolved.source === "missing" ? null : inches(resolved.text);
}

// ponytail: v1 lowering convention — solids centered on the family center planes, sitting ON
// family.Bottom, +Y is Front (normative dumb-evaluator rules + conformance vectors).
function solidGeos(model: FamilyModel, typeName: string): SolidGeo[] {
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

function planeGeos(model: FamilyModel, typeName: string): PlaneGeo[] {
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

function connGeos(model: FamilyModel, typeName: string, frames: FrameGeo[]): ConnGeo[] {
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

/** Reverse reference index — who uses each constituent. Feeds the relationship caption. */
function usedByIndex(model: FamilyModel): Record<string, string[]> {
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

/** Every param name a constituent's dims reference — links hover to matrix cells + citations. */
function constituentParams(model: FamilyModel, hovered: string | null): string[] {
  if (!hovered) return [];
  const [kind, slug] = [
    hovered.slice(0, hovered.indexOf(":")),
    hovered.slice(hovered.indexOf(":") + 1),
  ];
  const refs: (string | undefined)[] = [];
  if (kind === "s") {
    const solid = model.solids?.[slug];
    refs.push(solid?.width, solid?.depth, solid?.height, solid?.diameter);
  } else if (kind === "pl") {
    refs.push(model.planes?.[slug]?.by);
  } else if (kind === "c") {
    const connector = model.connectors?.[slug];
    refs.push(connector?.diameter, connector?.width, connector?.height, connector?.stub?.depth);
  } else if (kind === "a") {
    refs.push(model.arrays?.[slug]?.halfCount);
  }
  return refs.map((ref) => paramRef(ref)).filter((name): name is string => name != null);
}

/** Reverse of `constituentParams`: every authored construct that reads this parameter.
 * This is the inspector's "associates through" — derived from the authored model, not
 * from a host GetAssociated call. */
function paramAssociations(model: FamilyModel, name: string): ParamAssociations {
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

// ── the triptych ────────────────────────────────────────────────────────────────────────────────
interface ViewDef {
  key: string;
  label: string;
  u: Axis;
  v: Axis;
  depth: Axis;
}
const VIEWS: ViewDef[] = [
  { key: "front", label: "FRONT · looking −Y", u: "x", v: "z", depth: "y" },
  { key: "side", label: "SIDE · looking +X", u: "y", v: "z", depth: "x" },
  { key: "plan", label: "PLAN · looking −Z", u: "x", v: "y", depth: "z" },
];

const DOMAIN_COLOR: Record<string, string> = {
  Duct: "var(--pe-blue)",
  Pipe: "var(--lichen)",
  Electrical: "var(--kiln)",
};

const NORMAL_RE = /^([+-])([XYZ])$/;

interface Sheet {
  solids: SolidGeo[];
  planes: PlaneGeo[];
  frames: FrameGeo[];
  conns: ConnGeo[];
  ghosts: Array<{ typeName: string; solids: SolidGeo[] }>;
  rcp: Vec3 | null;
}

function buildSheet(model: FamilyModel, typeName: string): Sheet {
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
function bounds(sheet: Sheet): Record<Axis, [number, number]> {
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

function Triptych({
  model,
  typeName,
  update,
  hovered,
  onHover,
}: {
  model: FamilyModel;
  typeName: string;
  update: Update;
  hovered: string | null;
  onHover: (id: string | null) => void;
}) {
  const sheet = useMemo(() => buildSheet(model, typeName), [model, typeName]);
  const box = useMemo(() => bounds(sheet), [sheet]);
  const VIEW_W = 258;
  const VIEW_H = 258;
  const M = 14;
  const scale = Math.min(
    ...VIEWS.flatMap((view) => [
      (VIEW_W - 2 * M) / (box[view.u][1] - box[view.u][0]),
      (VIEW_H - 2 * M) / (box[view.v][1] - box[view.v][0]),
    ]),
  );

  const dimIf = (id: string) => (hovered && hovered !== id ? 0.3 : 1);

  return (
    <div className="flex flex-wrap gap-3">
      {VIEWS.map((view) => {
        const [uMin, uMax] = box[view.u];
        const [vMin, vMax] = box[view.v];
        const cx = (VIEW_W - 2 * M - (uMax - uMin) * scale) / 2;
        const cy = (VIEW_H - 2 * M - (vMax - vMin) * scale) / 2;
        const X = (u: number) => M + cx + (u - uMin) * scale;
        const Y = (v: number) => VIEW_H - M - cy - (v - vMin) * scale;

        const solidRect = (geo: SolidGeo) => {
          const du = view.u === "x" ? geo.w : view.u === "y" ? geo.d : null;
          const dv = view.v === "z" ? geo.h : view.v === "y" ? geo.d : null;
          if (du == null || dv == null) return null;
          const u0 = -du / 2;
          const v0 = view.v === "z" ? 0 : -dv / 2;
          return { x: X(u0), y: Y(v0 + dv), w: du * scale, h: dv * scale };
        };

        const dragPlane = (plane: PlaneGeo) => (event: React.PointerEvent<SVGGElement>) => {
          if (!plane.editable || !plane.param || !plane.axis) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          const svg = event.currentTarget.ownerSVGElement;
          const along = plane.axis === view.u ? "u" : "v";
          const move = (pointer: PointerEvent) => {
            const rect = svg?.getBoundingClientRect();
            if (!rect) return;
            const world =
              along === "u"
                ? uMin + (pointer.clientX - rect.left - M - cx) / scale
                : vMin + (VIEW_H - (pointer.clientY - rect.top) - M - cy) / scale;
            const value = Math.max(0.5, Math.abs(world));
            update((current) =>
              setOverride(current, typeName, plane.param as string, fmtIn(value)),
            );
          };
          const up = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
          };
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", up);
        };

        return (
          <div key={view.key}>
            <svg
              width={VIEW_W}
              height={VIEW_H}
              className="rounded-[2px] border border-[var(--line)] bg-[var(--paper-2)]/30"
              onMouseLeave={() => onHover(null)}
            >
              <line
                x1={X(0)}
                y1={M}
                x2={X(0)}
                y2={VIEW_H - M}
                stroke="var(--line)"
                strokeDasharray="2 4"
              />
              <line
                x1={M}
                y1={Y(0)}
                x2={VIEW_W - M}
                y2={Y(0)}
                stroke="var(--line)"
                strokeDasharray="2 4"
              />

              {sheet.ghosts.map((ghost) =>
                ghost.solids
                  .filter((geo) => !geo.isVoid)
                  .map((geo) => {
                    const rect = solidRect(geo);
                    return rect ? (
                      <rect
                        key={`${ghost.typeName}:${geo.slug}`}
                        {...{ x: rect.x, y: rect.y, width: rect.w, height: rect.h }}
                        fill="none"
                        stroke="var(--slate)"
                        strokeWidth={0.75}
                        opacity={0.22}
                      />
                    ) : null;
                  }),
              )}

              {sheet.solids.map((geo) => {
                const rect = solidRect(geo);
                if (!rect) return null;
                const id = `s:${geo.slug}`;
                const active = hovered === id;
                if (view.key === "plan" && geo.isCyl && geo.w != null)
                  return (
                    <circle
                      key={geo.slug}
                      cx={X(0)}
                      cy={Y(0)}
                      r={(geo.w / 2) * scale}
                      fill={geo.isVoid ? "none" : "var(--clay-ink)"}
                      fillOpacity={geo.isVoid ? 0 : 0.07}
                      stroke={active ? "var(--pe-blue)" : "var(--clay-ink)"}
                      strokeWidth={active ? 1.8 : 1}
                      strokeDasharray={geo.isVoid ? "4 3" : undefined}
                      opacity={dimIf(id)}
                      onMouseEnter={() => onHover(id)}
                    />
                  );
                return (
                  <rect
                    key={geo.slug}
                    {...{ x: rect.x, y: rect.y, width: rect.w, height: rect.h }}
                    fill={geo.isVoid ? "none" : "var(--clay-ink)"}
                    fillOpacity={geo.isVoid ? 0 : 0.07}
                    stroke={hovered === id ? "var(--pe-blue)" : "var(--clay-ink)"}
                    strokeWidth={hovered === id ? 1.8 : 1}
                    strokeDasharray={geo.isVoid ? "4 3" : undefined}
                    opacity={dimIf(id)}
                    onMouseEnter={() => onHover(id)}
                  />
                );
              })}

              {sheet.planes.map((plane) => {
                if (!plane.axis || plane.offset == null) return null;
                const id = `pl:${plane.slug}`;
                const overridden =
                  plane.param != null && model.types[typeName]?.[plane.param] != null;
                const stroke = overridden ? "var(--pe-blue)" : "var(--lichen)";
                let line: { x1: number; y1: number; x2: number; y2: number } | null = null;
                if (plane.axis === view.u)
                  line = { x1: X(plane.offset), y1: M, x2: X(plane.offset), y2: VIEW_H - M };
                else if (plane.axis === view.v)
                  line = { x1: M, y1: Y(plane.offset), x2: VIEW_W - M, y2: Y(plane.offset) };
                if (!line) return null;
                return (
                  <g
                    key={plane.slug}
                    opacity={dimIf(id)}
                    onMouseEnter={() => onHover(id)}
                    onPointerDown={dragPlane(plane)}
                    style={{
                      cursor: plane.editable
                        ? plane.axis === view.u
                          ? "ew-resize"
                          : "ns-resize"
                        : undefined,
                    }}
                  >
                    <line {...line} stroke="transparent" strokeWidth={11} />
                    <line {...line} stroke={stroke} strokeWidth={hovered === id ? 2 : 1.1} />
                    {view.key !== "plan" && plane.axis === "z" && (
                      <text x={line.x1 + 3} y={line.y1 - 3} fontSize={8} fill={stroke}>
                        {plane.slug} {plane.text}
                      </text>
                    )}
                    {plane.axis !== "z" && plane.axis === view.u && (
                      <text x={line.x1 + 3} y={M + 8} fontSize={8} fill={stroke}>
                        {plane.slug}
                      </text>
                    )}
                  </g>
                );
              })}

              {sheet.conns.map((conn) => {
                const id = `c:${conn.slug}`;
                const color = DOMAIN_COLOR[conn.domain] ?? "var(--slate)";
                const normal = NORMAL_RE.exec(conn.normal);
                if (!normal) return null;
                const [, signText, axisText] = normal;
                const axis = axisText.toLowerCase() as Axis;
                const sign = signText === "-" ? -1 : 1;
                const u = conn.pos[view.u];
                const v = conn.pos[view.v];
                if (u == null || v == null) return null;
                const shared = { opacity: dimIf(id), onMouseEnter: () => onHover(id) };
                if (axis === view.depth) {
                  if (conn.shape === "Round" && conn.w != null)
                    return (
                      <circle
                        key={conn.slug}
                        cx={X(u)}
                        cy={Y(v)}
                        r={(conn.w / 2) * scale}
                        fill={color}
                        fillOpacity={0.14}
                        stroke={color}
                        strokeWidth={hovered === id ? 2 : 1.2}
                        {...shared}
                      />
                    );
                  if (conn.w != null && conn.h != null)
                    return (
                      <rect
                        key={conn.slug}
                        x={X(u - conn.w / 2)}
                        y={Y(v + conn.h / 2)}
                        width={conn.w * scale}
                        height={conn.h * scale}
                        fill={color}
                        fillOpacity={0.14}
                        stroke={color}
                        strokeWidth={hovered === id ? 2 : 1.2}
                        {...shared}
                      />
                    );
                  return null;
                }
                const stubLen = conn.stub ?? 3;
                const dir = sign * (conn.stubDir === "In" ? -1 : 1);
                const size = conn.w ?? 2;
                const isU = axis === view.u;
                const tip = isU ? X(u + dir * stubLen) : Y(v + dir * stubLen);
                const base = isU ? X(u) : Y(v);
                return (
                  <g key={conn.slug} {...shared}>
                    {isU ? (
                      <>
                        <line
                          x1={base}
                          y1={Y(v)}
                          x2={tip}
                          y2={Y(v)}
                          stroke={color}
                          strokeWidth={hovered === id ? 2.4 : 1.6}
                        />
                        <line
                          x1={base}
                          y1={Y(v - size / 2)}
                          x2={base}
                          y2={Y(v + size / 2)}
                          stroke={color}
                          strokeWidth={hovered === id ? 2.4 : 1.6}
                        />
                      </>
                    ) : (
                      <>
                        <line
                          x1={X(u)}
                          y1={base}
                          x2={X(u)}
                          y2={tip}
                          stroke={color}
                          strokeWidth={hovered === id ? 2.4 : 1.6}
                        />
                        <line
                          x1={X(u - size / 2)}
                          y1={base}
                          x2={X(u + size / 2)}
                          y2={base}
                          stroke={color}
                          strokeWidth={hovered === id ? 2.4 : 1.6}
                        />
                      </>
                    )}
                  </g>
                );
              })}

              {sheet.rcp && sheet.rcp[view.u] != null && sheet.rcp[view.v] != null && (
                <g opacity={dimIf("rcp")} onMouseEnter={() => onHover("rcp")}>
                  <line
                    x1={X(0)}
                    y1={Y(0)}
                    x2={X(sheet.rcp[view.u] as number)}
                    y2={Y(sheet.rcp[view.v] as number)}
                    stroke="var(--kiln)"
                    strokeDasharray="1.5 3"
                  />
                  <circle
                    cx={X(sheet.rcp[view.u] as number)}
                    cy={Y(sheet.rcp[view.v] as number)}
                    r={3.5}
                    fill="var(--kiln)"
                  />
                </g>
              )}

              <text x={M} y={VIEW_H - 4} fontSize={8} fill="var(--slate)" className="tele-label">
                {view.label}
              </text>
            </svg>
          </div>
        );
      })}
    </div>
  );
}

/** Relationship caption — the authored reference chain of whatever is hovered. */
function Caption({
  model,
  typeName,
  hovered,
  usedBy,
}: {
  model: FamilyModel;
  typeName: string;
  hovered: string | null;
  usedBy: Record<string, string[]>;
}) {
  const line = (() => {
    if (!hovered)
      return "hover anything — drawing, card, plane, or matrix cell — to read its authored reference chain";
    const [kind, slug] = [
      hovered.slice(0, hovered.indexOf(":")),
      hovered.slice(hovered.indexOf(":") + 1),
    ];
    const users = usedBy[hovered]?.join(" · ");
    if (hovered === "rcp")
      return `roomCalculationPoint · authored surface is exactly { enabled: true } · rendered at the fixed PE convention (12in, ${model.family.placement === "Unhosted" ? "+Z" : "−Y"})`;
    if (kind === "s") {
      const solid = model.solids?.[slug];
      const dims = (["width", "depth", "height", "diameter"] as const)
        .filter((field) => solid?.[field])
        .map((field) => `${field} ${solid?.[field]}`)
        .join(" · ");
      return `solid ${slug} · ${solid?.kind} · ${dims}${users ? ` · faces used by ${users}` : ""}`;
    }
    if (kind === "pl") {
      const plane = model.planes?.[slug];
      return `plane ${slug} · from ${plane?.from} · by ${plane?.by} (${resolveParam(model, typeName, paramRef(plane?.by) ?? "").text}) · ${plane?.direction}${users ? ` · used by ${users}` : ""}`;
    }
    if (kind === "c") {
      const connector = model.connectors?.[slug];
      const frame = model.frames?.[connector?.frame.slice("frame:".length) ?? ""];
      const origin = frame ? frame.origin.join(" ∩ ") : connector?.frame;
      return `connector ${slug} · ${connector?.domain}/${connector?.shape} · origin = ${origin} · ${
        connector?.diameter
          ? `Ø ${connector.diameter}`
          : `${connector?.width} × ${connector?.height}`
      }${connector?.stub ? ` · stub ${connector.stub.direction} ${connector.stub.depth}` : ""}`;
    }
    return hovered;
  })();
  return (
    <p className="mt-2 min-h-8 rounded-[2px] border border-[var(--line-soft)] bg-[var(--paper-2)]/40 px-2 py-1.5 font-mono text-[10px] leading-relaxed text-[var(--slate)]">
      {line}
    </p>
  );
}

// ── editable register (cards under the triptych) ────────────────────────────────────────────────
function DimChip({
  label,
  raw,
  model,
  typeName,
  update,
  onLiteral,
}: {
  label: string;
  raw: string | undefined;
  model: FamilyModel;
  typeName: string;
  update: Update;
  onLiteral?: (next: string) => void;
}) {
  const dim = resolveDim(model, typeName, raw);
  if (!dim) return null;
  const editable = dim.source !== "formula" && (dim.param != null || onLiteral != null);
  return (
    <span
      className="inline-flex items-center gap-1 rounded-[2px] border border-[var(--line)] bg-[var(--paper-2)]/50 px-1 py-0.5"
      title={dim.param ? `param:${dim.param}` : "literal"}
    >
      <span className="tele-label text-[8px] text-[var(--slate)]">{label}</span>
      {editable ? (
        <EditableValue
          value={dim.text}
          onCommit={(next) =>
            dim.param
              ? update((current) =>
                  current.types[typeName]?.[dim.param as string] != null
                    ? setOverride(current, typeName, dim.param as string, next)
                    : setParamValue(current, dim.param as string, next),
                )
              : onLiteral?.(next)
          }
          className={`text-[10px] ${dim.source === "override" ? "text-[var(--pe-blue)]" : ""}`}
        />
      ) : (
        <span className="font-mono text-[10px] text-[var(--kiln)]">{dim.text}</span>
      )}
    </span>
  );
}

function RegisterCard({
  id,
  title,
  tag,
  hovered,
  onHover,
  accent,
  children,
}: {
  id: string;
  title: string;
  tag: string;
  hovered: string | null;
  onHover: (id: string | null) => void;
  accent?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="rounded-[2px] border p-2 transition-opacity"
      style={{
        borderColor: hovered === id ? "var(--pe-blue)" : "var(--line)",
        boxShadow: accent ? `inset 3px 0 0 ${accent}` : undefined,
        opacity: hovered && hovered !== id ? 0.45 : 1,
      }}
      onMouseEnter={() => onHover(id)}
      onMouseLeave={() => onHover(null)}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-[11px] font-semibold">{title}</span>
        <span className="tele-label text-[9px] text-[var(--slate)]">{tag}</span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1">{children}</div>
    </div>
  );
}

function AnatomySheet({
  model,
  typeName,
  update,
  hovered,
  onHover,
}: {
  model: FamilyModel;
  typeName: string;
  update: Update;
  hovered: string | null;
  onHover: (id: string | null) => void;
}) {
  const usedBy = useMemo(() => usedByIndex(model), [model]);
  const ghosts = Object.keys(model.types).filter((name) => name !== typeName);
  const formulaPlanes = planeGeos(model, typeName).filter((plane) => plane.offset == null);
  const unmodeled = model.unmodeled ?? [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <EditableValue
          value={model.family.name}
          onCommit={(next) =>
            update((current) => ({ ...current, family: { ...current.family, name: next } }))
          }
          className="text-sm font-semibold text-[var(--clay-ink)]"
        />
        <span className="tele-label text-[10px] text-[var(--slate)]">
          {model.family.category} · {model.family.template} · {model.family.placement}
        </span>
        {ghosts.length > 0 && (
          <span className="ml-auto text-[10px] text-[var(--slate)]">
            ghost outlines: {ghosts.join(" · ")} — same scale, for comparison
          </span>
        )}
      </div>

      <Triptych
        model={model}
        typeName={typeName}
        update={update}
        hovered={hovered}
        onHover={onHover}
      />
      <Caption model={model} typeName={typeName} hovered={hovered} usedBy={usedBy} />

      {formulaPlanes.length > 0 && (
        <div className="space-y-0.5">
          {formulaPlanes.map((plane) => (
            <p key={plane.slug} className="font-mono text-[10px] text-[var(--kiln)]">
              ─ ─ plane {plane.slug} · {plane.text}{" "}
              <span className="text-[var(--slate)]">
                (formula-driven — capture or build evidence to draw it)
              </span>
            </p>
          ))}
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {Object.entries(model.solids ?? {}).map(([slug, solid]) => (
          <RegisterCard
            key={slug}
            id={`s:${slug}`}
            title={slug}
            tag={solid.kind}
            hovered={hovered}
            onHover={onHover}
          >
            {(["width", "depth", "height", "diameter"] as const).map((field) => (
              <DimChip
                key={field}
                label={field === "diameter" ? "Ø" : field[0].toUpperCase()}
                raw={solid[field]}
                model={model}
                typeName={typeName}
                update={update}
                onLiteral={(next) => update((current) => setSolidDim(current, slug, field, next))}
              />
            ))}
          </RegisterCard>
        ))}
        {Object.entries(model.connectors ?? {}).map(([slug, connector]) => (
          <RegisterCard
            key={slug}
            id={`c:${slug}`}
            title={slug}
            tag={`${connector.domain} · ${connector.shape}`}
            hovered={hovered}
            onHover={onHover}
            accent={DOMAIN_COLOR[connector.domain] ?? "var(--slate)"}
          >
            <DimChip
              label="Ø"
              raw={connector.diameter}
              model={model}
              typeName={typeName}
              update={update}
            />
            <DimChip
              label="W"
              raw={connector.width}
              model={model}
              typeName={typeName}
              update={update}
            />
            <DimChip
              label="H"
              raw={connector.height}
              model={model}
              typeName={typeName}
              update={update}
            />
            {connector.stub && (
              <button
                type="button"
                onClick={() => update((current) => toggleStub(current, slug))}
                title="Stub direction — click to flip In/Out"
                className="rounded-[2px] border border-[var(--line)] px-1 py-0.5 font-mono text-[9px] hover:border-[var(--pe-blue)]"
              >
                stub {connector.stub.direction === "Out" ? "▸ Out" : "◂ In"}
              </button>
            )}
            {connector.systemType && (
              <span className="px-1 font-mono text-[9px] text-[var(--slate)]">
                {connector.systemType}
              </span>
            )}
          </RegisterCard>
        ))}
        {Object.entries(model.nestedFamilies ?? {}).map(([slug, spec]) => (
          <RegisterCard
            key={slug}
            id={`n:${slug}`}
            title={slug}
            tag={`nested · ${spec.family}`}
            hovered={hovered}
            onHover={onHover}
          >
            <div className="w-full space-y-0.5 font-mono text-[10px] text-[var(--slate)]">
              {spec.type && <div>type “{spec.type}”</div>}
              {Object.entries(spec.parameterBindings ?? {}).map(([target, source]) => (
                <div key={target}>
                  {target} ← <span className="text-[var(--pe-blue)]">{source}</span>
                </div>
              ))}
            </div>
          </RegisterCard>
        ))}
        {Object.entries(model.arrays ?? {}).map(([slug, spec]) => (
          <RegisterCard
            key={slug}
            id={`a:${slug}`}
            title={`${slug} ×2n−1`}
            tag={`${spec.kind} · ${spec.axis}`}
            hovered={hovered}
            onHover={onHover}
          >
            <div className="w-full space-y-0.5 font-mono text-[10px] text-[var(--slate)]">
              <div>
                member <span className="text-[var(--pe-blue)]">{spec.member}</span>
              </div>
              <div>
                half-count <span className="text-[var(--kiln)]">{spec.halfCount}</span>
              </div>
              {spec.limits && (
                <div>
                  limits {spec.limits.start} → {spec.limits.end}
                </div>
              )}
            </div>
          </RegisterCard>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-[var(--line-soft)] pt-2">
        <button
          type="button"
          onClick={() => update(toggleRcp)}
          onMouseEnter={() => onHover("rcp")}
          onMouseLeave={() => onHover(null)}
          className="rounded-[2px] border border-[var(--line)] px-1.5 py-0.5 font-mono text-[10px] hover:border-[var(--pe-blue)]"
          title='The entire authored surface is { "enabled": true } — direction and offset are the fixed PE convention'
        >
          roomCalculationPoint ·{" "}
          <span
            className={
              model.roomCalculationPoint?.enabled ? "text-[var(--pe-blue)]" : "text-[var(--slate)]"
            }
          >
            {model.roomCalculationPoint?.enabled ? "enabled" : "off"}
          </span>
        </button>
        {unmodeled.length === 0 ? (
          <span className="font-mono text-[10px] text-[var(--lichen)]">
            unmodeled ∅ — roundtrip equivalence claimable for this contract
          </span>
        ) : (
          <span className="font-mono text-[10px] text-[var(--clay-ink)]">
            unmodeled ×{unmodeled.length} — captured facts the schema cannot replay
          </span>
        )}
      </div>
    </div>
  );
}

// ── tiny shared UI ───────────────────────────────────────────────────────────────────────────────
function EditableValue({
  value,
  onCommit,
  className = "",
  title,
}: {
  value: string;
  onCommit: (next: string) => void;
  className?: string;
  title?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  if (draft == null)
    return (
      <button
        type="button"
        title={title ?? "Click to edit"}
        className={`cursor-text rounded-[2px] px-0.5 font-mono tabular-nums hover:bg-[var(--pe-blue)]/10 ${className}`}
        onClick={() => setDraft(value)}
      >
        {value}
      </button>
    );
  return (
    <input
      autoFocus
      value={draft}
      size={Math.max(4, draft.length)}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft.trim()) onCommit(draft.trim());
        setDraft(null);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") setDraft(null);
      }}
      className={`rounded-[2px] border border-[var(--pe-blue)] bg-[var(--paper)] px-0.5 font-mono tabular-nums outline-none ${className}`}
    />
  );
}

// ═══════════════════════════════════════ TYPE FLEX MATRIX ═══════════════════════════════════════
/** Field-state-aware matrix: each cell consults route:settings fields (by JSON Pointer)
 * so Pea proposals (dashed, with citation count), staged edits (solid green), and
 * attention marks render in place. Hovering a cited cell grounds it in the doc pane. */
function TypeMatrix({
  model,
  typeName,
  onType,
  update,
  fields,
  lane,
  onCite,
  onPin,
  onReview,
  onReviewMark,
  selectedParam,
  onSelectParam,
}: {
  model: FamilyModel;
  typeName: string;
  onType: (name: string) => void;
  update: Update;
  fields: Record<string, FieldState>;
  lane: Lane;
  onCite: (context: { label: string; sources: SettingsProposalSource[] } | null) => void;
  onPin: (context: { label: string; sources: SettingsProposalSource[] } | null) => void;
  onReview: (pointer: string, action: "approve" | "deny") => void;
  onReviewMark: (pointer: string, next: ReviewMarkState) => void;
  selectedParam: string | null;
  onSelectParam: (name: string | null) => void;
}) {
  const [newType, setNewType] = useState("");
  const typeNames = Object.keys(model.types);
  const groups: Array<[string, Record<string, ParamSpec>]> = [
    ...groupParameters("family", model.familyParameters),
    ...(model.sharedParameters ? groupParameters("shared", model.sharedParameters) : []),
  ];
  // ONE parameter source for every formula cell in the matrix — the authored model.
  const formulaParams = useMemo(
    () => authoredFormulaParams(model.familyParameters, model.sharedParameters),
    [model.familyParameters, model.sharedParameters],
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[11px]">
        <thead>
          <tr className="text-left">
            <th className="border-b border-[var(--line-2)] py-1 pr-3 font-normal">
              <span className="tele-label text-[10px] text-[var(--slate)]">parameter</span>
            </th>
            <th className="border-b border-[var(--line-2)] px-2 py-1 font-normal">
              <span className="tele-label text-[10px] text-[var(--kiln)]">= formula</span>
            </th>
            {/* A live family has no authored global — its types ARE the values. */}
            {lane.kind === "authored" && (
              <th className="border-b border-[var(--line-2)] px-2 py-1 text-right font-normal">
                <span className="tele-label text-[10px] text-[var(--slate)]">family value</span>
              </th>
            )}
            {typeNames.map((name) => {
              const overrides = Object.keys(model.types[name] ?? {}).length;
              const selected = name === typeName;
              return (
                <th
                  key={name}
                  className={`cursor-pointer border-b px-2 py-1 text-right font-semibold ${
                    selected
                      ? "border-[var(--pe-blue)] text-[var(--pe-blue)]"
                      : "border-[var(--line-2)] text-[var(--clay-ink)]"
                  }`}
                  onClick={() => onType(name)}
                  title={`${overrides} override${overrides === 1 ? "" : "s"} — click to flex all exhibits`}
                >
                  {name}
                  <span className="ml-1 font-normal text-[var(--slate)]">
                    {overrides > 0 ? overrides : "∅"}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {groups.map(([origin, specs]) => (
            <ParamRows
              key={origin}
              origin={origin}
              specs={specs}
              model={model}
              typeNames={typeNames}
              selected={typeName}
              update={update}
              fields={fields}
              lane={lane}
              formulaParams={formulaParams}
              onCite={onCite}
              onPin={onPin}
              onReview={onReview}
              onReviewMark={onReviewMark}
              selectedParam={selectedParam}
              onSelectParam={onSelectParam}
            />
          ))}
        </tbody>
      </table>
      {/* Adding a type authors the document; the live lane edits an OPEN family, whose
          type roster is Revit's to change. */}
      {lane.kind === "authored" && (
        <div className="mt-2 flex items-center gap-2">
          <input
            value={newType}
            onChange={(event) => setNewType(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && newType.trim()) {
                update((current) => addType(current, newType.trim()));
                setNewType("");
              }
            }}
            placeholder="New type name…"
            className="w-40 rounded-[2px] border border-[var(--line-2)] bg-transparent px-1.5 py-0.5 text-[11px] outline-none focus:border-[var(--pe-blue)]"
          />
          <span className="text-[10px] text-[var(--slate)]">
            Enter adds an empty type — empty types stay visible and preserved, by design.
          </span>
        </div>
      )}
    </div>
  );
}

function groupParameters(
  origin: string,
  specs: Record<string, ParamSpec>,
): Array<[string, Record<string, ParamSpec>]> {
  const grouped = new Map<string, Record<string, ParamSpec>>();
  for (const [name, spec] of Object.entries(specs)) {
    const label = spec.propertiesGroup?.trim() || "Other";
    grouped.set(label, { ...grouped.get(label), [name]: spec });
  }
  return [...grouped].map(([label, entries]) => [`${origin} · ${label}`, entries]);
}

/** One matrix cell's field decorations, derived from route:settings field state. */
function cellField(fields: Record<string, FieldState>, segments: string[]) {
  const pointer = settingsFieldPointer(segments);
  const field = fields[pointer];
  const staged = field?.staged != null;
  const proposal = !staged && field?.proposal != null ? field.proposal : null;
  const sources = (proposal?.sources ?? []) as SettingsProposalSource[];
  return { pointer, field, staged, proposal, sources, attention: field?.review === "attention" };
}

function ParamRows({
  origin,
  specs,
  model,
  typeNames,
  selected,
  update,
  fields,
  lane,
  formulaParams,
  onCite,
  onPin,
  onReview,
  onReviewMark,
  selectedParam,
  onSelectParam,
}: {
  origin: string;
  specs: Record<string, ParamSpec>;
  model: FamilyModel;
  typeNames: string[];
  selected: string;
  update: Update;
  fields: Record<string, FieldState>;
  lane: Lane;
  formulaParams: ReturnType<typeof authoredFormulaParams>;
  onCite: (context: { label: string; sources: SettingsProposalSource[] } | null) => void;
  onPin: (context: { label: string; sources: SettingsProposalSource[] } | null) => void;
  onReview: (pointer: string, action: "approve" | "deny") => void;
  onReviewMark: (pointer: string, next: ReviewMarkState) => void;
  selectedParam: string | null;
  onSelectParam: (name: string | null) => void;
}) {
  const section = origin.startsWith("shared") ? "sharedParameters" : "familyParameters";
  const leadColumns = lane.kind === "authored" ? 3 : 2;
  return (
    <>
      <tr>
        <td colSpan={leadColumns + typeNames.length} className="pt-2">
          <span className="tele-label text-[9px] text-[var(--lichen)]">{origin} parameters</span>
        </td>
      </tr>
      {Object.entries(specs).map(([name, spec]) => {
        const isFormula = spec.formula != null;
        const familyCell = cellField(fields, [section, name, "value"]);
        const pinned = selectedParam === name;
        return (
          <tr key={name} className="group/row border-b border-[var(--line-soft)]">
            <td className="max-w-48 py-1 pr-3">
              <button
                type="button"
                onClick={() => onSelectParam(pinned ? null : name)}
                title={`${spec.dataType} — click to inspect ancestry and associations`}
                className={`max-w-full truncate text-left ${
                  pinned ? "font-semibold text-[var(--pe-blue)]" : "hover:text-[var(--pe-blue)]"
                }`}
              >
                {name}
              </button>
              {isFormula && (
                <span className="ml-1 font-mono text-[10px] text-[var(--kiln)]">ƒ</span>
              )}
            </td>
            <td className="px-2 py-1">
              <FormulaCell
                paramName={name}
                formula={spec.formula}
                readOnly={spec.readOnly === true}
                hasTypeValues={typeNames.some((type) => model.types[type]?.[name] != null)}
                cell={cellField(fields, [section, name, "formula"])}
                params={formulaParams}
                advisory={lane.live?.advisory(name) ?? null}
                onCommit={(next) => {
                  update((current) => setParamFormula(current, name, next));
                  lane.live?.check(name, next);
                }}
                onReviewMark={onReviewMark}
              />
            </td>
            {lane.kind === "authored" && (
              <td className="px-2 py-1 text-right">
                {isFormula ? (
                  <span
                    className="font-mono text-[10px] text-[var(--kiln)]/60"
                    title="formula-driven — value XOR formula; clear the formula to author a value"
                  >
                    locked
                  </span>
                ) : (
                  <CellValue
                    value={spec.value ?? "—"}
                    cell={familyCell}
                    label={`${name} · family value`}
                    onCommit={(next) => update((current) => setParamValue(current, name, next))}
                    onCite={onCite}
                    onPin={onPin}
                    onReview={onReview}
                    onReviewMark={onReviewMark}
                  />
                )}
              </td>
            )}
            {typeNames.map((typeName) => {
              const override = model.types[typeName]?.[name];
              const highlight = typeName === selected ? "bg-[var(--pe-blue)]/5" : "";
              if (isFormula)
                return (
                  <td
                    key={typeName}
                    className={`px-2 py-1 text-right ${highlight}`}
                    title="formula-driven — the formula cell is the only editable one for this parameter"
                  >
                    <span className="font-mono text-[10px] text-[var(--kiln)]/60">
                      {spec.resolvedValues?.[typeName] ?? "locked"}
                    </span>
                  </td>
                );
              if (spec.readOnly)
                return (
                  <td
                    key={typeName}
                    className={`px-2 py-1 text-right ${highlight}`}
                    title="Revit reports this parameter read-only — an edit here would be refused"
                  >
                    <span className="font-mono text-[11px] text-[var(--slate)]/60">
                      {override ?? "—"}
                    </span>
                  </td>
                );
              const typeCell = cellField(fields, ["types", typeName, name]);
              return (
                <td key={typeName} className={`px-2 py-1 text-right ${highlight}`}>
                  {override != null ? (
                    <span className="inline-flex items-center gap-1">
                      <CellValue
                        value={override}
                        cell={typeCell}
                        label={`${name} · ${typeName}`}
                        onCommit={(next) =>
                          update((current) => setOverride(current, typeName, name, next))
                        }
                        onCite={onCite}
                        onPin={onPin}
                        onReview={onReview}
                        onReviewMark={onReviewMark}
                        strong
                      />
                      {/* Clearing an override reverts to the family value — a live family
                          has none, so there is nothing to revert to. */}
                      {lane.kind === "authored" && (
                        <button
                          type="button"
                          title="Clear override — revert to family value"
                          className="text-[var(--slate)] hover:text-[var(--fail)]"
                          onClick={() =>
                            update((current) => setOverride(current, typeName, name, null))
                          }
                        >
                          ×
                        </button>
                      )}
                    </span>
                  ) : typeCell.proposal != null ? (
                    <CellValue
                      value={
                        typeof typeCell.proposal.value === "string"
                          ? typeCell.proposal.value
                          : JSON.stringify(typeCell.proposal.value) || "—"
                      }
                      cell={typeCell}
                      label={`${name} · ${typeName}`}
                      onCommit={(next) =>
                        update((current) => setOverride(current, typeName, name, next))
                      }
                      onCite={onCite}
                      onPin={onPin}
                      onReview={onReview}
                      onReviewMark={onReviewMark}
                    />
                  ) : (
                    <button
                      type="button"
                      title="Inherited from family value — click to override"
                      className="rounded-[2px] border border-dashed border-transparent px-0.5 font-mono text-[11px] text-[var(--slate)]/70 hover:border-[var(--line-2)]"
                      onClick={() =>
                        update((current) => setOverride(current, typeName, name, spec.value ?? ""))
                      }
                    >
                      {spec.value ?? "—"}
                    </button>
                  )}
                </td>
              );
            })}
          </tr>
        );
      })}
    </>
  );
}

/** A value cell with trichotomy decoration: staged (solid green), open proposal
 * (dashed pea + ✓/✕ + citation count), attention (clay). HOVER grounds the citation in
 * the doc pane; CLICKING the citation badge PINS it there (Esc unpins, then deselects). */
function CellValue({
  value,
  cell,
  label,
  onCommit,
  onCite,
  onPin,
  onReview,
  onReviewMark,
  strong,
}: {
  value: string;
  cell: ReturnType<typeof cellField>;
  label: string;
  onCommit: (next: string) => void;
  onCite: (context: { label: string; sources: SettingsProposalSource[] } | null) => void;
  onPin: (context: { label: string; sources: SettingsProposalSource[] } | null) => void;
  onReview: (pointer: string, action: "approve" | "deny") => void;
  onReviewMark: (pointer: string, next: ReviewMarkState) => void;
  strong?: boolean;
}) {
  const tone = cell.attention
    ? "text-[var(--kiln)]"
    : cell.staged
      ? "text-[var(--lichen)] font-semibold"
      : cell.proposal
        ? "text-[var(--pe-blue)]"
        : strong
          ? "text-[var(--pe-blue)] font-semibold"
          : "";
  const wrap = cell.proposal
    ? "rounded-[2px] border border-dashed border-[var(--pe-blue)] bg-[var(--pe-blue)]/5 px-0.5"
    : cell.staged
      ? "rounded-[2px] border border-[var(--lichen)]/60 bg-[var(--lichen)]/5 px-0.5"
      : "";
  return (
    <span
      className={`inline-flex items-center gap-1 ${wrap}`}
      onMouseEnter={() =>
        cell.sources.length > 0
          ? onCite({ label: `${label} → ${value}`, sources: cell.sources })
          : null
      }
      onMouseLeave={() => (cell.sources.length > 0 ? onCite(null) : null)}
    >
      <EditableValue
        value={value}
        title={
          cell.staged
            ? `${label} · staged (unsaved)`
            : cell.proposal
              ? `${label} · proposed by pea${cell.proposal.note ? ` — ${cell.proposal.note}` : ""}`
              : label
        }
        onCommit={onCommit}
        className={`text-[11px] ${tone}`}
      />
      {cell.sources.length > 0 && (
        <button
          type="button"
          className="font-mono text-[9px] text-[var(--pe-blue)] hover:font-bold"
          title={`${cell.sources.length} document citation${cell.sources.length === 1 ? "" : "s"} — hover to ground, click to pin (Esc unpins)`}
          onClick={() => onPin({ label: `${label} → ${value}`, sources: cell.sources })}
        >
          ¶{cell.sources.length}
        </button>
      )}
      <ReviewMark
        review={reviewState(cell.field)}
        onCycle={(next) => onReviewMark(cell.pointer, next)}
      />
      {cell.proposal && (
        <>
          <button
            type="button"
            title="Accept proposal — stage it"
            className="text-[var(--lichen)] hover:font-bold"
            onClick={() => onReview(cell.pointer, "approve")}
          >
            ✓
          </button>
          <button
            type="button"
            title="Reject proposal"
            className="text-[var(--slate)] hover:text-[var(--fail)]"
            onClick={() => onReview(cell.pointer, "deny")}
          >
            ✕
          </button>
        </>
      )}
    </span>
  );
}

/* ── review mark: an orthogonal per-field tri-state, cycled by one click ──────────────────────── */

export type ReviewMarkState = "none" | "good" | "attention";

const NEXT_REVIEW: Record<ReviewMarkState, ReviewMarkState> = {
  none: "good",
  good: "attention",
  attention: "none",
};

function reviewState(field: FieldState | undefined): ReviewMarkState {
  return field?.review === "good" || field?.review === "attention" ? field.review : "none";
}

/** none → good → attention → none. A human edit auto-writes "good"; this demotes it. */
function ReviewMark({
  review,
  onCycle,
}: {
  review: ReviewMarkState;
  onCycle: (next: ReviewMarkState) => void;
}) {
  const cycle = () => onCycle(NEXT_REVIEW[review]);
  if (review === "none")
    return (
      <button
        type="button"
        title="mark reviewed"
        onClick={cycle}
        className="size-2 shrink-0 rounded-full border border-[var(--line-2)] opacity-0 transition-opacity hover:opacity-100 focus:opacity-100 group-hover/row:opacity-60"
      />
    );
  const good = review === "good";
  return (
    <button
      type="button"
      title={good ? "reviewed · good (click to flag)" : "needs attention (click to clear)"}
      onClick={cycle}
      className="grid size-3 shrink-0 place-items-center rounded-full font-mono text-[8px] font-bold"
      style={{
        background: good
          ? "color-mix(in srgb, var(--lichen) 24%, transparent)"
          : "color-mix(in srgb, var(--kiln) 28%, transparent)",
        color: good ? "var(--lichen)" : "var(--kiln)",
      }}
    >
      {good ? "✓" : "!"}
    </button>
  );
}

/* ── @formula as a first-class cell ──────────────────────────────────────────────────────────── */

/**
 * The formula column. A formula-backed parameter's per-type value cells are locked (an
 * authoring-time error in the schema), but its FORMULA is always editable — this is the
 * only cell that can lift the lock. Client validation is ADVISORY: invalid-ref, cycle
 * (with the draft spliced into the graph), and type-refs-instance render as a clay dot
 * whose tooltip carries the problem text. Nothing here blocks staging; the host's
 * validate/save is the final word.
 *
 * In the LIVE lane the same clay dot also carries the host's own verdict: committing a
 * formula fires `family.editor.apply {dryRun:true}` for that one edit and the message
 * comes back as `advisory`. Advisory means advisory — it never blocks staging either.
 */
function FormulaCell({
  paramName,
  formula,
  readOnly,
  hasTypeValues,
  cell,
  params,
  advisory,
  onCommit,
  onReviewMark,
}: {
  paramName: string;
  formula: string | undefined;
  readOnly?: boolean;
  hasTypeValues: boolean;
  cell: ReturnType<typeof cellField>;
  params: ReturnType<typeof authoredFormulaParams>;
  advisory: string | null;
  onCommit: (next: string) => void;
  onReviewMark: (pointer: string, next: ReviewMarkState) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const text = formula ?? "";
  const problems: FormulaProblem[] = useMemo(() => {
    const subject = draft ?? text;
    const found = subject.trim() ? validateFormula({ paramName, draft: subject, params }) : [];
    const extra: FormulaProblem[] = [];
    if (subject.trim() && hasTypeValues)
      extra.push({
        kind: "invalid-ref",
        message: `"${paramName}" still carries per-type values — a formula-driven parameter cannot, so the host will reject one of them`,
      });
    // The host's dryRun verdict, surfaced on the same dot and named as the host's.
    if (advisory) extra.push({ kind: "invalid-ref", message: `Revit: ${advisory}` });
    return [...found, ...extra];
  }, [draft, text, paramName, params, hasTypeValues, advisory]);

  if (readOnly)
    return (
      <span
        className="font-mono text-[10px] text-[var(--slate)]/50"
        title="Revit reports this parameter read-only"
      >
        {formula ? `= ${formula}` : "—"}
      </span>
    );

  const tone = cell.staged
    ? "text-[var(--lichen)] font-semibold"
    : formula
      ? "text-[var(--kiln)]"
      : "text-[var(--slate)]/50";

  return (
    <span className="inline-flex items-center gap-1">
      {draft == null ? (
        <button
          type="button"
          title={
            formula
              ? `${paramName} · formula (click to edit)`
              : `${paramName} has no formula — click to author one`
          }
          onClick={() => setDraft(text)}
          className={`cursor-text rounded-[2px] px-0.5 font-mono text-[10px] hover:bg-[var(--kiln)]/10 ${tone}`}
        >
          {formula ? `= ${formula}` : "= …"}
        </button>
      ) : (
        <input
          autoFocus
          value={draft}
          size={Math.max(8, draft.length)}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            if (draft.trim() !== text.trim()) onCommit(draft);
            setDraft(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") setDraft(null);
          }}
          placeholder="Width + 2in"
          className={`rounded-[2px] border bg-[var(--paper)] px-0.5 font-mono text-[10px] outline-none ${
            problems.length > 0 ? "border-[var(--kiln)]" : "border-[var(--pe-blue)]"
          }`}
        />
      )}
      {problems.length > 0 && (
        <span
          className="size-1.5 shrink-0 rounded-full bg-[var(--kiln)]"
          title={problems.map((problem) => problem.message).join("\n")}
        />
      )}
      {(formula != null || cell.staged) && (
        <ReviewMark
          review={reviewState(cell.field)}
          onCycle={(next) => onReviewMark(cell.pointer, next)}
        />
      )}
    </span>
  );
}

// ═══════════════════════════════════════════ PAGE ═══════════════════════════════════════════════

const MINIMAL_TEMPLATE = (name: string) =>
  JSON.stringify(
    {
      family: {
        name,
        category: "Generic Models",
        template: "Generic Model",
        placement: "Unhosted",
      },
      familyParameters: {
        Width: { dataType: "Length (Common)", value: "24in" },
        Depth: { dataType: "Length (Common)", value: "18in" },
        Height: { dataType: "Length (Common)", value: "30in" },
      },
      types: { Standard: {} },
      solids: {
        body: {
          kind: "Prism",
          frame: "frame:family",
          width: "param:Width",
          depth: "param:Depth",
          height: "param:Height",
        },
      },
    },
    null,
    2,
  );

function parseModel(
  rawContent: string | undefined,
  fields: Record<string, FieldState>,
): FamilyModel | null {
  if (!rawContent) return null;
  try {
    const parsed = JSON.parse(rawContent) as Record<string, unknown>;
    delete parsed.$schema;
    // A schema-invalid or partial document (mid-authoring, agent proposal) must render,
    // not crash the route — default the collections the render tree iterates.
    parsed.family ??= { name: "", category: "", template: "", placement: "" };
    parsed.familyParameters ??= {};
    parsed.types ??= {};
    for (const [pointer, field] of Object.entries(fields)) {
      if (field.staged != null) {
        applyJsonEdit(parsed, settingsFieldSegments(pointer), field.staged);
      }
    }
    return parsed as unknown as FamilyModel;
  } catch {
    return null;
  }
}

function applyJsonEdit(
  root: Record<string, unknown>,
  segments: string[],
  edit: { value?: unknown; delete?: true },
) {
  let cursor = root;
  for (const segment of segments.slice(0, -1)) {
    const child = cursor[segment];
    if (child == null || typeof child !== "object" || Array.isArray(child)) cursor[segment] = {};
    cursor = cursor[segment] as Record<string, unknown>;
  }
  if (segments.length === 0) return;
  const leaf = segments.at(-1)!;
  if (edit.delete === true) delete cursor[leaf];
  else cursor[leaf] = edit.value;
}

type JsonEdit = { value: unknown } | { delete: true };

function changedLeaves(
  before: unknown,
  after: unknown,
  prefix: string[] = [],
): Array<[string[], JsonEdit]> {
  if (Object.is(before, after)) return [];
  if (
    before != null &&
    after != null &&
    typeof before === "object" &&
    typeof after === "object" &&
    !Array.isArray(before) &&
    !Array.isArray(after)
  ) {
    const keys = new Set([
      ...Object.keys(before as Record<string, unknown>),
      ...Object.keys(after as Record<string, unknown>),
    ]);
    return [...keys].flatMap((key) =>
      changedLeaves(
        (before as Record<string, unknown>)[key],
        (after as Record<string, unknown>)[key],
        [...prefix, key],
      ),
    );
  }
  if (prefix.length === 0) return [];
  return [[prefix, after === undefined ? { delete: true } : { value: after }]];
}

/** Inject formula resolved values from evidence into the model for the preview. */
function withEvidence(model: FamilyModel, evidence: EvidenceSlice | null): FamilyModel {
  if (!evidence) return model;
  const next = structuredClone(model);
  for (const parameter of evidence.parameters) {
    const spec = next.familyParameters[parameter.name] ?? next.sharedParameters?.[parameter.name];
    if (!spec?.formula) continue;
    spec.resolvedValues = {};
    for (const [typeName, resolved] of Object.entries(parameter.valuesPerType)) {
      if (resolved.value != null) spec.resolvedValues[typeName] = resolved.value;
    }
  }
  return next;
}

function Page({
  store,
  lane,
  liveEntry,
  onPickLane,
}: {
  store: FamilyStore;
  lane: Lane;
  /** The synthetic doc-slot entry that binds the live lane, or null when none is offered. */
  liveEntry?: string | null;
  onPickLane?: (live: boolean) => void;
}) {
  const live = lane.live;
  const [mode, setMode] = useState<"full" | "parameters">("full");
  const [selectedType, setSelectedType] = useState<string>("");
  const [hovered, setHovered] = useState<string | null>(null);
  const [cite, setCite] = useState<{ label: string; sources: SettingsProposalSource[] } | null>(
    null,
  );
  /** A PINNED citation outranks hover, and survives the pointer leaving the cell. */
  const [pinnedCite, setPinnedCite] = useState<{
    label: string;
    sources: SettingsProposalSource[];
  } | null>(null);
  const [liveFailures, setLiveFailures] = useState<LiveApplyFailure[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<{ text: string; atMs: number } | null>(null);
  const [lastSave, setLastSave] = useState<{ saved: number; failed: number } | null>(null);
  const [selectedParam, setSelectedParam] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);

  const snapshot = store.snapshot;
  const isFamilyDocument = snapshot != null;
  const fields = store.fields;
  const model = useMemo(
    () => parseModel(snapshot?.rawContent, fields),
    [snapshot?.rawContent, fields],
  );

  const evidence: EvidenceSlice | null = store.evidence;
  const evidenceFresh =
    evidence != null &&
    (evidence.from.documentVersionToken == null ||
      evidence.from.documentVersionToken === snapshot?.versionToken);
  const previewModel = useMemo(
    () => (model ? withEvidence(model, evidence) : null),
    [model, evidence],
  );

  const typeName =
    model && Object.hasOwn(model.types, selectedType)
      ? selectedType
      : (Object.keys(model?.types ?? {})[0] ?? "");

  // ── target: bound selector; resolution now lives inside the sentence's world slot ──
  const boundTarget = store.boundTarget;
  /** The doc slot lists the authored documents AND, when offered, the live entry.
   * Picking one IS picking the lane — there is no separate control. */
  const documents = useMemo(
    () => (liveEntry ? [liveEntry, ...store.documents] : store.documents),
    [liveEntry, store.documents],
  );

  /** Every dispatcher write settles the same way: error text and the `hint` teaching
   * channel are distinct, and both are surfaced verbatim. */
  const settle = (result: { ok: boolean; error?: string; hint?: string }, fallback: string) => {
    setError(result.ok ? null : (result.error ?? fallback));
    setHint(result.ok ? null : (result.hint ?? null));
    return result.ok;
  };

  /** Binding IS the lane choice: the live entry binds the live lane, a path binds authored. */
  const pickDocument = async (relativePath: string) => {
    if (liveEntry && relativePath === liveEntry) {
      onPickLane?.(true);
      return;
    }
    onPickLane?.(false);
    setBusy("open");
    settle(
      await store.settingsCommand("open", {
        documentId: { ...FAMILY_MODULE, relativePath },
        target: boundTarget || undefined,
      }),
      "Could not open document.",
    );
    setBusy(null);
  };

  const createDocument = async (name: string) => {
    const relativePath = name.trim().replace(/\s+/g, "-").toLowerCase();
    if (!relativePath) return;
    setBusy("create");
    const ok = settle(
      await store.settingsCommand("create", {
        documentId: { ...FAMILY_MODULE, relativePath },
        rawContent: MINIMAL_TEMPLATE(name.trim()),
        target: boundTarget || undefined,
      }),
      "Could not create document.",
    );
    if (ok) store.refreshDocuments();
    setBusy(null);
  };

  // ── edits: diff → JSON Pointer patches into route:settings fields ─────────
  const update: Update = (fn) => {
    if (!model) return;
    const next = fn(model);
    const patches = changedLeaves(model, next).flatMap(([segments, edit]) => {
      const pointer = settingsFieldPointer(segments);
      return [
        { path: ["fields", pointer, "staged"], value: edit },
        { path: ["fields", pointer, "review"], value: "good" },
      ];
    });
    if (patches.length > 0) void store.applyFields(patches);
  };

  const review = (pointer: string, action: "approve" | "deny") => {
    const field = fields[pointer];
    if (action === "approve" && field?.proposal != null) {
      const edit =
        field.proposal.delete === true ? { delete: true } : { value: field.proposal.value };
      void store.applyFields([
        { path: ["fields", pointer, "staged"], value: edit },
        { path: ["fields", pointer, "review"], value: "good" },
      ]);
    } else {
      void store.applyFields([
        { path: ["fields", pointer, "proposal"] },
        { path: ["fields", pointer, "review"], value: "none" },
      ]);
    }
  };

  /** acceptAll — stage every OPEN proposal in one write; already-staged fields are skipped
   * so a human's own edit is never overwritten by a batch accept. */
  const acceptAll = () => {
    const patches = Object.entries(fields)
      .filter(([, field]) => field.staged == null && field.proposal != null)
      .flatMap(([pointer, field]) => [
        {
          path: ["fields", pointer, "staged"],
          value:
            field.proposal!.delete === true ? { delete: true } : { value: field.proposal!.value },
        },
        { path: ["fields", pointer, "review"], value: "good" },
      ]);
    if (patches.length > 0) void store.applyFields(patches);
  };

  /** The tri-state review toggle writes a review patch BESIDE the staged edit. */
  const markReview = (pointer: string, next: ReviewMarkState) => {
    void store.applyFields([{ path: ["fields", pointer, "review"], value: next }]);
  };

  const run = async (name: "validate" | "save") => {
    setBusy(name);
    const result = await store.settingsCommand(
      name,
      name === "validate"
        ? { includeProposals: false, target: boundTarget || undefined }
        : { target: boundTarget || undefined },
    );
    const ok = settle(result, `${name} failed.`);
    if (name === "save") {
      const outcome = (result.result ?? {}) as {
        saved?: number;
        failures?: Array<{ key: string; error: string }>;
      };
      const saved = ok ? (outcome.saved ?? 0) : 0;
      const failed = outcome.failures?.length ?? (ok ? 0 : stagedCount);
      setLastSave({ saved, failed });
      if (ok && saved > 0) {
        setReceipt({
          text: `saved ${saved} field${saved === 1 ? "" : "s"} to ${snapshot?.documentId.relativePath ?? "the document"}`,
          atMs: Date.now(),
        });
      }
    }
    setBusy(null);
  };

  /** LIVE save: family.editor.apply. Per-edit failure is REAL here — the receipt reports
   * per-edit outcomes and every failed edit stays staged, so it can be fixed and retried. */
  const runLiveSave = async () => {
    if (!live) return;
    setBusy("save");
    setError(null);
    setHint(null);
    const outcome = await live.save();
    setLastSave({ saved: outcome.saved, failed: outcome.failed });
    setLiveFailures(outcome.failures);
    if (outcome.saved > 0)
      setReceipt({
        text: `applied ${outcome.saved} edit${outcome.saved === 1 ? "" : "s"} to ${live.familyName ?? "the family"}`,
        atMs: Date.now(),
      });
    if (live.error) setError(live.error);
    setBusy(null);
  };

  const discardStaged = async () => {
    const patches = Object.keys(fields).flatMap((pointer) => [
      { path: ["fields", pointer, "staged"] },
      { path: ["fields", pointer, "review"], value: "none" },
    ]);
    if (patches.length > 0) await store.applyFields(patches);
    setLiveFailures([]);
    if (live) live.refresh();
    else await store.settingsCommand("refresh", { target: boundTarget || undefined });
  };

  const captureEvidence = async () => {
    setBusy("capture");
    settle(await store.familyCommand("capture_evidence", {}), "Capture failed.");
    setBusy(null);
  };

  /**
   * CAPTURE IS THE BRIDGE. In the live lane the capture verb PROMOTES: read the live
   * family (revit.detail.family-model, via capture_evidence's modelJson), write it as a
   * new authored document, and let `create`'s own open bind it — so the user lands in the
   * authored lane of the same family, with one receipt on the sentence.
   */
  const captureToDocument = async () => {
    setBusy("capture");
    const captured = await store.familyCommand("capture_evidence", {
      target: boundTarget || undefined,
    });
    if (!settle(captured, "Capture failed.")) return setBusy(null);
    const result = (captured.result ?? {}) as { familyName?: string; modelJson?: string };
    if (!result.modelJson) {
      setError("Capture returned no model — nothing to promote.");
      return setBusy(null);
    }
    const name = result.familyName ?? live?.familyName ?? "captured-family";
    const relativePath = `captured/${name.trim().replace(/\s+/g, "-").toLowerCase()}.family.json`;
    const created = await store.settingsCommand("create", {
      documentId: { ...FAMILY_MODULE, relativePath },
      rawContent: result.modelJson,
      target: boundTarget || undefined,
    });
    if (settle(created, "Could not write the captured document.")) {
      store.refreshDocuments();
      onPickLane?.(false); // `create` opens what it wrote — follow it into the authored lane.
      setReceipt({ text: `captured ${name} to ${relativePath}`, atMs: Date.now() });
    }
    setBusy(null);
  };

  const buildEvidence = async () => {
    if (!snapshot) return;
    setBusy("build");
    settle(
      await store.familyCommand("build_evidence", { documentId: snapshot.documentId }),
      "Build failed.",
    );
    setBusy(null);
  };

  const parseSpec = async (input: { url?: string; file?: File }) => {
    setParsing(true);
    setError(null);
    try {
      if (input.file || input.url) {
        // Client-side parse: the endpoint lives on this origin, so both file uploads and
        // URLs go direct — the host-side parse_spec command can't reach the web server.
        const form = new FormData();
        if (input.file) form.append("file", input.file);
        else form.append("url", input.url!);
        const response = await fetch("/api/pdf-audit/parse", { method: "POST", body: form });
        const payload = (await response.json()) as {
          error?: string;
          jobId?: string;
          fileName?: string;
          blocks?: Array<{ id: string; page: number; kind: string; md: string }>;
          images?: Array<{ id: string; page: number; category: string }>;
        };
        if (!response.ok || payload.error) throw new Error(payload.error ?? "parse failed");
        await store.setSpecDoc({
          parseId: payload.jobId,
          fileName: payload.fileName,
          blocks: (payload.blocks ?? []).map(({ id, page, kind, md }) => ({ id, page, kind, md })),
          images: (payload.images ?? []).map(({ id, page, category }) => ({ id, page, category })),
        });
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setParsing(false);
    }
  };

  // ── grounding: hover context or constituent citations ─────────────────────
  const { grounding } = useFamilyGrounding(store.doc?.parseId);
  const hoveredParams = model ? constituentParams(model, hovered) : [];
  const constituentCite = useMemo(() => {
    if (!model || hoveredParams.length === 0) return null;
    for (const name of hoveredParams) {
      for (const segments of [
        ["familyParameters", name, "value"],
        ["types", typeName, name],
      ]) {
        const pointer = settingsFieldPointer(segments);
        const sources = (fields[pointer]?.proposal?.sources ?? []) as SettingsProposalSource[];
        if (sources.length > 0) return { label: `${name} (via ${hovered})`, sources };
      }
    }
    return null;
  }, [model, hoveredParams, typeName, fields, hovered]);
  /** GROUNDING FOCUS: a pin outranks hover, which outranks a hovered constituent. */
  const activeCite = pinnedCite ?? cite ?? constituentCite;
  const citations: CitationTarget[] = useMemo(
    () => resolveCitations(grounding, activeCite?.sources).resolved,
    [grounding, activeCite],
  );
  const unresolvedCitations = useMemo(
    () => resolveCitations(grounding, activeCite?.sources).unresolved,
    [grounding, activeCite],
  );

  const stagedFields = Object.values(fields).filter((field) => field.staged != null);
  const stagedCount = stagedFields.length;
  const attentionCount = stagedFields.filter((field) => field.review === "attention").length;
  const proposalCount = Object.values(fields).filter(
    (field) => field.staged == null && field.proposal != null,
  ).length;
  const showDocPane = mode === "parameters" || store.doc != null || parsing;

  /* ── client-side save gate. The server stays the enforcer (route:settings `save`
     refuses any staged field marked "attention"); this only makes the refusal legible
     BEFORE the round trip, with the reason on the button. ── */
  const saveBlockedReason = !isFamilyDocument
    ? "no family document open"
    : stagedCount === 0
      ? "nothing staged"
      : attentionCount > 0
        ? `${attentionCount} field${attentionCount === 1 ? " needs" : "s need"} attention`
        : null;

  /* ── inspector: everything derived from the AUTHORED model, no host round trip ── */
  const formulaParams = useMemo(
    () => authoredFormulaParams(model?.familyParameters, model?.sharedParameters),
    [model?.familyParameters, model?.sharedParameters],
  );
  const inspected = useMemo(() => {
    if (!model || !selectedParam) return null;
    const spec = paramSpec(model, selectedParam);
    if (!spec) return null;
    return {
      spec,
      origin: (model.familyParameters[selectedParam] ? "family" : "shared") as "family" | "shared",
      ...formulaAncestry(selectedParam, formulaParams),
      associations: paramAssociations(model, selectedParam),
    };
  }, [model, selectedParam, formulaParams]);

  /* ── the sentence's family slot: LIVE lane only, because only there is "which family"
     a targeting choice the surface can make. Picking one opens it in the family editor. ── */
  const sentenceSlots: SlotSpec[] | undefined = useMemo(() => {
    if (!live) return undefined;
    return [
      {
        key: "family",
        joiner: "—",
        text: live.familyName,
        placeholder: "pick a family",
        options: live.families,
        onPick: (id) => void live.openFamily(id),
      },
    ];
  }, [live]);

  /* ── grounding focus reflex, grafted verbatim from /family-types: hover grounds, click
     pins, and Esc UNPINS FIRST, then deselects. One key, two steps, never both at once. ── */
  useEffect(() => {
    if (!selectedParam && !pinnedCite) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (pinnedCite) setPinnedCite(null);
      else setSelectedParam(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedParam, pinnedCite]);

  return (
    <main className="flex h-screen flex-col bg-[var(--paper)] text-[var(--foreground)]">
      {/* ── control bar ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--line)] bg-[var(--paper)]/95 px-4 py-2">
        <span className="tele-label text-[10px] tracking-[0.3em] text-[var(--clay-ink)]">
          FAMILY
        </span>
        {/* THE sentence — doc + world slots stay clickable; staged counts feed the status prefix */}
        <Sentence
          prefix={
            proposalCount > 0
              ? `reviewing ${proposalCount} proposal${proposalCount === 1 ? "" : "s"} on`
              : "editing"
          }
          prefixTone={proposalCount > 0 ? "awaiting" : "rest"}
          documentLabel={
            lane.kind === "live" ? (liveEntry ?? null) : (snapshot?.documentId.relativePath ?? null)
          }
          documents={documents}
          onPickDocument={(path) => void pickDocument(path)}
          slots={sentenceSlots}
          target={boundTarget}
          onBind={(selector) => {
            // The settings slice runs the document commands; it needs the same session
            // binding as the family slice or FamilyFoundry module discovery fails.
            void store.familyCommand("bind", { target: selector });
            void store.settingsCommand("bind", { target: selector });
          }}
          busy={busy != null}
          receipt={receipt}
        />
        {/* The lane is DISPLAYED, never toggled — binding is the choice. */}
        <span
          className="tele-label shrink-0 text-[9px] text-[var(--slate)]"
          title={
            lane.kind === "live"
              ? "editing the family open in the bound session's family editor — save applies to Revit"
              : "editing an authored family.json — save writes the document"
          }
        >
          {lane.chip}
        </span>
        {lane.kind === "authored" && <NewDocument onCreate={createDocument} busy={busy != null} />}
        <span className="mx-1 h-4 w-px bg-[var(--line-2)]" />

        {model && (
          <>
            <span className="tele-label text-[9px] text-[var(--slate)]">flex</span>
            {Object.keys(model.types).map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => setSelectedType(name)}
                className={`rounded-[2px] px-1.5 py-0.5 font-mono text-[10px] ${
                  name === typeName
                    ? "bg-[var(--pe-blue)] text-white"
                    : "text-[var(--slate)] hover:bg-[var(--pe-blue)]/10"
                }`}
              >
                {name}
              </button>
            ))}
            <span className="mx-1 h-4 w-px bg-[var(--line-2)]" />
          </>
        )}

        {/* Anatomy is authored truth — a live family has no authored constituents to draw. */}
        {lane.kind === "authored" && (
          <button
            type="button"
            onClick={() => setMode(mode === "full" ? "parameters" : "full")}
            className="rounded-[2px] border border-[var(--line)] px-2 py-0.5 text-[10px] text-[var(--slate)] hover:border-[var(--pe-blue)]"
            title="Parameters-only mode: hide the anatomy sheet, give the matrix and spec sheet the full page"
          >
            {mode === "full" ? "parameters only" : "full anatomy"}
          </button>
        )}
        {live && (
          <button
            type="button"
            disabled={live.reading}
            onClick={() => live.refresh()}
            title="Re-read the family from the family editor"
            className="rounded-[2px] border border-[var(--line)] px-2 py-0.5 text-[10px] text-[var(--slate)] disabled:opacity-40"
          >
            {live.reading ? "reading…" : "refresh"}
          </button>
        )}

        <span className="ml-auto" />
        {proposalCount > 0 && (
          <>
            <span className="font-mono text-[10px] text-[var(--pe-blue)]">
              {proposalCount} open proposal{proposalCount === 1 ? "" : "s"}
            </span>
            <button
              type="button"
              onClick={acceptAll}
              title="Stage every open proposal — fields you have already staged are left alone"
              className="rounded-[2px] border border-[var(--pe-blue)] px-2 py-0.5 text-[10px] text-[var(--pe-blue)] hover:bg-[var(--pe-blue)]/10"
            >
              accept all
            </button>
          </>
        )}
        {stagedCount > 0 && (
          <button
            type="button"
            onClick={() => void discardStaged()}
            className="rounded-[2px] border border-[var(--line)] px-2 py-0.5 text-[10px] text-[var(--fail)] hover:border-[var(--fail)]"
          >
            discard {stagedCount}
          </button>
        )}
        {/* validate is the DOCUMENT's schema check — a live family has no document. */}
        {lane.kind === "authored" && (
          <button
            type="button"
            disabled={!isFamilyDocument || busy != null}
            onClick={() => void run("validate")}
            className="rounded-[2px] border border-[var(--line)] px-2 py-0.5 text-[10px] text-[var(--slate)] disabled:opacity-40"
          >
            validate
          </button>
        )}
        <button
          type="button"
          disabled={saveBlockedReason != null || busy != null}
          onClick={() => void (live ? runLiveSave() : run("save"))}
          title={
            saveBlockedReason ??
            (live
              ? `Apply ${stagedCount} staged edit(s) to the open family`
              : `Save ${stagedCount} staged field(s)`)
          }
          className="rounded-[2px] bg-[var(--pe-blue)] px-2 py-0.5 text-[10px] text-white disabled:opacity-40"
        >
          {live ? "apply" : "save"} {stagedCount || ""}
        </button>
        <span className="mx-1 h-4 w-px bg-[var(--line-2)]" />
        {/* CAPTURE IS THE BRIDGE: evidence in the authored lane, promotion in the live one. */}
        <button
          type="button"
          disabled={busy != null}
          onClick={() => void (live ? captureToDocument() : captureEvidence())}
          title={
            live
              ? "Capture this live family as a new authored family.json and open it — the bridge into the authored lane"
              : "Read the family open in the bound Revit session into evidence"
          }
          className="rounded-[2px] border border-[var(--line)] px-2 py-0.5 text-[10px] text-[var(--slate)] disabled:opacity-40"
        >
          {live ? "capture → doc" : "capture"}
        </button>
        {/* build proves a SAVED authored revision; there is no such revision in the live lane. */}
        {lane.kind === "authored" && (
          <button
            type="button"
            disabled={!isFamilyDocument || busy != null || stagedCount > 0}
            onClick={() => void buildEvidence()}
            title={
              stagedCount > 0
                ? "Save staged edits first — builds prove the saved revision"
                : "Build the saved document to an .rfa and refresh evidence"
            }
            className="rounded-[2px] border border-[var(--line)] px-2 py-0.5 text-[10px] text-[var(--slate)] disabled:opacity-40"
          >
            build
          </button>
        )}
        {/* target chip retired here — the sentence's world slot is the binding control */}
        <RvtChip target={boundTarget} />
        <RfaChip target={boundTarget} />
        <ThemeToggle />
      </div>

      {/* ── status strip ────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--line-soft)] px-4 py-1 text-[10px] text-[var(--slate)]">
        {live ? (
          <>
            <span>
              family:{" "}
              <strong className="text-[var(--clay-ink)]">
                {live.familyName ?? (live.reading ? "reading…" : "none read")}
              </strong>
            </span>
            <span title="When this snapshot was read — the live family may have moved on since.">
              read {readAgo(live.readAtMs) ?? "—"}
            </span>
          </>
        ) : (
          <>
            <span>
              document:{" "}
              <strong className="text-[var(--clay-ink)]">
                {isFamilyDocument ? snapshot?.documentId.relativePath : "none open"}
              </strong>
            </span>
            <span>version: {snapshot?.versionToken ?? "—"}</span>
            <span>
              validation:{" "}
              {snapshot?.validation
                ? snapshot.validation.isValid
                  ? "valid"
                  : `${snapshot.validation.issues.length} issue(s)`
                : "not run"}
            </span>
          </>
        )}
        {evidence && !live && (
          <span
            className={evidenceFresh ? "text-[var(--lichen)]" : "text-[var(--kiln)]"}
            title={
              evidenceFresh
                ? `Evidence from ${evidence.from.origin} of ${evidence.from.familyName} at ${evidence.from.capturedAt}`
                : "Evidence was produced from an older revision of this document — build again to refresh"
            }
          >
            evidence: {evidence.from.origin} · {evidence.parameters.length} params ·{" "}
            {evidenceFresh ? "fresh" : "STALE"}
          </span>
        )}
        {saveBlockedReason && stagedCount > 0 && (
          <span className="text-[var(--kiln)]">Save blocked · {saveBlockedReason}</span>
        )}
        {lastSave && busy == null && (
          <span className={lastSave.failed > 0 ? "text-[var(--kiln)]" : "text-[var(--lichen)]"}>
            Saved {lastSave.saved}
            {lastSave.failed > 0 ? ` · ${lastSave.failed} failed` : ""}
          </span>
        )}
        {/* A live apply fails PER EDIT — name each one; those edits are still staged. */}
        {liveFailures.length > 0 && busy == null && (
          <span
            className="text-[var(--kiln)]"
            title={liveFailures.map((failure) => `${failure.label}: ${failure.error}`).join("\n")}
          >
            still staged: {liveFailures.map((failure) => failure.label).join(" · ")}
          </span>
        )}
        {error && <span className="text-[var(--fail)]">{error}</span>}
        {/* The dispatcher's `hint` is a teaching channel, distinct from the error text. */}
        {hint && <span className="text-[var(--kiln)]">hint: {hint}</span>}
        {store.isMock && (
          <span className="text-[var(--slate)]">?mock — fixture store, no host</span>
        )}
      </div>

      {/* ── body ────────────────────────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-y-auto px-4 py-3">
          {!model ? (
            <div className="grid h-full place-items-center text-sm text-[var(--slate)]">
              <div className="text-center">
                {live ? (
                  <>
                    <p>{live.reading ? "Reading the open family…" : "No family read yet."}</p>
                    <p className="mt-1 text-[11px]">
                      Pick a family in the sentence, or refresh to re-read the family editor.
                    </p>
                  </>
                ) : (
                  <>
                    <p>Open a family document, or create one to start.</p>
                    <p className="mt-1 text-[11px]">
                      Pea shares this exact document — ask it to capture the active Revit family or
                      draft one from a spec sheet.
                    </p>
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {lane.kind === "authored" && mode === "full" && previewModel && (
                <AnatomySheet
                  model={previewModel}
                  typeName={typeName}
                  update={update}
                  hovered={hovered}
                  onHover={setHovered}
                />
              )}
              <TypeMatrix
                model={previewModel ?? model}
                typeName={typeName}
                onType={setSelectedType}
                update={update}
                fields={fields}
                lane={lane}
                onCite={setCite}
                onPin={setPinnedCite}
                onReview={review}
                onReviewMark={markReview}
                selectedParam={selectedParam}
                onSelectParam={setSelectedParam}
              />
              <details className="rounded-[2px] border border-[var(--line)] bg-[var(--paper-2)]/40 px-3 py-2">
                <summary className="tele-label cursor-pointer text-[10px] text-[var(--clay-ink)]">
                  {live
                    ? "LIVE SNAPSHOT — what family.editor.snapshot returned, plus staged edits"
                    : "AUTHORED TRUTH — the family.json all exhibits are editing"}
                </summary>
                <pre className="mt-2 max-h-96 overflow-auto font-mono text-[10px] leading-4 text-[var(--slate)]">
                  {JSON.stringify(model, null, 2)}
                </pre>
              </details>
            </div>
          )}
        </div>

        {(showDocPane || inspected) && (
          <div className="flex w-[42%] min-w-[380px] shrink-0 flex-col">
            {showDocPane && (
              <div className="min-h-0 flex-1">
                <FamilyDocPane
                  grounding={grounding}
                  citations={citations}
                  unresolved={unresolvedCitations}
                  caption={activeCite?.label ?? null}
                  pinned={pinnedCite != null}
                  onUnpin={() => setPinnedCite(null)}
                  onParse={(input) => void parseSpec(input)}
                  parsing={parsing}
                />
              </div>
            )}
            {inspected && selectedParam && (
              <div className={showDocPane ? "h-[42%] min-h-0 shrink-0" : "min-h-0 flex-1"}>
                <FamilyInspector
                  paramName={selectedParam}
                  origin={inspected.origin}
                  dataType={inspected.spec.dataType}
                  formula={inspected.spec.formula}
                  isInstance={inspected.spec.isInstance}
                  dependsOn={inspected.dependsOn}
                  dependents={inspected.dependents}
                  associations={inspected.associations}
                  onSelect={setSelectedParam}
                  onClose={() => setSelectedParam(null)}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

function NewDocument({ onCreate, busy }: { onCreate: (name: string) => void; busy: boolean }) {
  const [name, setName] = useState("");
  return (
    <span className="inline-flex items-center gap-1">
      <input
        value={name}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && name.trim()) {
            onCreate(name.trim());
            setName("");
          }
        }}
        placeholder="new family name…"
        className="w-36 rounded-[2px] border border-[var(--line)] bg-transparent px-1.5 py-0.5 text-[11px] outline-none focus:border-[var(--pe-blue)]"
      />
      <button
        type="button"
        disabled={!name.trim() || busy}
        onClick={() => {
          onCreate(name.trim());
          setName("");
        }}
        className="rounded-[2px] border border-[var(--line)] px-1.5 py-0.5 text-[10px] hover:border-[var(--pe-blue)] disabled:opacity-40"
      >
        create
      </button>
    </span>
  );
}
