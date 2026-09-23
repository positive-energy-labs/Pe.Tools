import { measuredValueSchema, showCellValue, type MeasuredValue } from "@pe/agent-contracts";

/**
 * The TS reading of the C# `FamilyModel` (`FamilyModelContracts.cs`): the shape `family.capture`
 * returns and an authored `family.json` holds. Loosely typed on purpose; the C# model validates.
 */

// ── the document shape ──────────────────────────────────────────────────────────────────────────

export interface ParamSpec {
  dataType?: string;
  shared?: boolean;
  sharedGuid?: string;
  sharedSpecId?: string;
  sharedVisible?: boolean;
  sharedUserModifiable?: boolean;
  tooltip?: string;
  propertiesGroup?: string;
  value?: string | number | boolean | MeasuredValue;
  formula?: string;
  /** Absent means TYPE (Revit's default). */
  isInstance?: boolean;
}

interface SketchCurveSpec {
  kind: string;
  on?: string;
  center?: string[];
  diameter?: string;
}

/** An `Extrusion` (what capture returns), or an authored `Prism`/`Cylinder` macro. */
export interface FormSpec {
  kind: string;
  void?: boolean;
  sketchPlane?: string;
  profile?: Array<{ curves: SketchCurveSpec[] }>;
  start?: string;
  end?: string;
  center?: string[];
  bottom?: string;
  width?: string;
  depth?: string;
  height?: string;
  diameter?: string;
}

export interface ConnectorSpec {
  domain: string;
  systemType?: string;
  on?: string;
  at?: string[];
  shape?: string;
  diameter?: string;
  width?: string;
  height?: string;
  flowDirection?: string;
}

export interface FamilyModel {
  family: { name: string; category: string; template: string; placement: string };
  /** Exact Revit name → declaration. Family and shared parameters share this map (`shared: true`). */
  parameters: Record<string, ParamSpec>;
  types: Record<string, Record<string, string | MeasuredValue>>;
  datums?: Record<string, { normal: string; isLevel?: boolean }>;
  refPlanes?: Record<string, { normal: string; at: string }>;
  refLines?: Record<string, unknown>;
  dimensions?: Record<
    string,
    { between: string[]; label?: string; equality?: boolean; locked?: string }
  >;
  forms?: Record<string, FormSpec>;
  nested?: Record<
    string,
    { family: string; type?: string; host: string; associate?: Record<string, string> }
  >;
  arrays?: Record<string, unknown>;
  connectors?: Record<string, ConnectorSpec>;
  coverage?: Record<string, string>;
  settings?: Record<string, unknown>;
  /** Revit's own size-table CSV, verbatim — `LookupTableCsvCodec` is the one codec. */
  lookupTables?: Record<string, { csv: string }>;
  unmodeled?: unknown[];
}

// ── portable-literal + reference helpers ────────────────────────────────────────────────────────

