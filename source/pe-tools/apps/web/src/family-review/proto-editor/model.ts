/**
 * PROTOTYPE (find-the-product round 2 · piece 3) — the ONE derivation under all three editing
 * paradigms. Throwaway with the round.
 *
 * THE QUESTION: `family.json` is relation-heavy — a frame's origin is three references (faces,
 * planes), a plane hangs off another plane by a parameter, a solid names a frame and three
 * parameters, a connector names a frame, an array names a member and two limit planes. JSON form
 * generation is REJECTED as the end state: a generated form shows you the FIELDS and hides the
 * RELATIONS, which is the only part that is hard. So the three paradigms differ in how they
 * PRESENT the relation, and share this one derivation of what the relations ARE.
 *
 * THE GRAPH IS THE SCHEMA READ ONCE. Every authored reference in the document becomes one edge
 * carrying the field that wrote it and, where the field is rewritable, the closure that rewrites
 * it. That closure is why "re-anchor every dependent of this plane onto that one" is one line
 * (`retarget`) instead of a per-section dispatch switch — and re-anchoring is the operation a
 * generated form cannot offer at all, because it never knew the dependents existed.
 *
 * NODE IDS ARE THE AUTHORED REFERENCES VERBATIM (`param:Body Width`, `plane:family.Bottom`,
 * `face:body.Top`, `frame:supply-air`). No id table, no mapping layer, and a retarget writes the
 * id it was handed straight into the document.
 *
 * Data: the checked-in round-1 fixture (`family-review/proto/board-data.ts`), read-only — a SIBLING
 * agent owns that directory this round. Nothing here is mocked; the showcase family is a real
 * `family.json` that a real Revit built.
 */
import {
  paramRef,
  paramSpec,
  resolveParam,
  type FamilyModel,
  type SolidSpec,
} from "#/family/family-model";
import { RAW_BOARD } from "#/family-review/proto/board-data";

// ── vocabulary (the closed sets every picker is scoped to) ──────────────────────────────────────

export const FAMILY_PLANES = ["CenterLR", "CenterFB", "Bottom"] as const;
export const PRISM_FACES = ["Left", "Right", "Front", "Back", "Bottom", "Top"] as const;
export const AXES = ["+X", "-X", "+Y", "-Y", "+Z", "-Z"] as const;
export const SOLID_KINDS = ["Prism", "Cylinder", "VoidPrism", "VoidCylinder"] as const;
export const DIRECTIONS = ["In", "Out"] as const;
export const CONNECTOR_SHAPES = ["Round", "Rectangular"] as const;
export const CONNECTOR_DOMAINS = ["Duct", "Pipe", "Electrical", "CableTray", "Conduit"] as const;

/** The one family on stage. Every paradigm edits this same document, in memory, no persistence. */
export const SHOWCASE_SLUG = "family-model-showcase";

export function showcaseModel(): FamilyModel {
  const raw = RAW_BOARD.find((entry) => entry.slug === SHOWCASE_SLUG);
  if (!raw) throw new Error(`fixture '${SHOWCASE_SLUG}' is missing`);
  return JSON.parse(raw.familyJson) as FamilyModel;
}

// ── immutable writers ───────────────────────────────────────────────────────────────────────────

type Section = "planes" | "frames" | "solids" | "connectors" | "nestedFamilies" | "arrays";

/** One writer for every flat `<section>/<slug>/<field>` reference the schema carries. */
export function setField(
  model: FamilyModel,
  section: Section,
  slug: string,
  field: string,
  value: string,
): FamilyModel {
  // ponytail: one erased writer instead of a four-arm dispatch switch. The double cast is the
  // price — the four section value types share no index signature — and `field` is checked by
  // `fieldsOf`, which only ever names fields the schema actually carries.
  const bag = (model[section] ?? {}) as unknown as Record<string, Record<string, unknown>>;
  const entry = bag[slug];
  if (!entry) return model;
  return { ...model, [section]: { ...bag, [slug]: { ...entry, [field]: value } } } as FamilyModel;
}

export function setFrameOrigin(
  model: FamilyModel,
  slug: string,
  index: number,
  ref: string,
): FamilyModel {
  const frame = model.frames?.[slug];
  if (!frame) return model;
  const origin = frame.origin.map((entry, at) => (at === index ? ref : entry));
  return { ...model, frames: { ...model.frames, [slug]: { ...frame, origin } } };
}

