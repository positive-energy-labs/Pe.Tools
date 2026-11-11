import { z } from "zod";
import {
  fitViewportCodec,
  INVALID,
  modeKey,
  orbitViewportSchema,
  planeViewportSchema,
  viewportKey,
  type Codec,
  type OrbitViewport,
  type PlaneViewport,
  type Viewport,
} from "../page-keys.ts";
import { manyField, field, type RouteDeclaration } from "../route-field.ts";
import { emptySpaceCut, spaceCutsSchema, spaceSceneSchema } from "../space-view.ts";
import {
  decode,
  documentKeySchema,
  subjectCode,
  subjectRefCodeSchema,
  type SubjectRefCode,
  uniqueIdSchema,
} from "../subject-ref.ts";

/** Lossless JSON in the address: what `schema` parses (its key order), stringified; no rounding. */
const jsonCodec = <S extends z.ZodType>(schema: S): Codec<z.output<S>> => ({
  encode: (value) => {
    const parsed = schema.safeParse(value);
    return JSON.stringify(parsed.success ? parsed.data : value);
  },
  decode: (text) => {
    try {
      return JSON.parse(text) as z.output<S>;
    } catch {
      return INVALID;
    }
  },
});

/**
 * A Space element key (ADR 0035 rule 2): the SubjectRef code `UniqueId:<uid>`, with `placement`
 * the link instance's UniqueId when the scene shows it through a link. The host document key is
 * placement's host slot and appears only for a linked element; a host element's key carries no
 * document at all, so a document mark never changes it. Whether the scene holds the key needs the
 * loaded scene (runtime context, not this contract).
 */
export const spaceElementKey = (handle: {
  uniqueId: string;
  hostDocumentKey: string;
  linkInstanceUniqueId?: string | null;
}) =>
  subjectCode({
    keyKind: "UniqueId",
    key: uniqueIdSchema.parse(handle.uniqueId),
    ...(handle.linkInstanceUniqueId
      ? {
          placement: {
            host: documentKeySchema.parse(handle.hostDocumentKey),
            links: [uniqueIdSchema.parse(handle.linkInstanceUniqueId)],
          },
        }
      : {}),
  });

/** Only an element: a UniqueId key with no sub. */
const spaceElementKeySchema = subjectRefCodeSchema.refine((code) => {
  const ref = decode(code);
  return ref.ok && ref.value.keyKind === "UniqueId" && ref.value.sub === undefined;
}, "an element key is a UniqueId SubjectRef with no sub");

/** The saved view's own definitions (`space-view.ts`, version 2): the scene hash and the cuts. */
const spaceCuts = spaceCutsSchema.default({
  top: emptySpaceCut,
  north: emptySpaceCut,
  east: emptySpaceCut,
});

/** 3D orbits; an axis editor draws its plane. */
const SPACE_MODES = ["3d", "top", "north", "east"] as const;
const spaceViewport = z.discriminatedUnion("kind", [orbitViewportSchema, planeViewportSchema]);

/** `""` is none (null); any other text is the key itself. */
// The brand is checked by `spaceElementKeySchema` when the address is read, not by this codec.
const nullableText: Codec<SubjectRefCode | null> = {
  encode: (value) => value ?? "",
  decode: (text) => (text === "" ? null : (text as SubjectRefCode)),
};

const spaceFields = {
  /** The captured scene's hash; absent = none open. Only the capture verb writes a new one. */
  scene: field(spaceSceneSchema.optional(), { url: "push", agent: "read" }),
  mode: field(modeKey(SPACE_MODES, "3d"), { url: "push", agent: "set" }),
  /** null = fit. `3d` holds an orbit, an axis a plane (`conflict`). A drag replaces. */
  viewport: field(
    viewportKey(spaceViewport),
    { url: "replace", agent: "set" },
    fitViewportCodec<OrbitViewport | PlaneViewport>(),
  ),
  /** One cut per axis (`space-view.ts`); an empty polyline clips nothing. */
  cuts: field(spaceCuts, { url: "replace", agent: "set" }, jsonCodec(spaceCuts)),
  selected: field(
    spaceElementKeySchema.nullable().default(null),
    { url: "push", agent: "set" },
    nullableText,
  ),
  hidden: manyField("UniqueId", { url: "push", agent: "set" }),
  isolated: manyField("UniqueId", { url: "push", agent: "set", initial: "all" }),
};

/** The viewport kind the mode draws: a wrong one is no pose for this mode. */
const spaceConflict = (page: Record<string, unknown>) => {
  const viewport = page.viewport as Viewport | null | undefined;
  const want = page.mode === "3d" ? "orbit" : "plane";
  return viewport && viewport.kind !== want
    ? {
        key: "viewport",
        error: `mode ${String(page.mode)} needs ${want === "orbit" ? "an orbit" : "a plane"} or fit viewport, not ${viewport.kind}`,
      }
    : null;
};

/** The Space picture's layers, in strip order; `meshes`, `context` and `cuts` are the scene's own. */
export const SPACE_LAYERS = [
  "meshes",
  "context",
  "cuts",
  "boxes",
  "levels",
  "tree",
  "slice",
  "probe",
  "sweep",
] as const;

export const spaceAddress = {
  path: "/space",
  title: "Space",
  fields: {
    ...spaceFields,
    /** The layers the picture draws, in `SPACE_LAYERS` order. */
    layers: manyField("name", {
      url: "push",
      agent: "set", initial: ["meshes", "context", "cuts"], choices: SPACE_LAYERS,
    }),
  },
  conflict: spaceConflict,
  agent: {
    policy:
      "Change the visible captured Space picture using mode, viewport, cuts, selected, hidden, isolated and layers. Scene is read-only. Use exact element keys from this loaded scene, preserving document and link identity; unknown members are refused. Isolation all shows every element; an empty isolation shows none. Viewport must match the mode, or be empty to fit. Cuts use the scene frame. Capture takes elementIds as explicit reading input, never Page state. View changes never capture, recapture, select in Revit or write Work.",
  },
} satisfies RouteDeclaration;
