import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";

import { ThemeToggle } from "#/components/ThemeToggle";

export const Route = createFileRoute("/poc/family-plugin")({ component: Page });

/* ------------------------------------------------------------------------------------------------
 * POC: three MVP variations of a Family Model chat plugin, judged on one page.
 *   MVP 1 — WIRING BOARD   · the reference micro-DSL drawn as a patch bay (relations)
 *   MVP 2 — TYPE FLEX MATRIX · value / override / formula trichotomy as visible state (state)
 *   MVP 3 — ANATOMY SHEET  · document-order ledger with draggable planes (taxonomy/grouping)
 * Self-contained, mock data = the two checked-in fixture profiles. Every exhibit reads AND writes
 * the same in-memory family.json; the selected type flexes all three at once (docs/target style).
 * ---------------------------------------------------------------------------------------------- */

// ── model types (v1 authored shape, loosely typed for the POC) ──────────────────────────────────
interface ParamSpec {
  dataType: string;
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
  if (spec.formula != null) return { text: `= ${spec.formula}`, source: "formula" };
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

// ════════════════════════════════════════ MVP 1 — WIRING BOARD ══════════════════════════════════
interface Node {
  id: string;
  col: number;
  title: string;
  sub: string;
  param?: string; // editable parameter name, when the node IS a parameter
}
interface Edge {
  from: string;
  to: string;
  kind: "param" | "plane" | "face" | "frame" | "nested";
}

const EDGE_COLOR: Record<Edge["kind"], string> = {
  param: "var(--pe-blue)",
  plane: "var(--lichen)",
  face: "var(--clay-ink)",
  frame: "var(--kiln)",
  nested: "var(--slate)",
};

const COLUMNS = ["parameters", "planes", "solids", "frames", "content"];

function buildGraph(model: FamilyModel): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const push = (edge: Edge | null) => edge && edges.push(edge);
  const paramEdge = (raw: string | undefined, to: string): Edge | null => {
    const name = raw ? paramRef(raw) : null;
    return name ? { from: `p:${name}`, to, kind: "param" } : null;
  };

  for (const [name, spec] of [
    ...Object.entries(model.familyParameters),
    ...Object.entries(model.sharedParameters ?? {}),
  ])
    nodes.push({
      id: `p:${name}`,
      col: 0,
      title: name,
      sub: spec.formula != null ? "ƒ formula" : (spec.value ?? ""),
      param: name,
    });

  for (const [slug, plane] of Object.entries(model.planes ?? {})) {
    nodes.push({
      id: `pl:${slug}`,
      col: 1,
      title: slug,
      sub: `${plane.from.replace("plane:", "")} · ${plane.direction}`,
    });
    push(paramEdge(plane.by, `pl:${slug}`));
  }

  for (const [slug, solid] of Object.entries(model.solids ?? {})) {
    nodes.push({ id: `s:${slug}`, col: 2, title: slug, sub: solid.kind });
    for (const field of ["width", "depth", "height", "diameter"] as const)
      push(paramEdge(solid[field], `s:${slug}`));
  }

  for (const [slug, frame] of Object.entries(model.frames ?? {})) {
    nodes.push({ id: `f:${slug}`, col: 3, title: slug, sub: `n ${frame.normal} · up ${frame.up}` });
    for (const origin of frame.origin) {
      if (origin.startsWith("face:"))
        push({ from: `s:${origin.slice(5).split(".")[0]}`, to: `f:${slug}`, kind: "face" });
      else if (origin.startsWith("plane:") && !origin.startsWith("plane:family."))
        push({ from: `pl:${origin.slice(6)}`, to: `f:${slug}`, kind: "plane" });
    }
  }