export function setStub(
  model: FamilyModel,
  slug: string,
  field: "depth" | "direction",
  value: string,
): FamilyModel {
  const connector = model.connectors?.[slug];
  if (!connector?.stub) return model;
  return {
    ...model,
    connectors: {
      ...model.connectors,
      [slug]: { ...connector, stub: { ...connector.stub, [field]: value } },
    },
  };
}

/** Retype a parameter. Live on purpose: a parameter that stops being a Length leaves every
 *  `lengthParam` picker on the page in the same render — the legal-options law, observable. */
export function setParamDataType(
  model: FamilyModel,
  section: "familyParameters" | "sharedParameters",
  name: string,
  dataType: string,
): FamilyModel {
  const specs = model[section] ?? {};
  const spec = specs[name];
  if (!spec) return model;
  return { ...model, [section]: { ...specs, [name]: { ...spec, dataType } } };
}

/** Author a new solid with every token UNBOUND — paradigm C's from-scratch case. */
export function addSolid(model: FamilyModel, slug: string): FamilyModel {
  if (!slug || model.solids?.[slug]) return model;
  const blank: SolidSpec = { kind: "", frame: "", width: "", depth: "", height: "" };
  return { ...model, solids: { ...model.solids, [slug]: blank } };
}

// ── the graph ───────────────────────────────────────────────────────────────────────────────────

export type NodeKind =
  | "param"
  | "datum-plane"
  | "plane"
  | "solid"
  | "face"
  | "frame"
  | "connector"
  | "nested"
  | "array";

export interface GraphNode {
  /** The authored reference, verbatim. */
  id: string;
  kind: NodeKind;
  label: string;
  /** What the node IS, in the document's own words — never a guess. */
  detail: string;
  /** Faces belong to their solid; nothing else nests. */
  parent?: string;
}

export type Write = (model: FamilyModel, ref: string) => FamilyModel;

export interface GraphEdge {
  /** The DEPENDENT — the thing that is defined off `to`. */
  from: string;
  /** The ANCHOR — what `from` is defined FROM. */
  to: string;
  /** The authored field carrying the reference (`width`, `origin[0]`, `stub.depth`). */
  field: string;
  /** Rewrites that one field. Absent = structural (a face belongs to its solid), not retargetable. */
  write?: Write;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  byId: Map<string, GraphNode>;
}

const kindOfRef = (ref: string): NodeKind | null =>
  ref.startsWith("param:")
    ? "param"
    : ref.startsWith("face:")
      ? "face"
      : ref.startsWith("plane:family.")
        ? "datum-plane"
        : ref.startsWith("plane:")
          ? "plane"
          : ref.startsWith("frame:")
            ? "frame"
            : null;

