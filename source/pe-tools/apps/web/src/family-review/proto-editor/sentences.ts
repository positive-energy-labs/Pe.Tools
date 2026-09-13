/**
 * PROTOTYPE (round 3) — the sentence rows, with the column alignment round 2 ruled missing.
 *
 * THE RULED GAP: paradigm C's sentences won on density and self-explanation and lost on scanning —
 * `width param:Body Width` and `diameter param:Top Diameter` started at different x on every row,
 * so nothing could be compared down a column. This module closes it WITHOUT turning the sentences
 * back into a table.
 *
 * HOW: every construct of one kind is emitted against ONE fixed slot template, in order, with a
 * blank cell where the construct has no such slot — a cylinder has no `width`, and the honest
 * rendering of that is an empty column position, not a shifted row. The connective word rides in
 * the CELL (`lead`), repeated on every row, which is the whole difference between this and a
 * table: a table puts the word in the header once and the rows become data; here every row still
 * reads left-to-right as a sentence, and the columns line up because the template is shared.
 *
 * The alignment invariant — `cells.length === slots.length`, in slot order, always — is what the
 * renderer needs to lay a CSS grid over the group, and it is what the test pins.
 */
import type { FamilyModel } from "#/family/family-model";
import {
  setField,
  setFrameOrigin,
  setStub,
  type FieldKind,
} from "#/family-review/proto-editor/model";

export type CellKind = "blank" | "name" | "ref" | "text";

export interface SentenceCell {
  /** The column this cell occupies. Shared across every row of the group. */
  slot: string;
  /** Muted connective rendered before the token — what keeps the row prose. */
  lead?: string;
  kind: CellKind;
  value: string;
  /** `ref` cells only: which scoped picker is legal here (the legal-options law). */
  slotKind?: FieldKind;
  /** The JSON pointer this cell writes — cross-pane focus, and the pending write's address. */
  pointer?: string;
  write?: (model: FamilyModel, value: string) => FamilyModel;
  title?: string;
}

export interface SentenceRow {
  /** Graph node id — the same vocabulary the triptych and the provenance sidebar speak. */
  id: string;
  pointer: string;
  cells: SentenceCell[];
}

export interface SentenceGroup {
  key: string;
  label: string;
  slots: string[];
  rows: SentenceRow[];
  /** What an empty group would need before it could have a row. */
  exit: string;
}

const word = (slot: string, text: string): SentenceCell => ({ slot, kind: "text", value: text });
const blank = (slot: string): SentenceCell => ({ slot, kind: "blank", value: "" });
const name = (slot: string, value: string, pointer: string): SentenceCell => ({
  slot,
  kind: "name",
  value,
  pointer,
});

/** Lay a sparse set of authored cells over the group's template, in template order. */
const align = (slots: string[], authored: SentenceCell[]): SentenceCell[] =>
  slots.map((slot) => authored.find((cell) => cell.slot === slot) ?? blank(slot));

const PLANE_SLOTS = ["name", "is", "by", "direction", "of", "from"];
const FRAME_SLOTS = [
  "name",
  "sits",
  "origin0",
  "origin1",
  "origin2",
  "facing",
  "normal",
  "upIs",
  "up",
];
const SOLID_SLOTS = ["kind", "name", "on", "frame", "width", "depth", "height", "diameter"];
const CONNECTOR_SLOTS = [
  "name",
  "isA",
  "shape",
  "domain",
  "on",
  "frame",
  "diameter",
  "width",
  "height",
  "stubDepth",
  "stubDirection",
];
const NESTED_SLOTS = ["name", "isA", "family", "type", "on", "frame"];
const ARRAY_SLOTS = ["name", "isA", "kind", "of", "member", "halfCount", "from", "to"];

export function sentenceGroups(model: FamilyModel): SentenceGroup[] {
  return [
    solids(model),
    frames(model),
    planes(model),
    connectors(model),
    nested(model),
    arrays(model),
  ];
}

function planes(model: FamilyModel): SentenceGroup {
  return {
    key: "planes",
    label: "planes",
    slots: PLANE_SLOTS,
    exit: "author a plane off a stock family plane",
    rows: Object.entries(model.planes ?? {}).map(([slug, plane]) => ({
      id: `plane:${slug}`,
      pointer: `/planes/${slug}`,
      cells: align(PLANE_SLOTS, [
        name("name", slug, `/planes/${slug}`),
        word("is", "sits"),
        {
          slot: "by",
          kind: "ref",
          slotKind: "lengthParam",
          value: plane.by,
          pointer: `/planes/${slug}/by`,
          title: "The length this plane is offset by — only Length parameters are legal here",
          write: (next, value) => setField(next, "planes", slug, "by", value),
        },
        {
          slot: "direction",
          kind: "ref",
          slotKind: "direction",
          value: plane.direction,
          pointer: `/planes/${slug}/direction`,
          title: "Which way the offset travels from the plane it hangs off",
          write: (next, value) => setField(next, "planes", slug, "direction", value),
        },
        word("of", "of"),
        {
          slot: "from",
          kind: "ref",
          slotKind: "plane",
          value: plane.from,
          pointer: `/planes/${slug}/from`,
          title: "The plane this one hangs off",
          write: (next, value) => setField(next, "planes", slug, "from", value),
        },
      ]),
    })),
  };
}

