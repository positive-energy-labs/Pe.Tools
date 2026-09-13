/**
 * PROTOTYPE (round 2 · piece 3) — the editable fields of ONE node, as data.
 *
 * Paradigms A and B both need "what can I change about this thing, and which of those changes is a
 * RELATION". They disagree about how you got here (walked the graph vs pointed at the picture) and
 * agree completely about what is then editable — so the descriptor lives once, here, and the two
 * surfaces render it differently. Paradigm C does NOT use it: a sentence is a different sentence
 * per kind, and flattening it back into a field list is the generated-form failure this round is
 * trying to escape.
 *
 * NUMBERS LIVE ON PARAMETERS. A solid's `width` is a REFERENCE slot, never a number box: the only
 * place a length is typed is the parameter it points at. That is a schema fact (every dimension is
 * param-driven or a portable literal) and making the UI say it removes a whole class of "why did
 * my type override not move this" confusion.
 */
import {
  setParamFormula,
  setParamValue,
  type FamilyModel,
  type ParamSpec,
} from "#/family/family-model";
import {
  setField,
  setFrameOrigin,
  setStub,
  type FieldKind,
} from "#/family-review/proto-editor/model";

export interface NodeField {
  /** The authored field, as the document names it. */
  key: string;
  /** `text` = a literal typed here; anything else picks from a scoped, closed set. */
  slot: FieldKind | "text";
  value: string;
  /** True when the value points at ANOTHER node — the edges of the graph. */
  relation: boolean;
  write: (model: FamilyModel, value: string) => FamilyModel;
}

const paramFields = (spec: ParamSpec, name: string): NodeField[] => [
  {
    key: "dataType",
    slot: "text",
    value: spec.dataType ?? "",
    relation: false,
    // Read-only in this prototype: retyping a parameter re-checks every slot that references it.
    write: (model) => model,
  },
  {
    key: "value",
    slot: "text",
    value: String(spec.value ?? ""),
    relation: false,
    write: (model, value) => setParamValue(model, name, value),
  },
  {
    key: "formula",
    slot: "text",
    value: spec.formula ?? "",
    relation: false,
    write: (model, value) => setParamFormula(model, name, value),
  },
];

export function fieldsOf(model: FamilyModel, id: string): NodeField[] {
  if (id.startsWith("param:")) {
    const name = id.slice("param:".length);
    const spec = model.familyParameters[name] ?? model.sharedParameters?.[name];
    return spec ? paramFields(spec, name) : [];
  }

  if (id.startsWith("plane:family.") || id === "frame:family") return []; // stock, not authored

  if (id.startsWith("plane:")) {
    const slug = id.slice("plane:".length);
    const plane = model.planes?.[slug];
    if (!plane) return [];
    return [
      {
        key: "from",
        slot: "plane",
        value: plane.from,
        relation: true,
        write: (next, value) => setField(next, "planes", slug, "from", value),
      },
      {
        key: "by",
        slot: "lengthParam",
        value: plane.by,
        relation: true,
        write: (next, value) => setField(next, "planes", slug, "by", value),
      },
      {
        key: "direction",
        slot: "direction",
        value: plane.direction,
        relation: false,
        write: (next, value) => setField(next, "planes", slug, "direction", value),
      },
    ];
  }

  if (id.startsWith("solid:")) {
    const slug = id.slice("solid:".length);
    const solid = model.solids?.[slug];
    if (!solid) return [];
    const dims = solid.kind.endsWith("Cylinder")
      ? (["diameter", "height"] as const)
      : (["width", "depth", "height"] as const);
    return [
      {
        key: "kind",
        slot: "solidKind",
        value: solid.kind,
        relation: false,
        write: (next, value) => setField(next, "solids", slug, "kind", value),
      },
      {
        key: "frame",
        slot: "frame",
        value: solid.frame ?? "",
        relation: true,
        write: (next, value) => setField(next, "solids", slug, "frame", value),
      },
      ...dims.map((field) => ({
        key: field,
        slot: "lengthParam" as const,
        value: solid[field] ?? "",
        relation: true,
        write: (next: FamilyModel, value: string) => setField(next, "solids", slug, field, value),
      })),
    ];
  }

  if (id.startsWith("frame:")) {
    const slug = id.slice("frame:".length);
    const frame = model.frames?.[slug];
    if (!frame) return [];
    return [
      ...frame.origin.map((ref, index) => ({
        key: `origin[${index}]`,
        slot: "anchor" as const,
        value: ref,
        relation: true,
        write: (next: FamilyModel, value: string) => setFrameOrigin(next, slug, index, value),
      })),
      {
        key: "normal",
        slot: "axis",
        value: frame.normal,
        relation: false,
        write: (next, value) => setField(next, "frames", slug, "normal", value),
      },
      {
        key: "up",
        slot: "axis",
        value: frame.up,
        relation: false,
        write: (next, value) => setField(next, "frames", slug, "up", value),
      },
    ];
  }

  if (id.startsWith("connector:")) {
    const slug = id.slice("connector:".length);
    const connector = model.connectors?.[slug];
    if (!connector) return [];
    const dims =
      connector.shape === "Round" ? (["diameter"] as const) : (["width", "height"] as const);
    return [
      {
        key: "frame",
        slot: "frame",
        value: connector.frame ?? "",
        relation: true,
        write: (next, value) => setField(next, "connectors", slug, "frame", value),
      },
      ...dims.map((field) => ({
        key: field,
        slot: "lengthParam" as const,
        value: connector[field] ?? "",
        relation: true,
        write: (next: FamilyModel, value: string) =>
          setField(next, "connectors", slug, field, value),
      })),
      ...(connector.stub
        ? [
            {
              key: "stub.depth",
              slot: "lengthParam" as const,
              value: connector.stub.depth,
              relation: true,
              write: (next: FamilyModel, value: string) => setStub(next, slug, "depth", value),
            },
            {
              key: "stub.direction",
              slot: "direction" as const,
              value: connector.stub.direction,
              relation: false,
              write: (next: FamilyModel, value: string) => setStub(next, slug, "direction", value),
            },
          ]
        : []),
    ];
  }

  return [];
}