export function familyGraph(model: FamilyModel): Graph {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  const push = (node: GraphNode) => {
    if (seen.has(node.id)) return;
    seen.add(node.id);
    nodes.push(node);
  };
  /** An edge — plus the anchor node itself where the reference invents one (a face only ever
   *  exists because something pointed at it). */
  const link = (from: string, ref: string | undefined, field: string, write?: Write) => {
    if (!ref) return;
    const kind = kindOfRef(ref);
    if (kind == null) return; // a literal (`24in`, `+Z`, `Round`) anchors nothing
    if (kind === "face") {
      const [slug = "", face = ""] = ref.slice("face:".length).split(".");
      push({
        id: ref,
        kind: "face",
        label: `${slug} · ${face}`,
        detail: `${face} face of ${slug}`,
        parent: `solid:${slug}`,
      });
      edges.push({ from: ref, to: `solid:${slug}`, field: "face of" });
    }
    edges.push({ from, to: ref, field, write });
  };

  // parameters — the leaves everything numeric lands on
  for (const section of ["familyParameters", "sharedParameters"] as const)
    for (const [name, spec] of Object.entries(model[section] ?? {}))
      push({
        id: `param:${name}`,
        kind: "param",
        label: name,
        detail: spec.formula != null ? `= ${spec.formula}` : String(spec.value ?? "—"),
      });

  // a formula READS other parameters — the "where does this number come from" case
  const names = [
    ...Object.keys(model.familyParameters),
    ...Object.keys(model.sharedParameters ?? {}),
  ];
  for (const [name, spec] of Object.entries(model.familyParameters))
    for (const other of names)
      if (spec.formula != null && other !== name && spec.formula.includes(other))
        edges.push({
          from: `param:${name}`,
          to: `param:${other}`,
          field: "formula",
          write: (next, ref) => {
            const target = next.familyParameters[name];
            if (target?.formula == null) return next;
            const swapped = target.formula.split(other).join(ref.replace(/^param:/, ""));
            return {
              ...next,
              familyParameters: {
                ...next.familyParameters,
                [name]: { ...target, formula: swapped },
              },
            };
          },
        });

  // the three stock family planes always exist, whether or not the document names them
  for (const member of FAMILY_PLANES)
    push({
      id: `plane:family.${member}`,
      kind: "datum-plane",
      label: `family.${member}`,
      detail: "stock family reference plane",
    });
  push({ id: "frame:family", kind: "frame", label: "family", detail: "family origin, unrotated" });

  for (const [slug, plane] of Object.entries(model.planes ?? {})) {
    push({
      id: `plane:${slug}`,
      kind: "plane",
      label: slug,
      detail: `${plane.direction} of ${plane.from}`,
    });
    link(`plane:${slug}`, plane.from, "from", (next, ref) =>
      setField(next, "planes", slug, "from", ref),
    );
    link(`plane:${slug}`, plane.by, "by", (next, ref) => setField(next, "planes", slug, "by", ref));
  }

  for (const [slug, solid] of Object.entries(model.solids ?? {})) {
    push({ id: `solid:${slug}`, kind: "solid", label: slug, detail: solid.kind || "unbound kind" });
    link(`solid:${slug}`, solid.frame, "frame", (next, ref) =>
      setField(next, "solids", slug, "frame", ref),
    );
    for (const field of ["width", "depth", "height", "diameter"] as const)
      link(`solid:${slug}`, solid[field], field, (next, ref) =>
        setField(next, "solids", slug, field, ref),
      );
  }

  for (const [slug, frame] of Object.entries(model.frames ?? {})) {
    push({
      id: `frame:${slug}`,
      kind: "frame",
      label: slug,
      detail: `${frame.normal} normal · ${frame.up} up`,
    });
    frame.origin.forEach((ref, index) =>
      link(`frame:${slug}`, ref, `origin[${index}]`, (next, target) =>
        setFrameOrigin(next, slug, index, target),
      ),
    );
  }

  for (const [slug, connector] of Object.entries(model.connectors ?? {})) {
    push({
      id: `connector:${slug}`,
      kind: "connector",
      label: slug,
      detail: `${connector.domain} · ${connector.shape}`,
    });
    link(`connector:${slug}`, connector.frame, "frame", (next, ref) =>
      setField(next, "connectors", slug, "frame", ref),
    );
    for (const field of ["diameter", "width", "height"] as const)
      link(`connector:${slug}`, connector[field], field, (next, ref) =>
        setField(next, "connectors", slug, field, ref),
      );
    link(`connector:${slug}`, connector.stub?.depth, "stub.depth", (next, ref) =>
      setStub(next, slug, "depth", ref),
    );
  }

  // The showcase carries neither, but the frontier's hardest relations live here (an array
  // references a nested family AND two limit planes), so the derivation reads them too.
  for (const [slug, nested] of Object.entries(model.nestedFamilies ?? {})) {
    push({ id: `nested:${slug}`, kind: "nested", label: slug, detail: nested.family });
    link(`nested:${slug}`, nested.frame, "frame");
    for (const [target, source] of Object.entries(nested.parameterBindings ?? {}))
      link(
        `nested:${slug}`,
        source.startsWith("param:") ? source : `param:${source}`,
        `binds ${target}`,
      );
  }

  for (const [slug, array] of Object.entries(model.arrays ?? {})) {
    push({
      id: `array:${slug}`,
      kind: "array",
      label: slug,
      detail: `${array.kind} of ${array.member}`,
    });
    link(`array:${slug}`, array.halfCount, "halfCount");
    link(`array:${slug}`, array.limits?.start, "limits.start");
    link(`array:${slug}`, array.limits?.end, "limits.end");
  }

  return { nodes, edges, byId: new Map(nodes.map((node) => [node.id, node])) };
}

// ── the two directions ──────────────────────────────────────────────────────────────────────────

/** Everything defined OFF `id` — the blast radius of changing it. Faces fold into their solid, so
 *  asking a solid what hangs off it answers with the FRAMES, not with a list of faces to click. */