function frames(model: FamilyModel): SentenceGroup {
  return {
    key: "frames",
    label: "frames",
    slots: FRAME_SLOTS,
    exit: "author a frame where three surfaces meet",
    rows: Object.entries(model.frames ?? {}).map(([slug, frame]) => ({
      id: `frame:${slug}`,
      pointer: `/frames/${slug}`,
      cells: align(FRAME_SLOTS, [
        name("name", slug, `/frames/${slug}`),
        word("sits", "sits where"),
        ...frame.origin.slice(0, 3).map((ref, index) => ({
          slot: `origin${index}`,
          lead: index === 0 ? undefined : "×",
          kind: "ref" as const,
          slotKind: "anchor" as const,
          value: ref,
          pointer: `/frames/${slug}/origin/${index}`,
          title:
            "One of the three surfaces whose intersection is this frame's origin — faces of authored solids and every plane in scope",
          write: (next: FamilyModel, value: string) => setFrameOrigin(next, slug, index, value),
        })),
        word("facing", ", facing"),
        {
          slot: "normal",
          kind: "ref",
          slotKind: "axis",
          value: frame.normal,
          pointer: `/frames/${slug}/normal`,
          title: "The frame's normal — one named axis; oblique orientation is unmodeled forever",
          write: (next, value) => setField(next, "frames", slug, "normal", value),
        },
        word("upIs", "with up"),
        {
          slot: "up",
          kind: "ref",
          slotKind: "axis",
          value: frame.up,
          pointer: `/frames/${slug}/up`,
          title: "The frame's up axis",
          write: (next, value) => setField(next, "frames", slug, "up", value),
        },
      ]),
    })),
  };
}

function solids(model: FamilyModel): SentenceGroup {
  return {
    key: "solids",
    label: "solids",
    slots: SOLID_SLOTS,
    exit: "author a solid below — its sentence grows as its kind binds",
    rows: Object.entries(model.solids ?? {}).map(([slug, solid]) => {
      // The dimension columns a construct HAS are a function of its kind. A cylinder leaves
      // width and depth blank rather than shifting `diameter` left into their place.
      const dims = solid.kind.endsWith("Cylinder")
        ? (["diameter", "height"] as const)
        : solid.kind === ""
          ? ([] as const)
          : (["width", "depth", "height"] as const);
      return {
        id: `solid:${slug}`,
        pointer: `/solids/${slug}`,
        cells: align(SOLID_SLOTS, [
          {
            slot: "kind",
            kind: "ref",
            slotKind: "solidKind",
            value: solid.kind,
            pointer: `/solids/${slug}/kind`,
            title:
              "The solid vocabulary ceiling — Prism, Cylinder and their voids. Sweeps and blends are unmodeled forever.",
            write: (next, value) => setField(next, "solids", slug, "kind", value),
          },
          name("name", slug, `/solids/${slug}`),
          word("on", "on"),
          {
            slot: "frame",
            kind: "ref",
            slotKind: "frame",
            value: solid.frame ?? "",
            pointer: `/solids/${slug}/frame`,
            title:
              "The frame this solid is built in — frame:family is the family origin, unrotated",
            write: (next, value) => setField(next, "solids", slug, "frame", value),
          },
          ...dims.map((field) => ({
            slot: field,
            lead: field,
            kind: "ref" as const,
            slotKind: "lengthParam" as const,
            value: solid[field] ?? "",
            pointer: `/solids/${slug}/${field}`,
            title: `The parameter driving this solid's ${field}. Numbers live on parameters, never here.`,
            write: (next: FamilyModel, value: string) =>
              setField(next, "solids", slug, field, value),
          })),
        ]),
      };
    }),
  };
}

