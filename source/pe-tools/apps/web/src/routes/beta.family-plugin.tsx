import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import { settingsRouteState, settingsFieldSegments } from "@pe/agent-contracts";
import { ThemeToggle } from "#/components/ThemeToggle";
import { callHostDynamic } from "#/host/client";
import { useRouteState } from "#/workbench/route-state";
import { familyModelPlaneOffset, familyModelPrismFaceCoordinate } from "#/family-model/preview";

export const Route = createFileRoute("/beta/family-plugin")({ component: Page });

/* ------------------------------------------------------------------------------------------------
 * Family Model beta: a specialized projection over the shared settings document route.
 *   ANATOMY SHEET v2 · true-scale orthographic triptych (front/side/plan) drawn by the dumb
 *     evaluator — params → arithmetic → plane intersection → face lookup. No camera, no mesh,
 *     no guessed geometry. Ghost outlines compare the other types at the same scale.
 *   TYPE FLEX MATRIX · kept from round 1 (the keeper) — value/override/formula trichotomy.
 * One shared editable family.json drives both; Pea, disk, and this page share route:settings.
 * ---------------------------------------------------------------------------------------------- */

// ── model types (v1 authored shape, loosely typed for the POC) ──────────────────────────────────
interface ParamSpec {
  dataType: string;
  propertiesGroup?: string;
  resolvedValues?: Record<string, string>;
  value?: string;
  formula?: string;
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
  parameterBindings?: Record<string, string>;
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

// ── mock data: the two checked-in fixture profiles, verbatim ────────────────────────────────────
const SHOWCASE: FamilyModel = {
  family: {
    name: "PE Family Model Showcase",
    category: "Generic Models",
    template: "Generic Model",
    placement: "Unhosted",
  },
  familyParameters: {
    "Body Width": { dataType: "Length (Common)", value: "24in" },
    "Body Depth": { dataType: "Length (Common)", value: "18in" },
    "Body Height": { dataType: "Length (Common)", value: "30in" },
    "Top Diameter": { dataType: "Length (Common)", value: "8in" },
    "Top Height": { dataType: "Length (Common)", value: "4in" },
    "Slot Width": { dataType: "Length (Common)", value: "6in" },
    "Slot Depth": { dataType: "Length (Common)", value: "4in" },
    "Slot Height": { dataType: "Length (Common)", value: "12in" },
    "Core Diameter": { dataType: "Length (Common)", value: "3in" },
    "Core Height": { dataType: "Length (Common)", formula: "Body Height + Top Height" },
    "Return Elevation": { dataType: "Length (Common)", value: "15in" },
    "Pipe Elevation": { dataType: "Length (Common)", value: "8in" },
    "Electrical Elevation": { dataType: "Length (Common)", value: "20in" },
    "Round Duct Diameter": { dataType: "Length (Common)", value: "6in" },
    "Rect Duct Width": { dataType: "Length (Common)", value: "10in" },
    "Rect Duct Height": { dataType: "Length (Common)", value: "6in" },
    "Pipe Diameter": { dataType: "Length (Common)", value: "1in" },
    "Electrical Diameter": { dataType: "Length (Common)", value: "1in" },
    "Stub Depth": { dataType: "Length (Common)", value: "2in" },
  },
  types: {
    Compact: { "Body Width": "18in", "Body Depth": "14in", "Body Height": "24in" },
    Standard: {},
    Tall: { "Body Height": "42in", "Return Elevation": "24in", "Electrical Elevation": "32in" },
  },
  planes: {
    "return-elevation": {
      from: "plane:family.Bottom",
      by: "param:Return Elevation",
      direction: "Out",
    },
    "pipe-elevation": { from: "plane:family.Bottom", by: "param:Pipe Elevation", direction: "Out" },
    "electrical-elevation": {
      from: "plane:family.Bottom",
      by: "param:Electrical Elevation",
      direction: "Out",
    },
  },
  frames: {
    "supply-air": {
      origin: ["face:body.Top", "plane:family.CenterLR", "plane:family.CenterFB"],
      normal: "+Z",
      up: "+Y",
    },
    "return-air": {
      origin: ["face:body.Back", "plane:family.CenterLR", "plane:return-elevation"],
      normal: "+Y",
      up: "+Z",
    },
    condensate: {
      origin: ["face:body.Left", "plane:family.CenterFB", "plane:pipe-elevation"],
      normal: "+X",
      up: "+Z",
    },
    power: {
      origin: ["face:body.Right", "plane:family.CenterFB", "plane:electrical-elevation"],
      normal: "+X",
      up: "+Z",
    },
  },
  solids: {
    body: {
      kind: "Prism",
      frame: "frame:family",
      width: "param:Body Width",
      depth: "param:Body Depth",
      height: "param:Body Height",
    },
    "top-neck": {
      kind: "Cylinder",
      frame: "frame:family",
      diameter: "param:Top Diameter",
      height: "param:Top Height",
    },
    "access-slot": {
      kind: "VoidPrism",
      frame: "frame:family",
      width: "param:Slot Width",
      depth: "param:Slot Depth",
      height: "param:Slot Height",
    },
    "core-bore": {
      kind: "VoidCylinder",
      frame: "frame:family",
      diameter: "param:Core Diameter",
      height: "param:Core Height",
    },
  },
  connectors: {
    "supply-air": {
      domain: "Duct",
      frame: "frame:supply-air",
      shape: "Round",
      diameter: "param:Round Duct Diameter",
      stub: { depth: "param:Stub Depth", direction: "Out" },
      systemType: "SupplyAir",
      flowDirection: "Out",
    },
    "return-air": {
      domain: "Duct",
      frame: "frame:return-air",
      shape: "Rectangular",
      width: "param:Rect Duct Width",
      height: "param:Rect Duct Height",
      stub: { depth: "param:Stub Depth", direction: "In" },
      systemType: "ReturnAir",
      flowDirection: "In",
    },
    condensate: {
      domain: "Pipe",
      frame: "frame:condensate",
      shape: "Round",
      diameter: "param:Pipe Diameter",
      stub: { depth: "param:Stub Depth", direction: "In" },
      systemType: "Sanitary",
      flowDirection: "Out",
    },
    power: {
      domain: "Electrical",
      frame: "frame:power",
      shape: "Round",
      diameter: "param:Electrical Diameter",
      stub: { depth: "param:Stub Depth", direction: "Out" },
      systemType: "PowerBalanced",
    },
  },
  roomCalculationPoint: { enabled: true },
};

const GRD: FamilyModel = {
  family: {
    name: "PE GRD Supply",
    category: "Air Terminals",
    template: "Generic Model face based",
    placement: "FaceHosted",
  },
  familyParameters: {
    PE_M_Grd_OpenLength: { dataType: "Length (Common)", value: "24in" },
    PE_M_Grd_OpenWidth: { dataType: "Length (Common)", value: "12in" },
    "_opening half width": { dataType: "Length (Common)", formula: "PE_M_Grd_OpenWidth / 2" },
    "_vane spacing": { dataType: "Length (Common)", value: "3in" },
    "_show vanes": { dataType: "Integer", value: "1" },
    "_calc vane half count": {
      dataType: "Integer",
      formula: "if(_show vanes = 0, 0, roundup((PE_M_Grd_OpenWidth / 2) / _vane spacing))",
    },
  },
  types: {
    "No Vanes": { "_show vanes": "0" },
    "Single Vane": { PE_M_Grd_OpenWidth: "6in", "_vane spacing": "3in" },
    "Fifteen Vanes": { PE_M_Grd_OpenWidth: "30in", "_vane spacing": "2in" },
    "Thirty Seven Vanes": { PE_M_Grd_OpenWidth: "37in", "_vane spacing": "1in" },
  },
  planes: {
    "opening.Front": {
      from: "plane:family.CenterFB",
      by: "param:_opening half width",
      direction: "Out",
    },
    "opening.Back": {
      from: "plane:family.CenterFB",
      by: "param:_opening half width",
      direction: "In",
    },
  },
  nestedFamilies: {
    vane: {
      family: "dependency:vane",
      type: "type one",
      frame: "frame:family",
      parameterBindings: { "_vane length": "param:PE_M_Grd_OpenLength" },
    },
  },
  arrays: {
    vane: {
      kind: "CenteredLinear",
      member: "nested:vane",
      axis: "+Y",
      halfCount: "param:_calc vane half count",
      limits: { start: "plane:opening.Front", end: "plane:opening.Back" },
    },
  },
  roomCalculationPoint: { enabled: true },
};

const PROFILES = {
  showcase: SHOWCASE,
  grd: GRD,
} as const;
type ProfileKey = keyof typeof PROFILES;

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
    return {
      text: spec.resolvedValues?.[typeName] ?? `= ${spec.formula}`,
      source: "formula",
    };
  return { text: spec.value ?? "—", source: "value" };
}