export function dependents(graph: Graph, id: string): GraphEdge[] {
  const direct = graph.edges.filter((edge) => edge.to === id && edge.field !== "face of");
  const faces = graph.nodes.filter((node) => node.parent === id).map((node) => node.id);
  return [...direct, ...graph.edges.filter((edge) => faces.includes(edge.to))];
}

/** Everything `id` is defined FROM — one row per authored field that carries a reference. */
export function anchors(graph: Graph, id: string): GraphEdge[] {
  return graph.edges.filter((edge) => edge.from === id);
}

/** Every chain back to a root — "where does this number come from", already walked.
 *  ponytail: depth-capped rather than cycle-detected; the schema forbids cycles and a capped walk
 *  degrades to a truncated chain instead of hanging. Detect properly if cycles ever become legal. */
export function provenance(graph: Graph, id: string, depth = 4): string[][] {
  const up = depth === 0 ? [] : anchors(graph, id);
  if (up.length === 0) return [[id]];
  return up.flatMap((edge) => provenance(graph, edge.to, depth - 1).map((tail) => [id, ...tail]));
}

/** Point every dependent of `fromId` at `toId`. The operation a generated form cannot offer. */
export function retarget(
  graph: Graph,
  model: FamilyModel,
  fromId: string,
  toId: string,
): { model: FamilyModel; moved: string[] } {
  const moved: string[] = [];
  let next = model;
  for (const edge of graph.edges) {
    if (edge.to !== fromId || !edge.write) continue;
    next = edge.write(next, toId);
    moved.push(`${edge.from} · ${edge.field}`);
  }
  return { model: next, moved };
}

// ── scoped choice: what is LEGAL in this slot ───────────────────────────────────────────────────

export type FieldKind =
  | "lengthParam"
  | "frame"
  | "plane"
  | "anchor"
  | "axis"
  | "direction"
  | "solidKind"
  | "shape"
  | "domain"
  | "dataType";

/** The legal references for one slot, scoped to what the document actually carries. A picker that
 *  offers an illegal token is the generated-form failure mode wearing a nicer control. */
export function legalRefs(model: FamilyModel, kind: FieldKind): string[] {
  switch (kind) {
    case "lengthParam":
      return Object.entries(model.familyParameters)
        .filter(([, spec]) => spec.dataType?.startsWith("Length") ?? false)
        .map(([name]) => `param:${name}`);
    case "frame":
      return ["frame:family", ...Object.keys(model.frames ?? {}).map((slug) => `frame:${slug}`)];
    case "plane":
      return [
        ...FAMILY_PLANES.map((member) => `plane:family.${member}`),
        ...Object.keys(model.planes ?? {}).map((slug) => `plane:${slug}`),
      ];
    case "anchor":
      return [
        ...legalRefs(model, "plane"),
        ...Object.entries(model.solids ?? {}).flatMap(([slug, solid]) =>
          solid.kind.endsWith("Cylinder")
            ? [`face:${slug}.Bottom`, `face:${slug}.Top`]
            : PRISM_FACES.map((face) => `face:${slug}.${face}`),
        ),
      ];
    case "axis":
      return [...AXES];
    case "direction":
      return [...DIRECTIONS];
    case "solidKind":
      return [...SOLID_KINDS];
    case "shape":
      return [...CONNECTOR_SHAPES];
    case "domain":
      return [...CONNECTOR_DOMAINS];
    case "dataType":
      // Read out of the document, per the legal-options law — the full Revit spec list is not
      // ours to invent, and offering only what this family already uses is the honest scope.
      return [
        ...new Set(
          Object.values(model.familyParameters)
            .concat(Object.values(model.sharedParameters ?? {}))
            .map((spec) => spec.dataType)
            .filter((dataType) => dataType !== undefined),
        ),
      ];
  }
}

/** What a node reads as, for the staged type. Parameters resolve; everything else states itself. */
export function nodeValue(model: FamilyModel, typeName: string, id: string): string | null {
  const param = paramRef(id);
  if (param == null || !paramSpec(model, param)) return null;
  return resolveParam(model, typeName, param).text;
}

/** The types that override this parameter — a value's other dimension, not a relation. */
export function overriddenBy(model: FamilyModel, id: string): string[] {
  const param = paramRef(id);
  if (param == null) return [];
  return Object.entries(model.types)
    .filter(([, overrides]) => overrides[param] != null)
    .map(([name]) => name);
}