  for (const [slug, connector] of Object.entries(model.connectors ?? {})) {
    const id = `c:${slug}`;
    nodes.push({ id, col: 4, title: slug, sub: `${connector.domain} connector` });
    if (connector.frame !== "frame:family")
      push({ from: `f:${connector.frame.slice(6)}`, to: id, kind: "frame" });
    for (const raw of [
      connector.diameter,
      connector.width,
      connector.height,
      connector.stub?.depth,
      ...Object.values(connector.parameterBindings ?? {}),
    ])
      push(paramEdge(raw, id));
  }

  for (const [slug, nested] of Object.entries(model.nestedFamilies ?? {})) {
    const id = `n:${slug}`;
    nodes.push({ id, col: 4, title: slug, sub: `nested · ${nested.family.slice(11)}` });
    for (const raw of Object.values(nested.parameterBindings ?? {})) push(paramEdge(raw, id));
  }

  for (const [slug, arraySpec] of Object.entries(model.arrays ?? {})) {
    const id = `a:${slug}`;
    nodes.push({ id, col: 4, title: `${slug} ×`, sub: `${arraySpec.kind} · ${arraySpec.axis}` });
    push(paramEdge(arraySpec.halfCount, id));
    if (arraySpec.member.startsWith("nested:"))
      push({ from: `n:${arraySpec.member.slice(7)}`, to: id, kind: "nested" });
    for (const limit of [arraySpec.limits?.start, arraySpec.limits?.end])
      if (limit?.startsWith("plane:") && !limit.startsWith("plane:family."))
        push({ from: `pl:${limit.slice(6)}`, to: id, kind: "plane" });
  }

  return { nodes, edges };
}

/** Ancestors ∪ descendants of one node — NOT the connected component, which lights up everything. */
function cone(edges: Edge[], start: string): Set<string> {
  const walk = (direction: "up" | "down") => {
    const reached = new Set([start]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const edge of edges) {
        const [ahead, behind] = direction === "down" ? [edge.from, edge.to] : [edge.to, edge.from];
        if (reached.has(ahead) && !reached.has(behind)) {
          reached.add(behind);
          grew = true;
        }
      }
    }
    return reached;
  };
  return new Set([...walk("up"), ...walk("down")]);
}

const PAD = 10;
const COL_W = 190;
const COL_GAP = 26;
const NODE_H = 30;
const PITCH = 36;
const HEAD = 26;