/** Resolve a dimension field that is either a param ref or a portable literal. */
function resolveDim(model: FamilyModel, typeName: string, raw: string | undefined) {
  if (!raw) return null;
  const param = paramRef(raw);
  if (!param)
    return {
      label: raw,
      text: raw,
      source: "value" as ValueSource,
      param: null,
    };
  const resolved = resolveParam(model, typeName, param);
  return { label: raw, ...resolved, param };
}

// ── immutable edits ──────────────────────────────────────────────────────────────────────────────
type Update = (fn: (model: FamilyModel) => FamilyModel) => void;

const setParamValue = (model: FamilyModel, name: string, value: string): FamilyModel => {
  const section = model.familyParameters[name] ? "familyParameters" : "sharedParameters";
  const specs = model[section] ?? {};
  const spec = specs[name];
  if (!spec || spec.formula != null) return model; // value XOR formula — formula params are locked
  return { ...model, [section]: { ...specs, [name]: { ...spec, value } } };
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
// family.Bottom (FamilyModelLowerer emits On="@Bottom" + PositiveHeight). Faces resolve from that.
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
  if (!solid) return null;
  if (solid.w == null || solid.d == null || solid.h == null) return null;
  const coordinate = familyModelPrismFaceCoordinate(face, solid.w, solid.d, solid.h);
  if (!coordinate) return null;
  return { axis: coordinate.axis, value: coordinate.coordinate };
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
              {/* family datums — hairline crosses through origin */}
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

              {/* ghost types — same scale, outline only */}
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

              {/* solids — true scale, voids dashed */}
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

              {/* named planes — drawn in every view where they project as a line; draggable */}
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

              {/* connectors — face-on shows the true-size shape; edge-on shows the stub */}
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
                const shared = {
                  opacity: dimIf(id),
                  onMouseEnter: () => onHover(id),
                };
                if (axis === view.depth) {
                  // face-on: the connector face at true size
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
                // edge-on: stub + size tick along the normal
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

              {/* room calculation point — fixed PE convention, rendered honestly */}
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
      return "hover anything — drawing, card, or plane — to read its authored reference chain";
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
}: {
  model: FamilyModel;
  typeName: string;
  update: Update;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
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
        onHover={setHovered}
      />
      <Caption model={model} typeName={typeName} hovered={hovered} usedBy={usedBy} />

      {formulaPlanes.length > 0 && (
        <div className="space-y-0.5">
          {formulaPlanes.map((plane) => (
            <p key={plane.slug} className="font-mono text-[10px] text-[var(--kiln)]">
              ─ ─ plane {plane.slug} · {plane.text}{" "}
              <span className="text-[var(--slate)]">
                (formula-driven — web v1 does not evaluate, so it is not drawn)
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
            onHover={setHovered}
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
            onHover={setHovered}
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
            onHover={setHovered}
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
            onHover={setHovered}
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
          onMouseEnter={() => setHovered("rcp")}
          onMouseLeave={() => setHovered(null)}
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

function PluginCard({
  mvp,
  action,
  hint,
  children,
}: {
  mvp: string;
  action: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-[2px] border border-[var(--line)] bg-[var(--paper)] px-3 py-2.5 text-xs shadow-sm">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-semibold text-[var(--clay-ink)]">Family Model · {mvp}</span>
        <span className="tele-label text-[var(--lichen)]">{action}</span>
      </div>
      <div className="mt-2">{children}</div>
      <div className="mt-2 border-t border-[var(--line-soft)] pt-1.5 text-[10px] text-[var(--slate)]">
        {hint}
      </div>
    </div>
  );
}

function SectionIntro({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <p className="tele-label text-[11px] tracking-[0.22em] text-[var(--clay-ink)]">{title}</p>
      <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-[var(--slate)]">{children}</p>
    </div>
  );
}

// ═══════════════════════════════════════ TYPE FLEX MATRIX ═══════════════════════════════════════
function TypeMatrix({
  model,
  typeName,
  onType,
  update,
}: {
  model: FamilyModel;
  typeName: string;
  onType: (name: string) => void;
  update: Update;
}) {
  const [newType, setNewType] = useState("");
  const typeNames = Object.keys(model.types);
  const groups: Array<[string, Record<string, ParamSpec>]> = [
    ...groupParameters("family", model.familyParameters),
    ...(model.sharedParameters ? groupParameters("shared", model.sharedParameters) : []),
  ];

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[11px]">
        <thead>
          <tr className="text-left">
            <th className="border-b border-[var(--line-2)] py-1 pr-3 font-normal">
              <span className="tele-label text-[10px] text-[var(--slate)]">parameter</span>
            </th>
            <th className="border-b border-[var(--line-2)] px-2 py-1 text-right font-normal">
              <span className="tele-label text-[10px] text-[var(--slate)]">family value</span>
            </th>
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
            <FragmentRows
              key={origin}
              origin={origin}
              specs={specs}
              model={model}
              typeNames={typeNames}
              selected={typeName}
              update={update}
            />
          ))}
        </tbody>
      </table>
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

function FragmentRows({
  origin,
  specs,
  model,
  typeNames,
  selected,
  update,
}: {
  origin: string;
  specs: Record<string, ParamSpec>;
  model: FamilyModel;
  typeNames: string[];
  selected: string;
  update: Update;
}) {
  return (
    <>
      <tr>
        <td colSpan={2 + typeNames.length} className="pt-2">
          <span className="tele-label text-[9px] text-[var(--lichen)]">{origin} parameters</span>
        </td>
      </tr>
      {Object.entries(specs).map(([name, spec]) => {
        const isFormula = spec.formula != null;
        return (
          <tr key={name} className="border-b border-[var(--line-soft)]">
            <td className="max-w-48 truncate py-1 pr-3" title={spec.dataType}>
              {name}
              {isFormula && (
                <span className="ml-1 font-mono text-[10px] text-[var(--kiln)]">ƒ</span>
              )}
            </td>
            <td className="px-2 py-1 text-right">
              {isFormula ? (
                <span
                  className="font-mono text-[10px] text-[var(--kiln)]"
                  title="formula-driven — value XOR formula"
                >
                  = {spec.formula}
                </span>
              ) : (
                <EditableValue
                  value={spec.value ?? "—"}
                  onCommit={(next) => update((current) => setParamValue(current, name, next))}
                  className="text-[11px]"
                />
              )}
            </td>
            {typeNames.map((typeName) => {
              const override = model.types[typeName]?.[name];
              const highlight = typeName === selected ? "bg-[var(--pe-blue)]/5" : "";
              if (isFormula)
                return (
                  <td
                    key={typeName}
                    className={`px-2 py-1 text-right ${highlight}`}
                    title="formula-backed parameters cannot take per-type values (authoring-time error)"
                  >
                    <span className="font-mono text-[10px] text-[var(--kiln)]/60">locked</span>
                  </td>
                );
              return (
                <td key={typeName} className={`px-2 py-1 text-right ${highlight}`}>
                  {override != null ? (
                    <span className="inline-flex items-center gap-1">
                      <EditableValue
                        value={override}
                        title={`override · ${typeName}`}
                        onCommit={(next) =>
                          update((current) => setOverride(current, typeName, name, next))
                        }
                        className="text-[11px] font-semibold text-[var(--pe-blue)]"
                      />
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
                    </span>
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

// ═══════════════════════════════════════════ PAGE ═══════════════════════════════════════════════
interface FamilyModelEvidenceResponse {
  familyName: string;
  evidence: {
    typeNames: string[];
    parameters: Array<{
      name: string;
      valuesPerType: Record<string, { value: string | null }>;
    }>;
    diagnostics: unknown[];
  };
}

function modelWithResolvedEvidence(
  model: FamilyModel,
  evidence: FamilyModelEvidenceResponse | null,
): FamilyModel {
  if (!evidence) return model;
  const next = structuredClone(model);
  for (const parameter of evidence.evidence.parameters) {
    const spec = next.familyParameters[parameter.name] ?? next.sharedParameters?.[parameter.name];
    if (!spec?.formula) continue;
    spec.resolvedValues = {};
    for (const [typeName, resolved] of Object.entries(parameter.valuesPerType)) {
      if (resolved.value != null) spec.resolvedValues[typeName] = resolved.value;
    }
  }
  return next;
}

function routeFamilyModel(
  rawContent: string | undefined,
  fields: Record<string, { staged?: { value?: unknown; delete?: true } | null }>,
): FamilyModel | null {
  if (!rawContent) return null;
  try {
    const parsed = JSON.parse(rawContent) as Record<string, unknown>;
    delete parsed.$schema;
    for (const [path, field] of Object.entries(fields)) {
      if (field.staged != null) applyJsonEdit(parsed, settingsFieldSegments(path), field.staged);
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

function changedLeaves(before: unknown, after: unknown, prefix = ""): Array<[string, JsonEdit]> {
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
        prefix ? `${prefix}.${key}` : key,
      ),
    );
  }
  if (!prefix) return [];
  return [[prefix, after === undefined ? { delete: true } : { value: after }]];
}

function Page() {
  const route = useRouteState(settingsRouteState);
  const [profileKey, setProfileKey] = useState<ProfileKey>("showcase");
  const [models, setModels] = useState<Record<ProfileKey, FamilyModel>>({ ...PROFILES });
  const [evidence, setEvidence] = useState<FamilyModelEvidenceResponse | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedTypes, setSelectedTypes] = useState<Record<ProfileKey, string>>({
    showcase: "Standard",
    grd: "Fifteen Vanes",
  });
  const snapshot = route.slice?.snapshot;
  const isFamilyModelDocument =
    snapshot?.documentId.moduleKey === "FamilyFoundry" && snapshot.documentId.rootKey === "models";
  const sharedModel = useMemo(
    () =>
      isFamilyModelDocument
        ? routeFamilyModel(snapshot?.rawContent, route.slice?.fields ?? {})
        : null,
    [isFamilyModelDocument, route.slice?.fields, snapshot?.rawContent],
  );
  const model = sharedModel ?? models[profileKey];
  const previewModel = useMemo(() => modelWithResolvedEvidence(model, evidence), [evidence, model]);
  const typeName = selectedTypes[profileKey];
  const update: Update = (fn) => {
    const next = fn(model);
    if (!sharedModel) {
      setModels((state) => ({ ...state, [profileKey]: next }));
      return;
    }
    const patches = changedLeaves(sharedModel, next).flatMap(([path, edit]) => [
      { path: ["fields", path, "staged"], value: edit },
      { path: ["fields", path, "review"], value: "good" },
    ]);
    if (patches.length > 0) void route.apply(patches);
  };
  const setType = (name: string) => setSelectedTypes((state) => ({ ...state, [profileKey]: name }));
  const stagedCount = Object.values(route.slice?.fields ?? {}).filter(
    (field) => field.staged != null,
  ).length;
  const dirty = sharedModel ? stagedCount > 0 : model !== PROFILES[profileKey];

  useEffect(() => {
    if (!sharedModel) return;
    const nextKey: ProfileKey = sharedModel.family.name.includes("GRD") ? "grd" : "showcase";
    setProfileKey(nextKey);
    if (!Object.hasOwn(sharedModel.types, selectedTypes[nextKey]))
      setSelectedTypes((state) => ({
        ...state,
        [nextKey]: Object.keys(sharedModel.types)[0] ?? "",
      }));
  }, [sharedModel, selectedTypes]);

  const loadPreset = async (key: ProfileKey) => {
    setBusy(`preset:${key}`);
    setError(null);
    setProfileKey(key);
    const documentId = {
      moduleKey: "FamilyFoundry",
      rootKey: "models",
      relativePath: `beta/${key}`,
    };
    const opened = await route.command("open", { documentId });
    if (!opened.ok) {
      const created = await route.command("create", {
        documentId,
        rawContent: JSON.stringify(PROFILES[key], null, 2),
      });
      if (!created.ok) setError(created.error ?? created.hint ?? "Could not create preset.");
    }
    setBusy(null);
  };

  const run = async (name: "validate" | "save") => {
    setBusy(name);
    setError(null);
    const result = await route.command(
      name,
      name === "validate" ? { includeProposals: false } : {},
    );
    if (!result.ok) setError(result.error ?? result.hint ?? `${name} failed.`);
    setBusy(null);
  };

  const captureEvidence = async () => {
    setBusy("evidence");
    setError(null);
    try {
      setEvidence(
        (await callHostDynamic("revit.detail.family-model", {})) as FamilyModelEvidenceResponse,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Evidence capture failed.");
    } finally {
      setBusy(null);
    }
  };

  const discardStaged = async () => {
    const patches = Object.keys(route.slice?.fields ?? {}).flatMap((path) => [
      { path: ["fields", path, "staged"] },
      { path: ["fields", path, "review"], value: "none" },
    ]);
    if (patches.length > 0) await route.apply(patches);
    await route.command("refresh", {});
  };

  return (
    <main className="min-h-screen bg-[var(--paper)] text-[var(--foreground)]">
      <div className="mx-auto max-w-[1160px] px-5 py-6">
        <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="tele-label text-[10px] tracking-[0.3em] text-[var(--clay-ink)]">
              BETA / FAMILY MODEL
            </p>
            <h1 className="mt-1 text-xl font-semibold tracking-tight">
              One authored family, shared everywhere
            </h1>
            <p className="mt-2 max-w-3xl text-[13px] leading-relaxed text-[var(--slate)]">
              This specialized view is a projection over the same settings document Pea and disk
              editors use. The anatomy sheet, type matrix, raw JSON, validation, version token, and
              saved file all refer to one <code>FamilyFoundry/models</code> document.
            </p>
          </div>
          <ThemeToggle />
        </header>

        <div className="sticky top-0 z-10 mb-5 flex flex-wrap items-center gap-2 rounded-[2px] border border-[var(--line)] bg-[var(--paper)]/95 px-3 py-2 backdrop-blur">
          {(Object.keys(PROFILES) as ProfileKey[]).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => void loadPreset(key)}
              disabled={busy != null}
              className={`rounded-[2px] border px-2 py-0.5 text-[11px] ${
                key === profileKey
                  ? "border-[var(--clay-ink)] font-semibold text-[var(--clay-ink)]"
                  : "border-[var(--line)] text-[var(--slate)] hover:border-[var(--line-2)]"
              }`}
            >
              {PROFILES[key].family.name}
            </button>
          ))}
          <span className="mx-1 h-4 w-px bg-[var(--line-2)]" />
          <span className="tele-label text-[9px] text-[var(--slate)]">flex type</span>
          {Object.keys(model.types).map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => setType(name)}
              className={`rounded-[2px] px-1.5 py-0.5 font-mono text-[10px] ${
                name === typeName
                  ? "bg-[var(--pe-blue)] text-white"
                  : "text-[var(--slate)] hover:bg-[var(--pe-blue)]/10"
              }`}
            >
              {name}
            </button>
          ))}
          {dirty && (
            <button
              type="button"
              onClick={() =>
                sharedModel
                  ? void discardStaged()
                  : setModels((state) => ({ ...state, [profileKey]: PROFILES[profileKey] }))
              }
              className="ml-auto rounded-[2px] border border-[var(--line)] px-2 py-0.5 text-[10px] text-[var(--fail)] hover:border-[var(--fail)]"
            >
              discard staged edits
            </button>
          )}
          <button
            type="button"
            disabled={!sharedModel || busy != null}
            onClick={() => void run("validate")}
            className="rounded-[2px] border border-[var(--line)] px-2 py-0.5 text-[10px] text-[var(--slate)] disabled:opacity-40"
          >
            validate
          </button>
          <button
            type="button"
            disabled={!sharedModel || stagedCount === 0 || busy != null}
            onClick={() => void run("save")}
            className="rounded-[2px] bg-[var(--pe-blue)] px-2 py-0.5 text-[10px] text-white disabled:opacity-40"
          >
            save {stagedCount || ""}
          </button>
          <button
            type="button"
            disabled={busy != null}
            onClick={() => void captureEvidence()}
            className="rounded-[2px] border border-[var(--line)] px-2 py-0.5 text-[10px] text-[var(--slate)] disabled:opacity-40"
          >
            capture Revit evidence
          </button>
        </div>

        <div className="mb-4 flex flex-wrap gap-3 text-[10px] text-[var(--slate)]">
          <span>
            document:{" "}
            <strong className="text-[var(--clay-ink)]">
              {snapshot
                ? `${snapshot.documentId.moduleKey}/${snapshot.documentId.rootKey}/${snapshot.documentId.relativePath}`
                : "choose a preset to create or open"}
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
          {evidence ? (
            <span>evidence: {evidence.evidence.parameters.length} parameters</span>
          ) : null}
          {error ? <span className="text-[var(--fail)]">{error}</span> : null}
        </div>

        <section className="mb-8">
          <SectionIntro title="ANATOMY SHEET v2 — TRUE-SCALE TRIPTYCH">
            Front, side, and plan share one scale, so a 1in pipe connector reads as small as it is
            against a 24in body. Ghost outlines are the <i>other</i> types at the same scale — flex
            a type and watch the family breathe. Planes stay draggable (writing the driving
            parameter back as a type override); hover anything to read its authored reference chain
            in the caption; the cards below are the same objects, editable.
          </SectionIntro>
          <PluginCard
            mvp="anatomy"
            action="Review"
            hint="Every mark is authored state or plane-intersection arithmetic. Formula-driven geometry is listed, not guessed."
          >
            <AnatomySheet model={previewModel} typeName={typeName} update={update} />
          </PluginCard>
        </section>

        <section className="mb-8">
          <SectionIntro title="TYPE FLEX MATRIX — THE KEEPER">
            Unchanged from round 1. Inherited / override / formula-locked as visible cell states;
            value XOR formula never offered; empty types stay visible as ∅ columns. Click a type
            header to flex the triptych above.
          </SectionIntro>
          <PluginCard
            mvp="type flex"
            action="Review"
            hint="Edits stage into route:settings; save uses the shared version token and disk lifecycle."
          >
            <TypeMatrix model={model} typeName={typeName} onType={setType} update={update} />
          </PluginCard>
        </section>

        {evidence ? (
          <details className="mb-3 rounded-[2px] border border-[var(--line)] bg-[var(--paper-2)]/40 px-3 py-2">
            <summary className="tele-label cursor-pointer text-[10px] text-[var(--clay-ink)]">
              RESOLVED REVIT EVIDENCE — exact values used for formula-driven preview
            </summary>
            <pre className="mt-2 max-h-96 overflow-auto font-mono text-[10px] leading-4 text-[var(--slate)]">
              {JSON.stringify(evidence.evidence, null, 2)}
            </pre>
          </details>
        ) : null}

        <details className="mb-10 rounded-[2px] border border-[var(--line)] bg-[var(--paper-2)]/40 px-3 py-2">
          <summary className="tele-label cursor-pointer text-[10px] text-[var(--clay-ink)]">
            AUTHORED TRUTH — the family.json both exhibits are editing
          </summary>
          <pre className="mt-2 max-h-96 overflow-auto font-mono text-[10px] leading-4 text-[var(--slate)]">
            {JSON.stringify(model, null, 2)}
          </pre>
        </details>
      </div>
    </main>
  );
}