function connectors(model: FamilyModel): SentenceGroup {
  return {
    key: "connectors",
    label: "connectors",
    slots: CONNECTOR_SLOTS,
    exit: "author a frame first — a connector is placed by one",
    rows: Object.entries(model.connectors ?? {}).map(([slug, connector]) => {
      const dims =
        connector.shape === "Round" ? (["diameter"] as const) : (["width", "height"] as const);
      return {
        id: `connector:${slug}`,
        pointer: `/connectors/${slug}`,
        cells: align(CONNECTOR_SLOTS, [
          name("name", slug, `/connectors/${slug}`),
          word("isA", "is a"),
          {
            slot: "shape",
            kind: "ref",
            slotKind: "shape",
            value: connector.shape ?? "",
            pointer: `/connectors/${slug}/shape`,
            title: "Connector profile — the dimension columns follow it",
            write: (next, value) => setField(next, "connectors", slug, "shape", value),
          },
          {
            slot: "domain",
            kind: "ref",
            slotKind: "domain",
            value: connector.domain,
            pointer: `/connectors/${slug}/domain`,
            title: "Which Revit connector domain this is",
            write: (next, value) => setField(next, "connectors", slug, "domain", value),
          },
          word("on", "on"),
          {
            slot: "frame",
            kind: "ref",
            slotKind: "frame",
            value: connector.frame ?? "",
            pointer: `/connectors/${slug}/frame`,
            title: "The frame that places and orients this connector",
            write: (next, value) => setField(next, "connectors", slug, "frame", value),
          },
          ...dims.map((field) => ({
            slot: field,
            lead: field,
            kind: "ref" as const,
            slotKind: "lengthParam" as const,
            value: connector[field] ?? "",
            pointer: `/connectors/${slug}/${field}`,
            title: `The parameter driving this connector's ${field}`,
            write: (next: FamilyModel, value: string) =>
              setField(next, "connectors", slug, field, value),
          })),
          ...(connector.stub
            ? [
                {
                  slot: "stubDepth",
                  lead: "stubbing",
                  kind: "ref" as const,
                  slotKind: "lengthParam" as const,
                  value: connector.stub.depth,
                  pointer: `/connectors/${slug}/stub/depth`,
                  title: "How far the stub extrusion runs from the frame origin",
                  write: (next: FamilyModel, value: string) => setStub(next, slug, "depth", value),
                },
                {
                  slot: "stubDirection",
                  kind: "ref" as const,
                  slotKind: "direction" as const,
                  value: connector.stub.direction,
                  pointer: `/connectors/${slug}/stub/direction`,
                  title: "Which way the stub runs along the frame normal",
                  write: (next: FamilyModel, value: string) =>
                    setStub(next, slug, "direction", value),
                },
              ]
            : []),
        ]),
      };
    }),
  };
}

function nested(model: FamilyModel): SentenceGroup {
  return {
    key: "nested",
    label: "nested families",
    slots: NESTED_SLOTS,
    exit: "nest an Unhosted family on a frame (the showcase nests none)",
    rows: Object.entries(model.nestedFamilies ?? {}).map(([slug, spec]) => ({
      id: `nested:${slug}`,
      pointer: `/nestedFamilies/${slug}`,
      cells: align(NESTED_SLOTS, [
        name("name", slug, `/nestedFamilies/${slug}`),
        word("isA", "is"),
        {
          slot: "family",
          kind: "text",
          value: spec.family,
          pointer: `/nestedFamilies/${slug}/family`,
        },
        {
          slot: "type",
          kind: "text",
          value: spec.type ?? "",
          pointer: `/nestedFamilies/${slug}/type`,
        },
        word("on", "on"),
        {
          slot: "frame",
          kind: "ref",
          slotKind: "frame",
          value: spec.frame,
          pointer: `/nestedFamilies/${slug}/frame`,
          title: "The frame the nested family is placed on",
          write: (next, value) => setField(next, "nestedFamilies", slug, "frame", value),
        },
      ]),
    })),
  };
}

function arrays(model: FamilyModel): SentenceGroup {
  return {
    key: "arrays",
    label: "arrays",
    slots: ARRAY_SLOTS,
    exit: "author a nested family first — an array repeats a member between two limit planes",
    rows: Object.entries(model.arrays ?? {}).map(([slug, spec]) => ({
      id: `array:${slug}`,
      pointer: `/arrays/${slug}`,
      cells: align(ARRAY_SLOTS, [
        name("name", slug, `/arrays/${slug}`),
        word("isA", "is a"),
        { slot: "kind", kind: "text", value: spec.kind, pointer: `/arrays/${slug}/kind` },
        word("of", "of"),
        { slot: "member", kind: "text", value: spec.member, pointer: `/arrays/${slug}/member` },
        {
          slot: "halfCount",
          lead: "half count",
          kind: "text",
          value: spec.halfCount,
          pointer: `/arrays/${slug}/halfCount`,
        },
        {
          slot: "from",
          lead: "from",
          kind: "text",
          value: spec.limits?.start ?? "",
          pointer: `/arrays/${slug}/limits/start`,
        },
        {
          slot: "to",
          lead: "to",
          kind: "text",
          value: spec.limits?.end ?? "",
          pointer: `/arrays/${slug}/limits/end`,
        },
      ]),
    })),
  };
}
