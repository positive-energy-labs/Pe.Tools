import { z } from "zod";
import {
  fitViewportCodec,
  INVALID,
  layersKey,
  modeKey,
  orbitViewportSchema,
  planeViewportSchema,
  viewportKey,
  type Codec,
  type OrbitViewport,
  type PlaneViewport,
  type Viewport,
} from "../page-keys.ts";
import { field, type RouteAddress } from "../route-field.ts";
import { demo } from "./shared.ts";
import { emptySpaceCut, spaceCutsSchema, spaceSceneSchema } from "../space-view.ts";

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
 * A Space element key: `JSON.stringify([documentKey, linkInstanceId ?? null, uniqueId])`, as the
 * scene's element handle names it. Structure only: whether the key's document is the scene's, and
 * whether the scene holds it, needs the loaded scene (runtime context, not this contract).
 */
export const spaceElementKey = (handle: {
  documentKey: string;
  linkInstanceId?: number | null;
  uniqueId: string;
}) => JSON.stringify([handle.documentKey, handle.linkInstanceId ?? null, handle.uniqueId]);

const isSpaceElementKey = (key: string) => {
  try {
    const value: unknown = JSON.parse(key);
    return (
      Array.isArray(value) &&
      value.length === 3 &&
      typeof value[0] === "string" &&
      value[0] !== "" &&
      (value[1] === null || Number.isSafeInteger(value[1])) &&
      typeof value[2] === "string" &&
      value[2] !== "" &&
      spaceElementKey({ documentKey: value[0], linkInstanceId: value[1], uniqueId: value[2] }) ===
        key
    );
  } catch {
    return false;
  }
};
const spaceElementKeySchema = z
  .string()
  .max(4096)
  .refine(isSpaceElementKey, "an element key is JSON [documentKey, linkInstanceId|null, uniqueId]");
const spaceElementKeys = z.array(spaceElementKeySchema).max(50000);

/** The saved view's own definitions (`space-view.ts`, version 2): the scene hash and the cuts. */
const spaceCuts = spaceCutsSchema.default({
  top: emptySpaceCut,
  north: emptySpaceCut,
  east: emptySpaceCut,
});

/** 3D orbits; an axis editor draws its plane. */
const SPACE_MODES = ["3d", "top", "north", "east"] as const;
const spaceViewport = z.discriminatedUnion("kind", [orbitViewportSchema, planeViewportSchema]);

/** Host element ids, comma joined; any non-integer part makes the whole list unreadable. */
const idsCodec: Codec<number[]> = {
  encode: (ids) => ids.join(","),
  decode: (text) => {
    const parts = text === "" ? [] : text.split(",");
    return parts.every((part) => /^-?\d+$/.test(part)) ? parts.map(Number) : INVALID;
  },
};

/** `""` is none (null); any other text is the key itself. */
const nullableText: Codec<string | null> = {
  encode: (value) => value ?? "",
  decode: (text) => (text === "" ? null : text),
};

const spaceFields = {
  /** The captured scene's hash; absent = none open. Only the capture verb writes a new one. */
  scene: field(spaceSceneSchema.optional(), { url: "push", agent: "read" }),
  /** Host element ids whose surrounding context a capture includes; a URL read never captures. */
  ids: field(z.array(z.number().int()).default([]), { url: "push", agent: "set" }, idsCodec),
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
  hidden: field(
    spaceElementKeys.default([]),
    { url: "push", agent: "set" },
    jsonCodec(spaceElementKeys),
  ),
  /** null = every element shown; `[]` = nothing shown. */
  isolated: field(
    spaceElementKeys.nullable().default(null),
    { url: "push", agent: "set" },
    jsonCodec(spaceElementKeys.nullable()),
  ),
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
    layers: field(layersKey(SPACE_LAYERS, ["meshes", "context", "cuts"]), {
      url: "push",
      agent: "set",
    }),
    demo,
  },
  conflict: spaceConflict,
  agent: {
    policy:
      "Change the visible captured Space picture using ids, mode, viewport, cuts, selected, hidden, isolated and layers. Scene is read-only. Use exact element keys from this loaded scene, preserving document and link identity; unknown members are refused. A null isolation shows all; an empty isolation shows none. Viewport must match the mode, or be empty to fit. Cuts use the scene frame. Editing ids only prepares a later explicit capture. View changes never capture, recapture, select in Revit or write Work.",
  },
} satisfies RouteAddress;