function WiringBoard({
  model,
  typeName,
  update,
}: {
  model: FamilyModel;
  typeName: string;
  update: Update;
}) {
  const { nodes, edges } = useMemo(() => buildGraph(model), [model]);
  const [hover, setHover] = useState<string | null>(null);
  const lit = useMemo(() => (hover ? cone(edges, hover) : null), [edges, hover]);

  const byColumn = COLUMNS.map((_, col) => nodes.filter((node) => node.col === col));
  const position = new Map<string, { x: number; y: number }>();
  for (const [col, columnNodes] of byColumn.entries())
    for (const [idx, node] of columnNodes.entries())
      position.set(node.id, { x: PAD + col * (COL_W + COL_GAP), y: HEAD + idx * PITCH });

  const width = PAD * 2 + COLUMNS.length * COL_W + (COLUMNS.length - 1) * COL_GAP;
  const height = HEAD + Math.max(...byColumn.map((column) => column.length)) * PITCH + PAD;

  const editResolved = (name: string, next: string) =>
    update((current) =>
      current.types[typeName]?.[name] != null
        ? setOverride(current, typeName, name, next)
        : setParamValue(current, name, next),
    );

  return (
    <div className="overflow-x-auto">
      <div className="relative" style={{ width, height }}>
        <svg width={width} height={height} className="absolute inset-0" aria-hidden>
          {edges.map((edge) => {
            const from = position.get(edge.from);
            const to = position.get(edge.to);
            if (!from || !to) return null;
            const x1 = from.x + COL_W;
            const y1 = from.y + NODE_H / 2;
            const x2 = to.x;
            const y2 = to.y + NODE_H / 2;
            const bend = Math.max(30, (x2 - x1) / 2);
            const dim = lit && !(lit.has(edge.from) && lit.has(edge.to));
            return (
              <path
                key={`${edge.from}→${edge.to}`}
                d={`M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`}
                fill="none"
                stroke={EDGE_COLOR[edge.kind]}
                strokeWidth={dim ? 1 : 1.6}
                opacity={dim ? 0.12 : 0.75}
              />
            );
          })}
        </svg>
        {COLUMNS.map((label, col) => (
          <span
            key={label}
            className="tele-label absolute text-[10px] text-[var(--slate)]"
            style={{ left: PAD + col * (COL_W + COL_GAP), top: 2 }}
          >
            {label}
          </span>
        ))}
        {nodes.map((node) => {
          const spot = position.get(node.id);
          if (!spot) return null;
          const dim = lit && !lit.has(node.id);
          const resolved = node.param ? resolveParam(model, typeName, node.param) : null;
          return (
            <div
              key={node.id}
              onMouseEnter={() => setHover(node.id)}
              onMouseLeave={() => setHover(null)}
              className="absolute flex items-center justify-between gap-1 rounded-[2px] border bg-[var(--paper)] px-1.5"
              style={{
                left: spot.x,
                top: spot.y,
                width: COL_W,
                height: NODE_H,
                opacity: dim ? 0.28 : 1,
                borderColor:
                  hover === node.id
                    ? "var(--pe-blue)"
                    : resolved?.source === "override"
                      ? "color-mix(in srgb, var(--pe-blue) 55%, transparent)"
                      : "var(--line-2)",
              }}
            >
              <span className="truncate text-[11px] leading-none" title={node.title}>
                {node.title}
              </span>
              {resolved ? (
                resolved.source === "formula" ? (
                  <span
                    className="shrink-0 font-mono text-[10px] text-[var(--kiln)]"
                    title={resolved.text}
                  >
                    ƒ
                  </span>
                ) : (
                  <EditableValue
                    value={resolved.text}
                    title={
                      resolved.source === "override"
                        ? `override · ${typeName}`
                        : "family value — click to edit"
                    }
                    onCommit={(next) => node.param && editResolved(node.param, next)}
                    className={`shrink-0 text-[10px] ${resolved.source === "override" ? "text-[var(--pe-blue)]" : "text-[var(--slate)]"}`}
                  />
                )
              ) : (
                <span className="shrink-0 truncate font-mono text-[9px] text-[var(--slate)]">
                  {node.sub}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-[var(--slate)]">
        {(Object.keys(EDGE_COLOR) as Edge["kind"][]).map((kind) => (
          <span key={kind} className="inline-flex items-center gap-1.5">
            <span className="h-[2px] w-4" style={{ background: EDGE_COLOR[kind] }} />
            {kind}:
          </span>
        ))}
        <span className="ml-auto">hover a node to trace its dependency cone</span>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════ MVP 2 — TYPE FLEX MATRIX ═══════════════════════════════
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
    ["family", model.familyParameters],
    ...(model.sharedParameters ? [["shared", model.sharedParameters] as const] : []),
  ] as Array<[string, Record<string, ParamSpec>]>;

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

// ═══════════════════════════════════════ MVP 3 — ANATOMY SHEET ══════════════════════════════════
function PlaneRuler({
  model,
  typeName,
  update,
}: {
  model: FamilyModel;
  typeName: string;
  update: Update;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const planes = Object.entries(model.planes ?? {}).map(([slug, plane]) => {
    const param = paramRef(plane.by);
    const resolved = param ? resolveParam(model, typeName, param) : null;
    const value = resolved && resolved.source !== "formula" ? inches(resolved.text) : null;
    return { slug, plane, param, resolved, value };
  });
  const positioned = planes.filter((entry) => entry.value != null);
  const formulaPlanes = planes.filter((entry) => entry.value == null);
  const from = planes[0]?.plane.from.replace("plane:", "") ?? "family datum";

  const bodyHeight = inches(
    resolveDim(model, typeName, model.solids?.body?.height)?.text ?? undefined,
  );
  const maxIn = Math.max(...positioned.map((entry) => entry.value ?? 0), bodyHeight ?? 0, 12) * 1.2;
  const H = 240;
  const W = 300;
  const yOf = (v: number) => H - 16 - (v / maxIn) * (H - 32);

  const drag = (param: string) => (event: React.PointerEvent<SVGGElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const move = (pointer: PointerEvent) => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return;
      const value = Math.max(0.5, ((H - 16 - (pointer.clientY - rect.top)) / (H - 32)) * maxIn);
      update((current) => setOverride(current, typeName, param, fmtIn(value)));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  if (planes.length === 0) return null;
  return (
    <div>
      <p className="tele-label mb-1 text-[9px] text-[var(--lichen)]">
        planes · axis + param-driven offset from {from}
      </p>
      <svg
        ref={svgRef}
        width={W}
        height={H}
        className="rounded-[2px] border border-[var(--line)] bg-[var(--paper-2)]/40"
      >
        {bodyHeight != null && (
          <rect
            x={20}
            y={yOf(bodyHeight)}
            width={70}
            height={H - 16 - yOf(bodyHeight)}
            fill="var(--slate)"
            opacity={0.1}
          />
        )}
        {bodyHeight != null && (
          <text x={24} y={yOf(bodyHeight) + 12} fontSize={8} fill="var(--slate)">
            body · {fmtIn(bodyHeight)}
          </text>
        )}
        <line x1={16} y1={H - 16} x2={W - 12} y2={H - 16} stroke="var(--line-2)" />
        <text x={W - 14} y={H - 6} fontSize={8} textAnchor="end" fill="var(--slate)">
          {from} = 0
        </text>
        {positioned.map(({ slug, param, resolved, value }) => {
          const y = yOf(value ?? 0);
          const overridden = resolved?.source === "override";
          return (
            <g
              key={slug}
              onPointerDown={param ? drag(param) : undefined}
              style={{ cursor: "ns-resize" }}
            >
              <line x1={16} y1={y} x2={W - 12} y2={y} stroke="transparent" strokeWidth={12} />
              <line
                x1={16}
                y1={y}
                x2={W - 12}
                y2={y}
                stroke={overridden ? "var(--pe-blue)" : "var(--lichen)"}
                strokeWidth={1.5}
              />
              <text x={100} y={y - 4} fontSize={9} fill="var(--clay-ink)">
                {slug} · {resolved?.text}
                {overridden ? ` · override ${typeName}` : ""}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="mt-1 text-[10px] text-[var(--slate)]">
        drag a plane — it writes the driving parameter as a <b>{typeName}</b> override
      </p>
      {formulaPlanes.length > 0 && (
        <div className="mt-1 space-y-0.5">
          {formulaPlanes.map(({ slug, resolved, plane }) => (
            <p key={slug} className="font-mono text-[10px] text-[var(--kiln)]">
              ─ ─ {slug} · {resolved?.text} · {plane.direction}{" "}
              <span className="text-[var(--slate)]">(formula — web v1 does not evaluate)</span>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

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

const PRISM_FACES = ["Top", "Bottom", "Left", "Right", "Front", "Back"];
const CYL_FACES = ["Top", "Bottom", "Side"];

function SolidCard({
  slug,
  solid,
  model,
  typeName,
  update,
  usedFaces,
}: {
  slug: string;
  solid: SolidSpec;
  model: FamilyModel;
  typeName: string;
  update: Update;
  usedFaces: Set<string>;
}) {
  const isVoid = solid.kind.startsWith("Void");
  const isCylinder = solid.kind.endsWith("Cylinder");
  const faces = isCylinder ? CYL_FACES : PRISM_FACES;
  return (
    <div
      className={`rounded-[2px] border p-2 ${isVoid ? "border-dashed border-[var(--line-2)]" : "border-[var(--line)]"}`}
    >
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[11px] font-semibold">{slug}</span>
        <span
          className={`tele-label text-[9px] ${isVoid ? "text-[var(--fail)]" : "text-[var(--slate)]"}`}
        >
          {solid.kind}
        </span>
      </div>
      <svg width={110} height={70} className="mx-auto mt-1 block">
        {isCylinder ? (
          <ellipse
            cx={55}
            cy={35}
            rx={30}
            ry={26}
            fill="none"
            stroke="var(--clay-ink)"
            strokeWidth={1.2}
            strokeDasharray={isVoid ? "4 3" : undefined}
          />
        ) : (
          <rect
            x={25}
            y={10}
            width={60}
            height={50}
            fill="none"
            stroke="var(--clay-ink)"
            strokeWidth={1.2}
            strokeDasharray={isVoid ? "4 3" : undefined}
          />
        )}
      </svg>
      <div className="mt-1 flex flex-wrap gap-1">
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
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {faces.map((face) => {
          const used = usedFaces.has(`${slug}.${face}`);
          return (
            <span
              key={face}
              className={`rounded-[2px] px-1 py-px font-mono text-[8px] ${
                used
                  ? "bg-[var(--clay-ink)]/15 font-bold text-[var(--clay-ink)]"
                  : "text-[var(--slate)]/60"
              }`}
              title={
                used ? `face:${slug}.${face} is referenced by a frame` : `face:${slug}.${face}`
              }
            >
              {face}
            </span>
          );
        })}
      </div>
    </div>
  );
}

const DOMAIN_COLOR: Record<string, string> = {
  Duct: "var(--pe-blue)",
  Pipe: "var(--lichen)",
  Electrical: "var(--kiln)",
};

function ConnectorCard({
  slug,
  connector,
  model,
  typeName,
  update,
}: {
  slug: string;
  connector: ConnectorSpec;
  model: FamilyModel;
  typeName: string;
  update: Update;
}) {
  return (
    <div
      className="rounded-[2px] border border-[var(--line)] p-2"
      style={{ borderLeft: `3px solid ${DOMAIN_COLOR[connector.domain] ?? "var(--slate)"}` }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-[11px] font-semibold">{slug}</span>
        <span className="tele-label text-[9px] text-[var(--slate)]">
          {connector.domain} · {connector.shape}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1">
        <span className="rounded-[2px] bg-[var(--kiln)]/10 px-1 py-0.5 font-mono text-[9px] text-[var(--kiln)]">
          {connector.frame}
        </span>
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
        {connector.flowDirection && (
          <span className="px-1 font-mono text-[9px] text-[var(--slate)]">
            flow {connector.flowDirection}
          </span>
        )}
      </div>
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
  const usedFaces = new Set(
    Object.values(model.frames ?? {})
      .flatMap((frame) => frame.origin)
      .filter((origin) => origin.startsWith("face:"))
      .map((origin) => origin.slice(5)),
  );
  const solids = Object.entries(model.solids ?? {});
  const connectors = Object.entries(model.connectors ?? {});
  const nested = Object.entries(model.nestedFamilies ?? {});
  const arrays = Object.entries(model.arrays ?? {});
  const unmodeled = model.unmodeled ?? [];

  return (
    <div className="space-y-3">
      {/* definitions — the family header, document order first */}
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
      </div>

      <div className="grid gap-3 lg:grid-cols-[300px_1fr]">
        <PlaneRuler model={model} typeName={typeName} update={update} />
        <div className="space-y-3">
          {solids.length > 0 && (
            <div>
              <p className="tele-label mb-1 text-[9px] text-[var(--lichen)]">
                solids · closed v1 vocabulary, named faces are the reference surface
              </p>
              <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
                {solids.map(([slug, solid]) => (
                  <SolidCard
                    key={slug}
                    slug={slug}
                    solid={solid}
                    model={model}
                    typeName={typeName}
                    update={update}
                    usedFaces={usedFaces}
                  />
                ))}
              </div>
            </div>
          )}
          {connectors.length > 0 && (
            <div>
              <p className="tele-label mb-1 text-[9px] text-[var(--lichen)]">
                connectors · engineer vocabulary, stub authored inline
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {connectors.map(([slug, connector]) => (
                  <ConnectorCard
                    key={slug}
                    slug={slug}
                    connector={connector}
                    model={model}
                    typeName={typeName}
                    update={update}
                  />
                ))}
              </div>
            </div>
          )}
          {(nested.length > 0 || arrays.length > 0) && (
            <div>
              <p className="tele-label mb-1 text-[9px] text-[var(--lichen)]">
                nested families &amp; arrays
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {nested.map(([slug, spec]) => (
                  <div key={slug} className="rounded-[2px] border border-[var(--line)] p-2">
                    <div className="flex items-baseline justify-between">
                      <span className="font-mono text-[11px] font-semibold">{slug}</span>
                      <span className="tele-label text-[9px] text-[var(--slate)]">
                        nested · {spec.family}
                      </span>
                    </div>
                    <div className="mt-1 space-y-0.5 font-mono text-[10px] text-[var(--slate)]">
                      {spec.type && <div>type “{spec.type}”</div>}
                      {Object.entries(spec.parameterBindings ?? {}).map(([target, source]) => (
                        <div key={target}>
                          {target} ← <span className="text-[var(--pe-blue)]">{source}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                {arrays.map(([slug, spec]) => (
                  <div key={slug} className="rounded-[2px] border border-[var(--line)] p-2">
                    <div className="flex items-baseline justify-between">
                      <span className="font-mono text-[11px] font-semibold">{slug} ×2n−1</span>
                      <span className="tele-label text-[9px] text-[var(--slate)]">
                        {spec.kind} · {spec.axis}
                      </span>
                    </div>
                    <div className="mt-1 space-y-0.5 font-mono text-[10px] text-[var(--slate)]">
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
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* quarantine — honesty ledger, document order last */}
      <div className="flex flex-wrap items-center gap-3 border-t border-[var(--line-soft)] pt-2">
        <button
          type="button"
          onClick={() => update(toggleRcp)}
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

// ═══════════════════════════════════════════ PAGE ═══════════════════════════════════════════════
function Page() {
  const [profileKey, setProfileKey] = useState<ProfileKey>("showcase");
  const [models, setModels] = useState<Record<ProfileKey, FamilyModel>>({ ...PROFILES });
  const [selectedTypes, setSelectedTypes] = useState<Record<ProfileKey, string>>({
    showcase: "Standard",
    grd: "Fifteen Vanes",
  });
  const model = models[profileKey];
  const typeName = selectedTypes[profileKey];
  const update: Update = (fn) =>
    setModels((state) => ({ ...state, [profileKey]: fn(state[profileKey]) }));
  const setType = (name: string) => setSelectedTypes((state) => ({ ...state, [profileKey]: name }));
  const dirty = model !== PROFILES[profileKey];

  return (
    <main className="min-h-screen bg-[var(--paper)] text-[var(--foreground)]">
      <div className="mx-auto max-w-[1160px] px-5 py-6">
        <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="tele-label text-[10px] tracking-[0.3em] text-[var(--clay-ink)]">
              POC / FAMILY MODEL CHAT PLUGIN — 3 MVPS
            </p>
            <h1 className="mt-1 text-xl font-semibold tracking-tight">
              One family.json, three ways to hold it
            </h1>
            <p className="mt-2 max-w-3xl text-[13px] leading-relaxed text-[var(--slate)]">
              Three MVP shapes for the chat plugin Pea shows when it touches a Family Model. Every
              exhibit below reads <i>and writes</i> the same in-memory <code>family.json</code> —
              edit in any one and the others move, because the authored model is the only truth.
              Values, formulas, references, and units stay authored strings; nothing here evaluates
              formulas or guesses geometry.
            </p>
          </div>
          <ThemeToggle />
        </header>

        {/* shared controls — the one resolution every exhibit derives from */}
        <div className="sticky top-0 z-10 mb-5 flex flex-wrap items-center gap-2 rounded-[2px] border border-[var(--line)] bg-[var(--paper)]/95 px-3 py-2 backdrop-blur">
          {(Object.keys(PROFILES) as ProfileKey[]).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setProfileKey(key)}
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
                setModels((state) => ({ ...state, [profileKey]: PROFILES[profileKey] }))
              }
              className="ml-auto rounded-[2px] border border-[var(--line)] px-2 py-0.5 text-[10px] text-[var(--fail)] hover:border-[var(--fail)]"
            >
              reset edits
            </button>
          )}
        </div>

        <section className="mb-8">
          <SectionIntro title="MVP 1 — WIRING BOARD">
            The reference micro-DSL (<code>param:</code>, <code>plane:</code>, <code>face:</code>,{" "}
            <code>frame:</code>) is the family&apos;s entire relationship system — so draw it as a
            patch bay. Hover any node to trace its full dependency cone; click a parameter value to
            edit it in place. Formula parameters carry{" "}
            <span className="font-mono text-[var(--kiln)]">ƒ</span> and stay read-only: web v1
            renders formulas, it never evaluates them.
          </SectionIntro>
          <PluginCard
            mvp="wiring"
            action="Draft update"
            hint="Pea can propose parameter edits; the wires show what each edit will reach. Only you build."
          >
            <WiringBoard model={model} typeName={typeName} update={update} />
          </PluginCard>
        </section>

        <section className="mb-8">
          <SectionIntro title="MVP 2 — TYPE FLEX MATRIX">
            The per-type object model made visible. Each cell is one of three states: an{" "}
            <span className="font-mono text-[var(--slate)]">inherited</span> family value (dashed on
            hover), a solid-blue{" "}
            <span className="font-semibold text-[var(--pe-blue)]">override</span>, or{" "}
            <span className="font-mono text-[var(--kiln)]">locked</span> because the parameter is
            formula-driven — value XOR formula is a schema rule, so the UI never offers the illegal
            cell. Click a type header to flex every exhibit on the page.
          </SectionIntro>
          <PluginCard
            mvp="type flex"
            action="Review"
            hint="Empty types render as ∅ columns on purpose — visible and preserved, exactly like the JSON."
          >
            <TypeMatrix model={model} typeName={typeName} onType={setType} update={update} />
          </PluginCard>
        </section>

        <section className="mb-8">
          <SectionIntro title="MVP 3 — ANATOMY SHEET">
            family.json in document order: definitions, content, quarantine. Planes are axis +
            param-driven offset only — which is why the dumb evaluator can place them: drag a plane
            and it writes the driving parameter back as a type override. Solids show their closed
            face vocabulary with frame-referenced faces lit; connectors carry their stub inline; the{" "}
            <code>unmodeled</code> ledger closes the sheet honestly.
          </SectionIntro>
          <PluginCard
            mvp="anatomy"
            action="Read"
            hint="Everything shown is authored state or a fact derived by arithmetic — no Revit semantics in the browser."
          >
            <AnatomySheet model={model} typeName={typeName} update={update} />
          </PluginCard>
        </section>

        <details className="mb-10 rounded-[2px] border border-[var(--line)] bg-[var(--paper-2)]/40 px-3 py-2">
          <summary className="tele-label cursor-pointer text-[10px] text-[var(--clay-ink)]">
            AUTHORED TRUTH — the family.json all three exhibits are editing
          </summary>
          <pre className="mt-2 max-h-96 overflow-auto font-mono text-[10px] leading-4 text-[var(--slate)]">
            {JSON.stringify(model, null, 2)}
          </pre>
        </details>
      </div>
    </main>
  );
}