/** A portable length literal (`24in`, `2 1/2in`, `3ft`, `600mm`) in inches, or null. */
function inches(text: string | undefined): number | null {
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

export const paramSpec = (model: FamilyModel, name: string): ParamSpec | undefined =>
  model.parameters[name];

type ValueSource = "override" | "value" | "formula" | "missing";

/** PortableValue's boolean literals use Revit's Yes/No spelling; raw JSON remains untouched —
 *  a measured value reads with its unit; any other structured value is written back as JSON,
 *  never as `[object Object]`. */
export const parameterText = (value: unknown): string =>
  measuredValueSchema.safeParse(value).success
    ? showCellValue(value)
    : typeof value === "boolean"
      ? value
        ? "Yes"
        : "No"
      : typeof value === "string"
        ? value
        : value == null
          ? ""
          : JSON.stringify(value);

/** THE value trichotomy: type override → formula (resolved) → family value → missing. */
function resolveParam(
  model: FamilyModel,
  typeName: string,
  name: string,
): { text: string; source: ValueSource } {
  const override = model.types[typeName]?.[name];
  if (override != null) return { text: parameterText(override), source: "override" };
  const spec = paramSpec(model, name);
  if (!spec) return { text: "—", source: "missing" };
  if (spec.formula != null) return { text: `= ${spec.formula}`, source: "formula" };
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

// ── the dumb evaluator: planes → dimensions → form boxes → connector points ─────────────────────

export type Axis = "x" | "y" | "z";

interface Vec3 {
  x: number | null;
  y: number | null;
  z: number | null;
}

/** A form as an axis-aligned box. An axis the document does not pin to two positions is null. */
export interface SolidGeo {
  slug: string;
  kind: string;
  isVoid: boolean;
  isCyl: boolean;
  box: Record<Axis, [number, number] | null>;
}

interface PlaneGeo {
  slug: string;
  axis: Axis | null;
  offset: number | null;
  /** The parameter whose labeled dimension moved this plane at this type. */
  param: string | null;
  editable: boolean;
  text: string;
}

export interface ConnGeo {
  slug: string;
  domain: string;
  shape: string;
  pos: Vec3;
  normal: string;
  w: number | null;
  h: number | null;
}

interface DrivenDim {
  a: string;
  b: string;
  value: number;
  label: string | null;
}

const NORMAL = /^(Plus|Minus)?(X|Y|Z)$/;
const axisOf = (normal: string): Axis | null =>
  (NORMAL.exec(normal)?.[2].toLowerCase() as Axis | undefined) ?? null;

/**
 * Datums sit at 0 and reference planes start at their `at` seed. A labeled or locked two-plane
 * dimension then moves one end off a pinned plane, or both ends around the middle plane of its
 * equality dimension, so each type draws from its own numbers. A formula label does not resolve
 * here, so its planes keep their seeds.
 */
function planeGeos(model: FamilyModel, typeName: string): PlaneGeo[] {
  const planes = new Map<string, PlaneGeo>();
  for (const [slug, datum] of Object.entries(model.datums ?? {}))
    planes.set(slug, {
      slug,
      axis: axisOf(datum.normal),
      offset: 0,
      param: null,
      editable: false,
      text: "datum",
    });
  for (const [slug, plane] of Object.entries(model.refPlanes ?? {})) {
    const seed = inches(plane.at);
    planes.set(slug, {
      slug,
      axis: axisOf(plane.normal),
      offset: seed == null ? null : seed * (plane.normal.startsWith("Minus") ? -1 : 1),
      param: null,
      editable: false,
      text: `${plane.at} seed`,
    });
  }
  const seeds = new Map([...planes].map(([slug, plane]) => [slug, plane.offset ?? 0]));
  const dims = Object.values(model.dimensions ?? {});
  const middle = (a: string, b: string) =>
    dims.find(
      (dim) =>
        dim.equality &&
        dim.between.length === 3 &&
        ((dim.between[0] === a && dim.between[2] === b) ||
          (dim.between[0] === b && dim.between[2] === a)),
    )?.between[1];
  const pinned = new Set(Object.keys(model.datums ?? {}));
  const move = (slug: string, offset: number, label: string | null) => {
    const spec = label ? paramSpec(model, label) : undefined;
    planes.set(slug, {
      ...planes.get(slug)!,
      offset,
      param: label,
      editable: spec != null && spec.formula == null,
      text: label ? resolveParam(model, typeName, label).text : `${offset}in locked`,
    });
    pinned.add(slug);
  };
  /** True when the dimension is spent: placed, over-pinned, or not placeable at all. */
  const place = ({ a, b, value, label }: DrivenDim) => {
    const [A, B] = [planes.get(a), planes.get(b)];
    if (A?.offset == null || B?.offset == null || A.axis !== B.axis) return true;
    const sign = Math.sign(seeds.get(b)! - seeds.get(a)!) || 1;
    if (pinned.has(a) && pinned.has(b)) return true;
    if (pinned.has(a)) move(b, A.offset + sign * value, label);
    else if (pinned.has(b)) move(a, B.offset - sign * value, label);
    else {
      const m = middle(a, b);
      const center = m && pinned.has(m) ? planes.get(m)?.offset : null;
      if (center == null) return false;
      move(a, center - (sign * value) / 2, label);
      move(b, center + (sign * value) / 2, label);
    }
    return true;
  };
  let pending = dims.flatMap((dim): DrivenDim[] => {
    if (dim.equality || dim.between.length !== 2) return [];
    const value = dim.label ? evalLen(model, typeName, `param:${dim.label}`) : inches(dim.locked);
    const [a, b] = dim.between as [string, string];
    return value == null ? [] : [{ a, b, value, label: dim.label ?? null }];
  });
  while (pending.length > 0) {
    const next = pending.filter((dim) => !place(dim));
    // Nothing placed: no dimension has a pinned end, so hold the first end at its seed.
    if (next.length === pending.length) pinned.add(next[0]!.a);
    pending = next;
  }
  return [...planes.values()];
}

function solidGeos(model: FamilyModel, typeName: string, planes: PlaneGeo[]): SolidGeo[] {
  const at = (name: string | undefined) => planes.find((plane) => plane.slug === name);
  return Object.entries(model.forms ?? {}).map(([slug, form]) => {
    const extent: Record<Axis, number[]> = { x: [], y: [], z: [] };
    const push = (axis: Axis | null | undefined, ...values: Array<number | null | undefined>) => {
      if (axis) for (const value of values) if (value != null) extent[axis].push(value);
    };
    const curves = form.profile?.flatMap((loop) => loop.curves) ?? [];
    if (form.kind === "Extrusion") {
      for (const curve of curves) {
        if (curve.on) {
          const plane = at(curve.on);
          push(plane?.axis, plane?.offset);
          continue;
        }
        const diameter = evalLen(model, typeName, curve.diameter);
        for (const plane of (curve.center ?? []).map(at))
          if (plane?.offset != null && diameter != null)
            push(plane.axis, plane.offset - diameter / 2, plane.offset + diameter / 2);
      }
      // The extrusion spans two planes, or a length off its sketch plane.
      const sketch = at(form.sketchPlane);
      const cap = (ref: string | undefined) => {
        const plane = at(ref);
        if (plane) return plane;
        const length = evalLen(model, typeName, ref);
        return length == null || sketch?.offset == null
          ? undefined
          : { axis: sketch.axis, offset: sketch.offset + length };
      };
      const start = form.start ? cap(form.start) : sketch;
      const end = cap(form.end);
      if (start?.axis && start.axis === end?.axis) push(start.axis, start.offset, end.offset);
    } else {
      const size: Record<Axis, number | null> = {
        x: evalLen(model, typeName, form.width ?? form.diameter),
        y: evalLen(model, typeName, form.depth ?? form.diameter),
        z: null,
      };
      for (const plane of (form.center ?? []).map(at)) {
        const span = plane?.axis ? size[plane.axis] : null;
        if (plane?.offset != null && span != null)
          push(plane.axis, plane.offset - span / 2, plane.offset + span / 2);
      }
      const bottom = at(form.bottom);
      const height = evalLen(model, typeName, form.height);
      if (bottom?.offset != null && height != null)
        push(bottom.axis, bottom.offset, bottom.offset + height);
    }
    const range = (values: number[]): [number, number] | null => {
      const [lo, hi] = [Math.min(...values), Math.max(...values)];
      return values.length > 1 && hi > lo ? [lo, hi] : null;
    };
    return {
      slug,
      kind: form.kind,
      isVoid: form.void ?? false,
      isCyl: form.kind === "Cylinder" || curves.some((curve) => curve.kind === "Circle"),
      box: { x: range(extent.x), y: range(extent.y), z: range(extent.z) },
    };
  });
}

/** A connector sits where its `on` plane (or a form face, `body.top`) crosses its `at` planes. */
function connGeos(
  model: FamilyModel,
  typeName: string,
  planes: PlaneGeo[],
  solids: SolidGeo[],
): ConnGeo[] {
  return Object.entries(model.connectors ?? {})
    .filter(([, connector]) => connector.on)
    .map(([slug, connector]) => {
      const pos: Vec3 = { x: null, y: null, z: null };
      let normal = "";
      for (const ref of [connector.on!, ...(connector.at ?? [])]) {
        const plane = planes.find((p) => p.slug === ref);
        let axis = plane?.axis;
        let coordinate = plane?.offset;
        let direction = (model.refPlanes?.[ref] ?? model.datums?.[ref])?.normal;
        if (!plane) {
          const dot = ref.lastIndexOf(".");
          const box = solids.find((g) => g.slug === ref.slice(0, dot))?.box;
          const faces: Record<string, [Axis, number | undefined, string]> = {
            left: ["x", box?.x?.[0], "PlusX"],
            right: ["x", box?.x?.[1], "PlusX"],
            front: ["y", box?.y?.[0], "PlusY"],
            back: ["y", box?.y?.[1], "PlusY"],
            bottom: ["z", box?.z?.[0], "PlusZ"],
            top: ["z", box?.z?.[1], "PlusZ"],
          };
          [axis, coordinate, direction] = faces[ref.slice(dot + 1)] ?? [null, null, undefined];
        }
        if (axis) pos[axis] = coordinate ?? null;
        if (ref === connector.on)
          normal = direction?.replace("Plus", "+").replace("Minus", "-") ?? "";
      }
      const shape = connector.shape ?? (connector.diameter ? "Round" : "Unspecified");
      const diameter = evalLen(model, typeName, connector.diameter);
      return {
        slug,
        domain: connector.domain,
        shape,
        pos,
        normal,
        w: shape === "Round" ? diameter : evalLen(model, typeName, connector.width),
        h: shape === "Round" ? diameter : evalLen(model, typeName, connector.height),
      };
    });
}

export interface Sheet {
  solids: SolidGeo[];
  planes: PlaneGeo[];
  conns: ConnGeo[];
  ghosts: Array<{ typeName: string; solids: SolidGeo[] }>;
}

/** Everything the triptych draws for ONE type, plus the other types' solids as ghosts. */
export function buildSheet(model: FamilyModel, typeName: string): Sheet {
  const planes = planeGeos(model, typeName);
  const solids = solidGeos(model, typeName, planes);
  const conns = connGeos(model, typeName, planes, solids);
  const ghosts = Object.keys(model.types)
    .filter((name) => name !== typeName)
    .map((name) => ({ typeName: name, solids: solidGeos(model, name, planeGeos(model, name)) }));
  return { solids, planes, conns, ghosts };
}

/** One shared world bbox (incl. ghosts) → one px/in factor → true relative scale everywhere. */
export function sheetBounds(sheet: Sheet): Record<Axis, [number, number]> {
  const axes: Axis[] = ["x", "y", "z"];
  const extent: Record<Axis, number[]> = { x: [], y: [], z: [] };
  const solid = (geo: SolidGeo) => {
    for (const axis of axes) extent[axis].push(...(geo.box[axis] ?? []));
  };
  sheet.solids.forEach(solid);
  for (const ghost of sheet.ghosts) ghost.solids.forEach(solid);
  for (const plane of sheet.planes)
    if (plane.axis && plane.offset != null) extent[plane.axis].push(plane.offset);
  for (const conn of sheet.conns)
    for (const axis of axes) {
      const p = conn.pos[axis];
      if (p != null) extent[axis].push(p - 4, p + 4);
    }
  const range = (values: number[]): [number, number] => {
    if (values.length === 0) return [-12, 12];
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const pad = Math.max(3, (hi - lo) * 0.14);
    return [lo - pad, hi + pad];
  };
  return { x: range(extent.x), y: range(extent.y), z: range(extent.z) };
}
